import { motionValue } from 'framer-motion';
import { create } from 'zustand';

/** How the pill is currently reacting to the user's mouse; the Nook Buddy mirrors it with a face. */
export type DodgeMood = 'none' | 'scared' | 'happy' | 'bye';

interface DodgeStore {
  /** The configured dodge modifier key is held down. */
  keyHeld: boolean;
  /** Pill is tucked away by the peek-through hotkey. */
  hidden: boolean;
  mood: DodgeMood;
}

export const useDodgeStore = create<DodgeStore>(() => ({ keyHeld: false, hidden: false, mood: 'none' }));

// Raw (unsprung) targets; NotchShell wraps them in springs.
export const dodgeTargetX = motionValue(0);
export const dodgeTargetY = motionValue(0);

let moodTimer: number | undefined;
export function setMood(mood: DodgeMood, resetAfterMs?: number): void {
  window.clearTimeout(moodTimer);
  useDodgeStore.setState({ mood });
  if (resetAfterMs) moodTimer = window.setTimeout(() => useDodgeStore.setState({ mood: 'none' }), resetAfterMs);
}

const PEEK_MS = 5000;
const BYE_MS = 450;
let peekTimer: number | undefined;
let byeTimer: number | undefined;

export function togglePeek(): void {
  const { hidden, mood } = useDodgeStore.getState();
  window.clearTimeout(peekTimer);
  window.clearTimeout(byeTimer);
  if (hidden || mood === 'bye') {
    useDodgeStore.setState({ hidden: false });
    setMood('happy', 1600);
    return;
  }
  setMood('bye');
  byeTimer = window.setTimeout(() => {
    useDodgeStore.setState({ hidden: true });
    peekTimer = window.setTimeout(togglePeek, PEEK_MS);
  }, BYE_MS);
}
