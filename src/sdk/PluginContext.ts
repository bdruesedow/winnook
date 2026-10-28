import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { load, type Store } from '@tauri-apps/plugin-store';
import { useCallback } from 'react';
import { create } from 'zustand';
import { playChime } from './chime';
import { useClipboardHistory } from './clipboard';
import { useCursorTracking } from './cursor';
import { useMediaSession } from './media';
import { useTeamsStatus } from './teams';
import type {
  PluginContext,
  PluginManifest,
  PluginPermission,
  RegionSelection,
} from './types';
import { useShellStore } from '../store/useShellStore';

/* ---------- persistent per-plugin storage ---------- */

interface PluginData {
  data: Record<string, unknown>;
  ready: boolean;
  init: () => Promise<void>;
  set: (key: string, value: unknown) => void;
}

let dataStore: Store | null = null;

export const usePluginData = create<PluginData>((set) => ({
  data: {},
  ready: false,
  init: async () => {
    dataStore = await load('plugins.json', { autoSave: 300 } as Parameters<typeof load>[1]);
    const entries = await dataStore.entries<unknown>();
    set({ data: Object.fromEntries(entries), ready: true });
  },
  set: (key, value) => {
    set((s) => ({ data: { ...s.data, [key]: value } }));
    void dataStore?.set(key, value);
  },
}));

/** Non-hook access for the registry (enabled/order bookkeeping). */
export function readData<T>(key: string, fallback: T): T {
  const v = usePluginData.getState().data[key];
  return v === undefined ? fallback : (v as T);
}

export function writeData(key: string, value: unknown): void {
  usePluginData.getState().set(key, value);
}

/* ---------- permission guard ---------- */

function guard<A extends unknown[], R>(
  manifest: PluginManifest,
  permission: PluginPermission,
  name: string,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => {
    if (!manifest.permissions.includes(permission)) {
      throw new Error(
        `Plugin "${manifest.id}" called ${name} without the "${permission}" permission in its manifest.`,
      );
    }
    return fn(...args);
  };
}

/* ---------- overlay bridge ---------- */

async function openRegionSelector(promptText: string): Promise<RegionSelection | null> {
  return new Promise((resolve, reject) => {
    const unlisteners: UnlistenFn[] = [];
    const finish = (value: RegionSelection | null) => {
      unlisteners.forEach((u) => u());
      resolve(value);
    };
    Promise.all([
      listen<RegionSelection | null>('overlay://region-result', (e) => finish(e.payload)),
      listen('overlay://closed', () => finish(null)),
    ])
      .then((handles) => {
        unlisteners.push(...handles);
        return invoke('open_overlay', { request: { mode: 'region', prompt: promptText } });
      })
      .catch((err) => {
        unlisteners.forEach((u) => u());
        reject(err);
      });
  });
}

/* ---------- context factory ---------- */

export function createPluginContext(manifest: PluginManifest): PluginContext {
  const shell = useShellStore.getState;
  const prefix = `plugin.${manifest.id}.`;

  const usePluginStore: PluginContext['usePluginStore'] = <T,>(key: string, initialValue: T) => {
    const fullKey = prefix + key;
    const stored = usePluginData((s) => s.data[fullKey]) as T | undefined;
    const value = stored === undefined ? initialValue : stored;
    const setValue = useCallback(
      (next: T | ((prev: T) => T)) => {
        const current = readData<T>(fullKey, initialValue);
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(current) : next;
        usePluginData.getState().set(fullKey, resolved);
      },
      // initialValue is only a fallback for the first read
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [fullKey],
    );
    return [value, setValue];
  };

  return {
    usePluginStore,
    shell: {
      expand: () => shell().expand('plugin'),
      collapse: () => shell().collapse(),
      openFullView: (id) => {
        shell().expand('plugin');
        shell().openFullView(id);
      },
      closeFullView: () => shell().closeFullView(),
      playChime,
      showToast: (msg) => shell().showToast(msg),
    },
    system: {
      power: {
        setKeepAwake: guard(manifest, 'power', 'system.power.setKeepAwake', (enabled: boolean) =>
          invoke<void>('set_keep_awake', { enabled }),
        ),
      },
      media: {
        useMediaSession: guard(manifest, 'media', 'system.media.useMediaSession', useMediaSession),
      },
      clipboard: {
        useClipboardHistory: guard(
          manifest,
          'clipboard',
          'system.clipboard.useClipboardHistory',
          useClipboardHistory,
        ),
      },
      cursor: {
        useCursorTracking: guard(manifest, 'cursor', 'system.cursor.useCursorTracking', useCursorTracking),
      },
      teams: {
        useTeamsStatus: guard(manifest, 'teams', 'system.teams.useTeamsStatus', useTeamsStatus),
      },
      overlay: {
        openDrawingOverlay: guard(manifest, 'overlay', 'system.overlay.openDrawingOverlay', () =>
          invoke<void>('open_overlay', { request: { mode: 'draw' } }),
        ),
        openRegionSelector: guard(
          manifest,
          'overlay',
          'system.overlay.openRegionSelector',
          openRegionSelector,
        ),
      },
    },
  };
}
