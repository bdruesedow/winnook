import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { definePlugin, useNow } from '@winnook/sdk';
import { createStore } from '../_store';

interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  title: string;
}

const ALERT_MS = 60_000;
const alert = createStore<{ title: string; until: number }>({ title: '', until: 0 });
const fired = new Set<string>();

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseQuickAdd(input: string): { time: string; title: string } | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { time: `${pad(h)}:${pad(min)}`, title: m[3].trim() };
}

function Indicator({ events, onFire }: { events: CalEvent[]; onFire: () => void }) {
  const now = new Date(useNow(1000));
  const a = alert.use();
  const today = dateKey(now);
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  useEffect(() => {
    for (const e of events) {
      const key = `${e.id}@${today}`;
      if (e.date === today && e.time === hhmm && !fired.has(key)) {
        fired.add(key);
        alert.set({ title: e.title, until: Date.now() + ALERT_MS });
        onFire();
      }
    }
  }, [events, today, hhmm, onFire]);

  if (Date.now() >= a.until) return null;
  return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" title={`Now: ${a.title}`} />;
}

export default definePlugin({
  manifest: {
    id: 'calendar',
    name: 'Calendar',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Month view, agenda and reminders',
    slot: 'action-icon',
    defaultOrder: 5,
    permissions: ['storage', 'notifications'],
  },

  renderActionIcon(ctx) {
    const [events] = ctx.usePluginStore<CalEvent[]>('events', []);
    const hasToday = events.some((e) => e.date === dateKey(new Date()));
    return (
      <span className="relative">
        <CalendarDays size={20} className="text-zinc-700 dark:text-zinc-200" />
        {hasToday && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />}
      </span>
    );
  },

  renderPillIndicator(ctx) {
    const [events] = ctx.usePluginStore<CalEvent[]>('events', []);
    const onFire = () => {
      ctx.shell.playChime();
      ctx.shell.openFullView('calendar');
    };
    return <Indicator events={events} onFire={onFire} />;
  },

  renderFullView(ctx) {
    const [events, setEvents] = ctx.usePluginStore<CalEvent[]>('events', []);
    const a = alert.use();
    useNow(1000);
    const today = new Date();
    const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
    const [selected, setSelected] = useState(dateKey(today));
    const [input, setInput] = useState('');

    const cells = useMemo(() => {
      const offset = (month.getDay() + 6) % 7; // Monday first
      const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      return [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    }, [month]);

    const dayEvents = events.filter((e) => e.date === selected).sort((x, y) => x.time.localeCompare(y.time));
    const selDate = new Date(`${selected}T00:00:00`);
    const submit = () => {
      const parsed = parseQuickAdd(input);
      if (!parsed) {
        ctx.shell.showToast('Use the format 14:30 Dentist');
        return;
      }
      setEvents((prev) => [...prev, { id: crypto.randomUUID(), date: selected, ...parsed }]);
      setInput('');
    };
    const nav = (d: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + d, 1));
    const bannerActive = Date.now() < a.until;

    return (
      <div className="grid h-full grid-cols-[1fr_1fr] gap-5 text-zinc-900 dark:text-zinc-100">
        <div className="flex flex-col">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-semibold">
              {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <div className="flex">
              <button type="button" aria-label="Previous month" onClick={() => nav(-1)} className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
                <ChevronLeft size={15} />
              </button>
              <button type="button" aria-label="Next month" onClick={() => nav(1)} className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-7 content-start gap-y-0.5 text-center text-[10px]">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="text-zinc-500">
                {d}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} />;
              const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
              const isToday = key === dateKey(today);
              const isSel = key === selected;
              const has = events.some((e) => e.date === key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums ${
                    isToday ? 'bg-accent font-semibold text-white' : isSel ? 'bg-black/15 dark:bg-white/20' : 'hover:bg-black/10 dark:hover:bg-white/10'
                  }`}
                >
                  {day}
                  {has && <span className={`absolute bottom-0 h-1 w-1 rounded-full ${isToday ? 'bg-white' : 'bg-accent'}`} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {selDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            {bannerActive && (
              <span className="animate-pulse rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
                Now: {a.title}
              </span>
            )}
          </div>
          <div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {dayEvents.length === 0 && <div className="py-4 text-[11px] text-zinc-500">No events</div>}
            {dayEvents.map((e) => (
              <div key={e.id} className="group flex items-center gap-2 text-[12px]">
                <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">{e.time}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <button
                  type="button"
                  aria-label="Delete event"
                  onClick={() => setEvents((prev) => prev.filter((x) => x.id !== e.id))}
                  className="text-[11px] text-zinc-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(ev) => {
              ev.preventDefault();
              submit();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add: 14:30 Dentist"
              className="min-w-0 flex-1 rounded-lg bg-black/[0.06] px-2.5 py-1.5 text-[11px] outline-none placeholder:text-zinc-400 dark:bg-white/[0.08]"
            />
            <button type="submit" aria-label="Add event" className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white">
              <Plus size={15} />
            </button>
          </form>
        </div>
      </div>
    );
  },
});
