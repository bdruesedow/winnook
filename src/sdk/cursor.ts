import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { CursorTracking } from './types';

const HALF_WIDTH = 360;
const NORM_Y_RANGE = 240;
const IDLE_TICK_MS = 1000;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

let state: CursorTracking = { normX: 0, normY: 0, velocity: 0, idleSeconds: 0, x: HALF_WIDTH, y: 9999 };
let lastMove = Date.now();
let started = false;
const listeners = new Set<(s: CursorTracking) => void>();

function publish(next: CursorTracking) {
  state = next;
  listeners.forEach((l) => l(next));
}

function start() {
  if (started) return;
  started = true;
  void listen<{ x: number; y: number; velocity: number }>('notch://cursor-move', (e) => {
    const { x, y, velocity } = e.payload;
    lastMove = Date.now();
    publish({
      normX: clamp((x - HALF_WIDTH) / HALF_WIDTH),
      normY: clamp((y - 16) / NORM_Y_RANGE),
      velocity,
      idleSeconds: 0,
      x,
      y,
    });
  });
  window.setInterval(() => {
    const idle = Math.floor((Date.now() - lastMove) / 1000);
    if (idle !== state.idleSeconds) publish({ ...state, velocity: 0, idleSeconds: idle });
  }, IDLE_TICK_MS);
}

export function subscribeCursor(cb: (s: CursorTracking) => void): () => void {
  start();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCursorTracking(): CursorTracking {
  const [s, setS] = useState(state);
  useEffect(() => subscribeCursor(setS), []);
  return s;
}
