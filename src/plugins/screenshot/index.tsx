import { invoke } from '@tauri-apps/api/core';
import { Camera } from 'lucide-react';
import { definePlugin } from '@winnook/sdk';
import type { PluginContext, RegionSelection } from '@winnook/sdk';
import { Segmented } from '../../components/ui';
import { createStore } from '../_store';

type Mode = 'region' | 'screen';

const options = createStore<{ mode: Mode; delay: number }>({ mode: 'region', delay: 0 });
let busy = false;

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function capture(ctx: PluginContext) {
  if (busy) return;
  busy = true;
  try {
    const { mode, delay } = options.get();
    ctx.shell.collapse();
    for (let i = delay; i > 0; i--) {
      ctx.shell.showToast(`Screenshot in ${i}…`);
      await sleep(1000);
    }
    let image: string;
    if (mode === 'region') {
      const sel: RegionSelection | null = await ctx.system.overlay.openRegionSelector(
        'Drag to capture an area. Esc to cancel',
      );
      if (!sel) return;
      image = sel.imageBase64;
    } else {
      image = (await invoke<{ imageBase64: string }>('capture_fullscreen')).imageBase64;
    }
    await invoke('open_screenshot_editor', { imageBase64: image });
  } catch (err) {
    ctx.shell.showToast(typeof err === 'string' ? err : 'Screenshot failed');
  } finally {
    busy = false;
  }
}

export default definePlugin({
  manifest: {
    id: 'screenshot',
    name: 'Screenshot',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Capture an area or screen, then annotate and crop',
    slot: 'action-icon',
    defaultOrder: 5,
    shortcuts: [{ accelerator: 'Ctrl+Alt+S', actionId: 'capture', description: 'Take a screenshot' }],
    permissions: ['overlay'],
  },
  onShortcut(actionId, ctx) {
    if (actionId === 'capture') void capture(ctx);
  },
  renderActionIcon() {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Camera size={20} className="text-zinc-700 dark:text-zinc-200" />
      </div>
    );
  },
  renderFullView(ctx) {
    const o = options.use();
    return (
      <div className="flex h-full flex-col justify-center gap-4 px-6 text-zinc-900 dark:text-zinc-100">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium">Capture</span>
          <Segmented
            value={o.mode}
            onChange={(mode) => options.set({ mode })}
            options={[
              { value: 'region', label: 'Area' },
              { value: 'screen', label: 'Full screen' },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium">Delay</span>
          <Segmented
            value={String(o.delay)}
            onChange={(v) => options.set({ delay: Number(v) })}
            options={[
              { value: '0', label: 'None' },
              { value: '3', label: '3 s' },
              { value: '5', label: '5 s' },
              { value: '10', label: '10 s' },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => void capture(ctx)}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white"
        >
          <Camera size={16} /> Take screenshot
        </button>
        <div className="text-center text-[10px] text-zinc-500 dark:text-zinc-400">Shortcut: Ctrl+Alt+S</div>
      </div>
    );
  },
});
