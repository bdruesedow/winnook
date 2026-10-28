import { Hourglass, Minus, Pause, Play, Plus, RotateCcw, Timer as TimerIcon } from 'lucide-react';
import { definePlugin, useNow } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';
import { createStore, formatClock } from '../_store';

const DEFAULT_SECONDS = 25 * 60;
const STEP_SECONDS = 5 * 60;

interface TimerState {
  total: number;
  remainingMs: number;
  running: boolean;
  endAt: number;
  ringing: boolean;
}

const timer = createStore<TimerState>({
  total: DEFAULT_SECONDS,
  remainingMs: DEFAULT_SECONDS * 1000,
  running: false,
  endAt: 0,
  ringing: false,
});

function remainingNow(s: TimerState): number {
  return s.running ? Math.max(0, s.endAt - Date.now()) : s.remainingMs;
}

function toggle() {
  const s = timer.get();
  if (s.running) {
    timer.set({ running: false, remainingMs: remainingNow(s) });
    return;
  }
  const ms = s.remainingMs > 0 ? s.remainingMs : s.total * 1000;
  timer.set({ running: true, remainingMs: ms, endAt: Date.now() + ms, ringing: false });
}

function reset() {
  const s = timer.get();
  timer.set({ running: false, remainingMs: s.total * 1000, ringing: false });
}

function adjust(deltaSeconds: number) {
  const s = timer.get();
  const total = Math.max(60, s.total + deltaSeconds);
  const remaining = Math.max(0, remainingNow(s) + deltaSeconds * 1000);
  timer.set({
    total,
    remainingMs: remaining,
    endAt: s.running ? Date.now() + remaining : s.endAt,
  });
}

function useRemainingSeconds(): { seconds: number; state: TimerState } {
  const state = timer.use();
  useNow(state.running ? 250 : 60_000);
  return { seconds: remainingNow(state) / 1000, state };
}

function Ring({ fraction }: { fraction: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="5" className="stroke-black/10 dark:stroke-white/15" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-accent"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))}
      />
    </svg>
  );
}

const iconBtn =
  'flex h-7 w-7 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-black/10 dark:text-zinc-200 dark:hover:bg-white/15';

function Tile() {
  const { seconds, state } = useRemainingSeconds();
  return (
    <div className="flex h-full flex-col p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          <Hourglass size={14} /> Timer
        </div>
        <button type="button" aria-label="Reset timer" onClick={reset} className={iconBtn}>
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="relative mx-auto my-auto aspect-square h-[88px]">
        <Ring fraction={seconds / state.total} />
        <div className="absolute inset-0 flex items-center justify-center text-[18px] font-semibold tabular-nums text-zinc-900 dark:text-white">
          {formatClock(seconds)}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="Minus 5 minutes" onClick={() => adjust(-STEP_SECONDS)} className={iconBtn}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={state.running ? 'Pause' : 'Start'}
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow transition-transform hover:scale-105 active:scale-95"
        >
          {state.running ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <button type="button" aria-label="Plus 5 minutes" onClick={() => adjust(STEP_SECONDS)} className={iconBtn}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

function Indicator() {
  const { seconds, state } = useRemainingSeconds();
  if (!state.running && !state.ringing) return null;
  return (
    <span className={`flex items-center gap-1 text-[11px] tabular-nums text-accent ${state.ringing ? 'animate-pulse' : ''}`}>
      <TimerIcon size={13} />
      {state.running ? formatClock(seconds) : '0:00'}
    </span>
  );
}

let ctxRef: PluginContext | null = null;

export default definePlugin({
  manifest: {
    id: 'timer',
    name: 'Timer',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Countdown timer with chime',
    slot: 'tile-large',
    defaultOrder: 0,
    permissions: [],
  },
  onInit(ctx) {
    ctxRef = ctx;
    const id = window.setInterval(() => {
      const s = timer.get();
      if (s.running && Date.now() >= s.endAt) {
        timer.set({ running: false, remainingMs: 0, ringing: true });
        ctxRef?.shell.playChime();
        ctxRef?.shell.expand();
        window.setTimeout(() => timer.set({ ringing: false, remainingMs: timer.get().total * 1000 }), 10_000);
      }
    }, 250);
    return () => window.clearInterval(id);
  },
  renderTile: () => <Tile />,
  renderPillIndicator: () => <Indicator />,
});
