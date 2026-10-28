import { Cookie, Gamepad2, Heart, Moon, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { definePlugin } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';
import { subscribeCursor } from '../../sdk/cursor';
import { useShellStore } from '../../store/useShellStore';
import { coffee } from '../coffee';
import { LOW, feed, loadPet, nap, noticeVisit, pet, play, stroke, tickPet, type Need } from './petStore';

const TICK_MS = 30_000;
const AWAY_AFTER_S = 300;
const VISIT_COOLDOWN_MS = 120_000;

const ROWS: Array<{ need: Need; label: string; hint: string; icon: LucideIcon; act: () => void }> = [
  { need: 'hunger', label: 'Snack', hint: 'Feed a snack', icon: Cookie, act: feed },
  { need: 'fun', label: 'Play', hint: 'Play (music helps too)', icon: Gamepad2, act: play },
  { need: 'love', label: 'Pet', hint: 'Give some love', icon: Heart, act: stroke },
  { need: 'energy', label: 'Nap', hint: 'Take a nap (being away helps too)', icon: Moon, act: nap },
];

function Tile() {
  const s = pet.use();
  return (
    <div className="flex h-full items-center gap-1 px-1.5">
      {ROWS.map(({ need, label, hint, icon: Icon, act }) => {
        const value = s[need];
        const low = value < LOW;
        return (
          <button
            key={need}
            type="button"
            onClick={act}
            title={`${hint} · ${Math.round(value)}%`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Icon size={15} className={low ? 'text-amber-500' : 'text-zinc-700 dark:text-zinc-200'} />
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
              <div
                className={`h-full rounded-full ${low ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${value}%`, transition: 'width 0.6s' }}
              />
            </div>
            <span className="text-[9px] leading-none text-zinc-500 dark:text-zinc-400">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Invisible: advances the needs using real-life signals (music, coffee, being away). */
function Engine({ ctx }: { ctx: PluginContext }) {
  const media = ctx.system.media.useMediaSession();
  const coffeeOn = coffee.use().active;
  const input = useRef({ music: false, coffee: false, away: false });
  input.current.music = media.isPlaying;
  input.current.coffee = coffeeOn;

  useEffect(() => {
    const offCursor = subscribeCursor((c) => {
      input.current.away = c.idleSeconds >= AWAY_AFTER_S;
    });
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      tickPet(now - last, input.current);
      last = now;
    }, TICK_MS);

    let lastVisit = 0;
    const offShell = useShellStore.subscribe((state, prev) => {
      const opened = prev.view.kind === 'collapsed' && state.view.kind !== 'collapsed';
      if (opened && state.openedBy === 'hover' && Date.now() - lastVisit > VISIT_COOLDOWN_MS) {
        lastVisit = Date.now();
        noticeVisit();
      }
    });
    return () => {
      offCursor();
      offShell();
      window.clearInterval(id);
    };
  }, []);
  return null;
}

export default definePlugin({
  manifest: {
    id: 'nook-pet',
    name: 'Buddy Needs',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Your Nook Buddy gets hungry, bored, lonely and tired',
    slot: 'tile-small',
    defaultOrder: 21,
    permissions: ['media', 'storage'],
  },
  onInit() {
    loadPet();
    pet.set({ active: true });
    return () => pet.set({ active: false, reaction: null });
  },
  renderTile: () => <Tile />,
  renderPillIndicator: (ctx) => <Engine ctx={ctx} />,
});
