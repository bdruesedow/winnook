import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { create } from 'zustand';
import { ensureClipboardTracking } from './clipboard';
import { createPluginContext, readData, usePluginData, writeData } from './PluginContext';
import type { NookPlugin, PluginContext, PluginManifest, PluginSlotType } from './types';
import { useSettingsStore } from '../store/useSettingsStore';

type Source = 'builtin' | 'user' | 'dev';

export interface LoadedPlugin {
  plugin: NookPlugin;
  ctx: PluginContext;
  source: Source;
  folder?: string;
  /** Changes on every (re)load so React remounts the plugin's subtree. */
  instanceId: number;
  active: boolean;
  cleanup?: () => void;
  shortcuts: string[];
}

interface ExternalPluginInfo {
  root: 'user' | 'dev';
  folder: string;
  manifest: PluginManifest | null;
  error: string | null;
  hasEntry: boolean;
}

interface FileChanged {
  root: 'user' | 'dev';
  folder: string;
  kind: 'create' | 'modify' | 'remove';
}

interface RegistryState {
  loaded: LoadedPlugin[];
  errors: Record<string, string>;
  ready: boolean;
  init: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => void;
}

const DISABLED_KEY = 'registry.disabled';
const ORDER_KEY = 'registry.order';
const FALLBACK_ORDER = 1000;

let instanceCounter = 0;

/* ---------- selectors ---------- */

export function isEnabled(id: string): boolean {
  return !readData<string[]>(DISABLED_KEY, []).includes(id);
}

/** All plugins in display order: user order first, then manifest `defaultOrder`, then name. */
export function sortPlugins(loaded: LoadedPlugin[], order: string[]): LoadedPlugin[] {
  const rank = (p: LoadedPlugin) => {
    const idx = order.indexOf(p.plugin.manifest.id);
    return idx >= 0 ? idx : order.length + (p.plugin.manifest.defaultOrder ?? FALLBACK_ORDER);
  };
  return [...loaded].sort(
    (a, b) =>
      rank(a) - rank(b) || a.plugin.manifest.name.localeCompare(b.plugin.manifest.name),
  );
}

export function usePluginsForSlot(slot: PluginSlotType): LoadedPlugin[] {
  const loaded = useRegistry((s) => s.loaded);
  const data = usePluginData((s) => s.data);
  const order = (data[ORDER_KEY] as string[] | undefined) ?? [];
  const disabled = (data[DISABLED_KEY] as string[] | undefined) ?? [];
  return sortPlugins(loaded, order).filter(
    (p) => p.plugin.manifest.slot === slot && p.active && !disabled.includes(p.plugin.manifest.id),
  );
}

export function useAllPlugins(): { plugins: LoadedPlugin[]; disabled: string[] } {
  const loaded = useRegistry((s) => s.loaded);
  const data = usePluginData((s) => s.data);
  const order = (data[ORDER_KEY] as string[] | undefined) ?? [];
  const disabled = (data[DISABLED_KEY] as string[] | undefined) ?? [];
  return { plugins: sortPlugins(loaded, order), disabled };
}

/* ---------- activation ---------- */

async function registerShortcuts(lp: LoadedPlugin): Promise<void> {
  for (const shortcut of lp.plugin.manifest.shortcuts ?? []) {
    try {
      await register(shortcut.accelerator, (event) => {
        if (event.state === 'Pressed') lp.plugin.onShortcut?.(shortcut.actionId, lp.ctx);
      });
      lp.shortcuts.push(shortcut.accelerator);
    } catch (err) {
      reportError(lp.plugin.manifest.id, `shortcut ${shortcut.accelerator}: ${String(err)}`);
    }
  }
}

async function unregisterShortcuts(lp: LoadedPlugin): Promise<void> {
  for (const accelerator of lp.shortcuts) {
    await unregister(accelerator).catch(() => undefined);
  }
  lp.shortcuts = [];
}

function reportError(id: string, message: string): void {
  console.error(`[WinNook] ${id}: ${message}`);
  useRegistry.setState((s) => ({ errors: { ...s.errors, [id]: message } }));
}

function clearError(id: string): void {
  useRegistry.setState((s) => {
    const { [id]: _removed, ...rest } = s.errors;
    return { errors: rest };
  });
}

async function activate(lp: LoadedPlugin): Promise<void> {
  if (lp.active) return;
  lp.active = true;
  if (lp.plugin.manifest.permissions.includes('clipboard')) ensureClipboardTracking();
  try {
    const cleanup = lp.plugin.onInit?.(lp.ctx);
    if (typeof cleanup === 'function') lp.cleanup = cleanup;
  } catch (err) {
    reportError(lp.plugin.manifest.id, `onInit failed: ${String(err)}`);
  }
  await registerShortcuts(lp);
}

async function deactivate(lp: LoadedPlugin): Promise<void> {
  if (!lp.active) return;
  lp.active = false;
  try {
    lp.cleanup?.();
  } catch (err) {
    console.error(err);
  }
  lp.cleanup = undefined;
  await unregisterShortcuts(lp);
}

function touch(): void {
  useRegistry.setState((s) => ({ loaded: [...s.loaded] }));
}

/* ---------- loading ---------- */

