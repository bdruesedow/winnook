import { Pencil } from 'lucide-react';
import { definePlugin } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';

function start(ctx: PluginContext) {
  ctx.shell.collapse();
  void ctx.system.overlay.openDrawingOverlay();
}

export default definePlugin({
  manifest: {
    id: 'screen-draw',
    name: 'Screen Draw',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Draw on top of your screen',
    slot: 'action-icon',
    defaultOrder: 6,
    shortcuts: [{ accelerator: 'Ctrl+Alt+D', actionId: 'draw', description: 'Start screen drawing' }],
    permissions: ['overlay'],
  },
  onShortcut(actionId, ctx) {
    if (actionId === 'draw') start(ctx);
  },
  renderActionIcon(ctx) {
    return (
      <button
        type="button"
        aria-label="Screen Draw"
        onClick={(e) => {
          e.stopPropagation();
          start(ctx);
        }}
        className="flex h-full w-full items-center justify-center"
      >
        <Pencil size={20} className="text-zinc-700 dark:text-zinc-200" />
      </button>
    );
  },
});
