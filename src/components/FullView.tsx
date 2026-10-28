import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useAllPlugins } from '../sdk/PluginRegistry';
import { MANAGE_PLUGINS_VIEW_ID, SETTINGS_VIEW_ID, useShellStore } from '../store/useShellStore';
import { ManagePlugins } from './ManagePlugins';
import { PluginRender } from './PluginRender';
import { SettingsView } from './SettingsView';

export function FullView({ pluginId }: { pluginId: string }) {
  const closeFullView = useShellStore((s) => s.closeFullView);
  const { plugins } = useAllPlugins();
  const lp = plugins.find((p) => p.plugin.manifest.id === pluginId);

  const builtin = pluginId === SETTINGS_VIEW_ID || pluginId === MANAGE_PLUGINS_VIEW_ID;
  const title =
    pluginId === SETTINGS_VIEW_ID ? 'Settings' : pluginId === MANAGE_PLUGINS_VIEW_ID ? 'Plugins' : lp?.plugin.manifest.name;

  // The plugin may have been unloaded (dev mode, disabled): fall back to the grid.
  useEffect(() => {
    if (!builtin && !lp) closeFullView();
  }, [builtin, lp, closeFullView]);

  return (
    <div className="flex h-full w-full flex-col p-3">
      <button
        type="button"
        onClick={closeFullView}
        className="mb-2 flex items-center gap-1.5 self-start rounded-lg px-1.5 py-0.5 text-[12px] font-semibold text-zinc-700 transition-colors hover:bg-black/10 dark:text-zinc-200 dark:hover:bg-white/10"
      >
        <ArrowLeft size={14} />
        {title}
      </button>
      <div className="min-h-0 flex-1">
        {pluginId === SETTINGS_VIEW_ID && <SettingsView />}
        {pluginId === MANAGE_PLUGINS_VIEW_ID && <ManagePlugins />}
        {lp && (
          <PluginRender key={lp.instanceId} plugin={lp.plugin} ctx={lp.ctx} kind="renderFullView" />
        )}
      </div>
    </div>
  );
}