function makeLoaded(plugin: NookPlugin, source: Source, folder?: string): LoadedPlugin {
  return {
    plugin,
    ctx: createPluginContext(plugin.manifest),
    source,
    folder,
    instanceId: ++instanceCounter,
    active: false,
    shortcuts: [],
  };
}

function isManifest(value: unknown): value is PluginManifest {
  const m = value as PluginManifest | null;
  return (
    !!m &&
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    typeof m.slot === 'string' &&
    Array.isArray(m.permissions)
  );
}

async function importExternal(info: ExternalPluginInfo, devDir: string): Promise<NookPlugin> {
  if (!isManifest(info.manifest)) throw new Error(info.error ?? 'invalid manifest.json');
  if (!info.hasEntry) throw new Error('index.js missing');
  const source = await invoke<string>('read_plugin_entry', {
    root: info.root,
    folder: info.folder,
    devDir,
  });
  // A fresh Blob URL per load is the cache-busting equivalent for in-memory modules.
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
    const exported = (mod.default ?? mod.plugin) as Partial<NookPlugin> | (() => Partial<NookPlugin>);
    const hooks = typeof exported === 'function' ? exported() : exported;
    if (!hooks || typeof hooks !== 'object') throw new Error('index.js has no default export');
    return { ...hooks, manifest: info.manifest } as NookPlugin;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadExternal(info: ExternalPluginInfo, devDir: string): Promise<void> {
  const key = `${info.root}:${info.folder}`;
  try {
    const plugin = await importExternal(info, devDir);
    clearError(key);
    await replace(makeLoaded(plugin, info.root, info.folder), key);
  } catch (err) {
    reportError(key, String(err));
  }
}

async function replace(next: LoadedPlugin, errorKey?: string): Promise<void> {
  const id = next.plugin.manifest.id;
  const existing = useRegistry
    .getState()
    .loaded.find((p) => p.plugin.manifest.id === id || (next.folder && p.folder === next.folder && p.source === next.source));
  if (existing) await deactivate(existing);
  useRegistry.setState((s) => ({
    loaded: [...s.loaded.filter((p) => p !== existing), next],
  }));
  if (isEnabled(id)) await activate(next);
  touch();
  if (errorKey) clearError(errorKey);
}

async function removeExternal(root: string, folder: string): Promise<void> {
  const existing = useRegistry
    .getState()
    .loaded.find((p) => p.source === root && p.folder === folder);
  if (!existing) return;
  await deactivate(existing);
  useRegistry.setState((s) => ({ loaded: s.loaded.filter((p) => p !== existing) }));
}

async function scanExternal(): Promise<void> {
  const devDir = useSettingsStore.getState().devDir;
  const list = await invoke<ExternalPluginInfo[]>('list_external_plugins', { devDir: devDir || null });
  for (const info of list) await loadExternal(info, devDir);
}

/* ---------- dev mode watcher ---------- */

let watching = false;

async function syncWatcher(): Promise<void> {
  const { devMode, devDir } = useSettingsStore.getState();
  if (devMode) {
    await invoke('start_plugin_watcher', { devDir: devDir || null });
    watching = true;
  } else if (watching) {
    await invoke('stop_plugin_watcher');
    watching = false;
  }
}

async function handleFileChanged(change: FileChanged): Promise<void> {
  if (!useSettingsStore.getState().devMode) return;
  const devDir = useSettingsStore.getState().devDir;
  if (change.kind === 'remove') {
    const infos = await invoke<ExternalPluginInfo[]>('list_external_plugins', { devDir: devDir || null });
    if (!infos.some((i) => i.root === change.root && i.folder === change.folder)) {
      await removeExternal(change.root, change.folder);
      return;
    }
  }
  const infos = await invoke<ExternalPluginInfo[]>('list_external_plugins', { devDir: devDir || null });
  const info = infos.find((i) => i.root === change.root && i.folder === change.folder);
  if (info) await loadExternal(info, devDir);
}

/* ---------- store ---------- */

export const useRegistry = create<RegistryState>((set, get) => ({
  loaded: [],
  errors: {},
  ready: false,

  init: async () => {
    if (get().ready) return;
    await usePluginData.getState().init();

    const modules = import.meta.glob<{ default: NookPlugin }>('../plugins/*/index.tsx', {
      eager: true,
    });
    const builtins = Object.values(modules).map((m) => makeLoaded(m.default, 'builtin'));
    set({ loaded: builtins });
    for (const lp of builtins) {
      if (isEnabled(lp.plugin.manifest.id)) await activate(lp);
    }
    touch();

    await scanExternal().catch((err) => console.error('[WinNook] plugin scan failed', err));
    set({ ready: true });

    await syncWatcher().catch((err) => console.error(err));
    useSettingsStore.subscribe((state, prev) => {
      if (state.devMode !== prev.devMode || state.devDir !== prev.devDir) {
        void syncWatcher().then(() => (state.devMode ? scanExternal() : undefined));
      }
    });
    await listen<FileChanged>('plugin://file-changed', (e) => void handleFileChanged(e.payload));
  },

  setEnabled: (id, enabled) => {
    const disabled = new Set(readData<string[]>(DISABLED_KEY, []));
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    writeData(DISABLED_KEY, [...disabled]);
    const lp = get().loaded.find((p) => p.plugin.manifest.id === id);
    if (lp) void (enabled ? activate(lp) : deactivate(lp)).then(touch);
  },
}));
