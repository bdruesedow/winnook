import { readData, writeData } from '../../sdk/PluginContext';
import { createStore } from '../_store';

export type Need = 'hunger' | 'fun' | 'love' | 'energy';
export type Reaction = 'fed' | 'played' | 'petted' | 'nap';

/** 0 = desperate, 100 = perfectly content. */
export interface PetState {
  hunger: number;
  fun: number;
  love: number;
  energy: number;
  /** The pet plugin is enabled; the buddy only shows needs while it is. */
  active: boolean;
  reaction: Reaction | null;
}

const KEY = 'plugin.nook-pet.needs';
export const LOW = 30;
const MAX_CATCH_UP_MS = 6 * 3600_000;
const CATCH_UP_FLOOR = 25;
const REACTION_MS: Record<Reaction, number> = { fed: 2200, played: 2200, petted: 2200, nap: 4500 };

/** Change per hour. Negative values are decay; positives come from real life (music, coffee, being away). */
const DECAY: Record<Need, number> = { hunger: -10, fun: -14, love: -8, energy: -7 };

export interface PetInputs {
  music: boolean;
  coffee: boolean;
  away: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const NEEDS: Need[] = ['hunger', 'fun', 'love', 'energy'];

export const pet = createStore<PetState>({ hunger: 80, fun: 80, love: 80, energy: 80, active: false, reaction: null });

function persist(): void {
  const s = pet.get();
  writeData(KEY, { hunger: s.hunger, fun: s.fun, love: s.love, energy: s.energy, at: Date.now() });
}

export function loadPet(): void {
  const saved = readData<(Record<Need, number> & { at: number }) | null>(KEY, null);
  if (!saved) return;
  const hours = Math.min(MAX_CATCH_UP_MS, Math.max(0, Date.now() - saved.at)) / 3600_000;
  const next: Partial<PetState> = {};
  for (const n of NEEDS) {
    const v = typeof saved[n] === 'number' ? saved[n] : 80;
    next[n] = clamp(Math.max(Math.min(v, CATCH_UP_FLOOR), v + DECAY[n] * hours));
  }
  pet.set(next);
}

export function tickPet(dtMs: number, input: PetInputs): void {
  const h = dtMs / 3600_000;
  const rate: Record<Need, number> = {
    hunger: DECAY.hunger,
    fun: DECAY.fun + (input.music ? 34 : 0),
    love: DECAY.love,
    energy: DECAY.energy + (input.away ? 40 : 0) + (input.coffee ? 22 : 0),
  };
  const s = pet.get();
  const next: Partial<PetState> = {};
  for (const n of NEEDS) next[n] = clamp(s[n] + rate[n] * h);
  pet.set(next);
  persist();
}

let reactionTimer: number | undefined;
function react(reaction: Reaction): void {
  window.clearTimeout(reactionTimer);
  pet.set({ reaction });
  reactionTimer = window.setTimeout(() => pet.set({ reaction: null }), REACTION_MS[reaction]);
}

function bump(need: Need, amount: number, reaction: Reaction): void {
  pet.set({ [need]: clamp(pet.get()[need] + amount) });
  react(reaction);
  persist();
}

export const feed = () => bump('hunger', 35, 'fed');
export const play = () => bump('fun', 30, 'played');
export const stroke = () => bump('love', 25, 'petted');
export const nap = () => bump('energy', 25, 'nap');

/** Small passive bonus for opening the notch; the buddy likes company. */
export function noticeVisit(): void {
  pet.set({ love: clamp(pet.get().love + 4) });
}

/** The most urgent need below the "low" threshold, if any. */
export function worstNeed(s: PetState): Need | null {
  let worst: Need | null = null;
  for (const n of NEEDS) if (s[n] < LOW && (worst === null || s[n] < s[worst])) worst = n;
  return worst;
}
