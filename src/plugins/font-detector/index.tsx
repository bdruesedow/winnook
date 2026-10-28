import { invoke } from '@tauri-apps/api/core';
import { definePlugin } from '@winnook/sdk';
import type { PluginContext, RegionSelection } from '@winnook/sdk';
import { createStore } from '../_store';

interface FontMatch {
  name: string;
  family: string;
  score: number;
}

interface Detection {
  imageBase64: string;
  text: string;
  matches: FontMatch[];
}

const result = createStore<{ detection: Detection | null }>({ detection: null });
let busy = false;

async function run(ctx: PluginContext) {
  if (busy) return;
  busy = true;
  try {
    ctx.shell.collapse();
    const sel: RegionSelection | null = await ctx.system.overlay.openRegionSelector(
      'Drag over a line of text to find its font. Esc to cancel',
    );
    if (!sel) return;
    const detection = await invoke<Detection>('detect_font', { region: sel.region });
    result.set({ detection });
    ctx.shell.openFullView('font-detector');
  } catch (err) {
    ctx.shell.showToast(typeof err === 'string' ? err : 'Font detection failed');
  } finally {
    busy = false;
  }
}

export default definePlugin({
  manifest: {
    id: 'font-detector',
    name: 'Font Detector',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Identify a font from a screen selection',
    slot: 'action-icon',
    defaultOrder: 7,
    shortcuts: [{ accelerator: 'Ctrl+Alt+F', actionId: 'detect', description: 'Detect a font on screen' }],
    permissions: ['overlay', 'clipboard'],
  },
  onShortcut(actionId, ctx) {
    if (actionId === 'detect') void run(ctx);
  },
  renderActionIcon(ctx) {
    return (
      <button
        type="button"
        aria-label="Font Detector"
        onClick={(e) => {
          e.stopPropagation();
          void run(ctx);
        }}
        className="flex h-full w-full items-center justify-center text-[16px] font-semibold text-zinc-700 dark:text-zinc-200"
      >
        Aa
      </button>
    );
  },
  renderFullView(ctx) {
    const { detection } = result.use();
    const { copyText } = ctx.system.clipboard.useClipboardHistory();
    if (!detection) return <div className="py-8 text-center text-[12px] text-zinc-500">No result yet</div>;
    return (
      <div className="grid h-full grid-cols-[1fr_1.2fr] gap-5 text-zinc-900 dark:text-zinc-100">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/[0.06] p-2 dark:bg-white/[0.07]">
            <img src={`data:image/png;base64,${detection.imageBase64}`} alt="Selection" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="truncate text-center text-[12px] italic text-zinc-600 dark:text-zinc-300">“{detection.text}”</div>
        </div>
        <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
          {detection.matches.slice(0, 5).map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => {
                void copyText(m.name);
                ctx.shell.showToast('Copied');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl bg-black/[0.06] px-3 py-1.5 text-left hover:bg-black/10 dark:bg-white/[0.07] dark:hover:bg-white/15"
            >
              <span className="min-w-0 truncate text-[15px]" style={{ fontFamily: `"${m.family}", "${m.name}"` }}>
                {m.name}
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-accent">{m.score}%</span>
            </button>
          ))}
        </div>
      </div>
    );
  },
});
