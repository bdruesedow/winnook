import { invoke } from '@tauri-apps/api/core';
import { FolderOpen } from 'lucide-react';
import { useAllPlugins, useRegistry } from '../sdk/PluginRegistry';
import { useShellStore } from '../store/useShellStore';
import { Toggle } from './ui';

const SLOT_LABEL: Record<string, string> = {
  'tile-large': 'Large tile',
  'tile-small': 'Small tile',
  'action-icon': 'Action',
  background: 'Background',
};

export function ManagePlugins() {
  const { plugins, disabled } = useAllPlugins();
  const errors = useRegistry((s) => s.errors);
  const setEnabled = useRegistry((s) => s.setEnabled);
  const errorEntries = Object.entries(errors);

  const openFolder = async () => {
    const dir = await invoke<string>('get_plugins_dir');
    await navigator.clipboard.writeText(dir).catch(() => undefined);
    useShellStore.getState().showToast(`Plugin folder copied: ${dir}`);
  };

  return (
    <div className="flex h-full flex-col gap-2 text-zinc-900 dark:text-zinc-100">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {plugins.map((p) => {
          const m = p.plugin.manifest;
          const enabled = !disabled.includes(m.id);
          return (
            <div
              key={`${p.source}:${m.id}`}
              className="flex items-center gap-3 rounded-xl bg-black/[0.06] px-3 py-1.5 dark:bg-white/[0.07]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-semibold">{m.name}</span>
                  <span className="text-[10px] text-zinc-500">v{m.version}</span>
                  <span className="rounded bg-accent/20 px-1.5 text-[9px] font-medium text-accent">
                    {SLOT_LABEL[m.slot] ?? m.slot}
                  </span>
                  {p.source !== 'builtin' && (
                    <span className="rounded bg-black/10 px-1.5 text-[9px] dark:bg-white/10">{p.source}</span>
                  )}
                </div>
                <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{m.description}</div>
              </div>
              <Toggle checked={enabled} onChange={(v) => setEnabled(m.id, v)} label={`Enable ${m.name}`} />
            </div>
          );
        })}
        {errorEntries.map(([id, message]) => (
          <div key={id} className="rounded-xl bg-red-500/10 px-3 py-1.5 text-[10px] text-red-500">
            <b>{id}</b>: {message}
          </div>
        ))}
        {plugins.length === 0 && errorEntries.length === 0 && (
          <div className="py-8 text-center text-[12px] text-zinc-500">No plugins installed</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void openFolder()}
        className="flex items-center justify-center gap-2 self-start rounded-lg bg-black/10 px-3 py-1 text-[11px] font-medium hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/20"
      >
        <FolderOpen size={13} /> Show plugin folder
      </button>
    </div>
  );
}
