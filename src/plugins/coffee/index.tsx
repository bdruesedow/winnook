import { invoke } from '@tauri-apps/api/core';
import { Coffee as CoffeeIcon } from 'lucide-react';
import { definePlugin, useNow } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';
import { Toggle } from '../../components/ui';
import { useSettingsStore } from '../../store/useSettingsStore';
import { createStore } from '../_store';

const MODES = [
  { label: 'Always', ms: 0 },
  { label: '2 hours', ms: 2 * 3600_000 },
  { label: '1 hour', ms: 3600_000 },
  { label: '30 mins', ms: 30 * 60_000 },
];

export const coffee = createStore({ active: false, mode: 0, endAt: 0 });
let ctxRef: PluginContext | null = null;

function apply(active: boolean) {
  void ctxRef?.system.power.setKeepAwake(active);
}

function setActive(active: boolean) {
  const s = coffee.get();
  const ms = MODES[s.mode].ms;
  coffee.set({ active, endAt: active && ms > 0 ? Date.now() + ms : 0 });
  apply(active);
}

function cycleMode() {
  const s = coffee.get();
  const mode = (s.mode + 1) % MODES.length;
  const ms = MODES[mode].ms;
  coffee.set({ mode, endAt: s.active && ms > 0 ? Date.now() + ms : 0 });
}

function timeLeft(endAt: number): string {
  const total = Math.max(0, Math.ceil((endAt - Date.now()) / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')} left` : `${m}m left`;
}

function Tile() {
  const s = coffee.use();
  useNow(s.active && s.endAt ? 15_000 : 60_000);
  const label = s.active && s.endAt ? timeLeft(s.endAt) : MODES[s.mode].label;
  return (
    <div className={`flex h-full items-center gap-2.5 px-3 ${s.active ? 'nook-tile-active' : ''}`}>
      <CoffeeIcon size={22} className={s.active ? 'text-accent' : 'text-zinc-700 dark:text-zinc-200'} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">Coffee</div>
        <button
          type="button"
          onClick={cycleMode}
          className="text-[10px] text-zinc-500 hover:text-accent dark:text-zinc-400"
          title="Change duration"
        >
          {label}
        </button>
      </div>
      <Toggle checked={s.active} onChange={setActive} label="Keep awake" />
    </div>
  );
}

function Indicator() {
  const s = coffee.use();
  return s.active ? <CoffeeIcon size={14} className="text-accent" /> : null;
}

export default definePlugin({
  manifest: {
    id: 'coffee',
    name: 'Coffee',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Keeps Windows awake',
    slot: 'tile-small',
    defaultOrder: 1,
    shortcuts: [{ accelerator: 'Ctrl+Alt+C', actionId: 'toggle', description: 'Toggle keep-awake' }],
    permissions: ['power'],
  },
  onInit(ctx) {
    ctxRef = ctx;
    const id = window.setInterval(() => {
      const s = coffee.get();
      if (s.active && s.endAt && Date.now() >= s.endAt) {
        coffee.set({ active: false, endAt: 0 });
        apply(false);
        ctx.shell.showToast('Coffee ended');
      }
    }, 5_000);
    // Teams & co. go "Away" on user idle, which keep-awake alone doesn't prevent.
    const activityId = window.setInterval(() => {
      if (coffee.get().active && useSettingsStore.getState().keepStatusActive) {
        void invoke('simulate_activity').catch(() => undefined);
      }
    }, 45_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(activityId);
      if (coffee.get().active) {
        coffee.set({ active: false, endAt: 0 });
        apply(false);
      }
    };
  },
  onShortcut(actionId, ctx) {
    if (actionId !== 'toggle') return;
    const next = !coffee.get().active;
    setActive(next);
    ctx.shell.showToast(next ? 'Coffee on – staying awake' : 'Coffee off');
  },
  renderTile: () => <Tile />,
  renderPillIndicator: () => <Indicator />,
});
