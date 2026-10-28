import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, ClipboardList, Code2, Eye, EyeOff, KeyRound, Link2, Maximize2, Pin, Search, Trash2, Type, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { definePlugin, useNow, type ClipboardItem, type PluginContext } from '@winnook/sdk';

type Filter = 'all' | 'pinned' | 'links' | 'code';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'links', label: 'Links' },
  { id: 'code', label: 'Code' },
];

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function TypeIcon({ item }: { item: ClipboardItem }) {
  if (item.type === 'color') {
    return (
      <span
        className="block h-3 w-3 shrink-0 rounded-full border border-black/20 dark:border-white/30"
        style={{ backgroundColor: item.text.trim() }}
      />
    );
  }
  const Icon = item.type === 'url' ? Link2 : item.type === 'code' ? Code2 : item.type === 'secret' ? KeyRound : Type;
  return <Icon size={12} className="shrink-0 text-zinc-500 dark:text-zinc-400" />;
}

function useCopied(copy: (id: string) => Promise<void>) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    copiedId,
    copy: (id: string) => {
      void copy(id);
      setCopiedId(id);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopiedId(null), 1000);
    },
  };
}

const actionBtn =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-black/10 dark:text-zinc-300 dark:hover:bg-white/15';

const MASK = '••••••••••••';
const REVEAL_MS = 5000;

/** Reveals one secret at a time; it hides again after a few seconds. */
function useReveal() {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    isRevealed: (id: string) => revealedId === id,
    toggle: (id: string) => {
      window.clearTimeout(timer.current);
      if (revealedId === id) return setRevealedId(null);
      setRevealedId(id);
      timer.current = window.setTimeout(() => setRevealedId(null), REVEAL_MS);
    },
  };
}

function EyeButton({ item, revealed, onToggle }: { item: ClipboardItem; revealed: boolean; onToggle: () => void }) {
  if (item.type !== 'secret') return null;
  const Icon = revealed ? EyeOff : Eye;
  return (
    <button
      type="button"
      aria-label={revealed ? 'Hide' : 'Reveal for 5 seconds'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={actionBtn}
    >
      <Icon size={11} />
    </button>
  );
}

const shown = (item: ClipboardItem, revealed: boolean) => (item.type === 'secret' && !revealed ? MASK : item.text);

function Tile({ ctx }: { ctx: PluginContext }) {
  const { items, copyItem, togglePin } = ctx.system.clipboard.useClipboardHistory();
  const { copiedId, copy } = useCopied(copyItem);
  const reveal = useReveal();
  return (
    <div className="relative flex h-full flex-col p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          <ClipboardList size={14} /> Clipboard
          {items.length > 0 && (
            <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-medium leading-4 dark:bg-white/15">
              {items.length}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Open history"
          onClick={(e) => {
            e.stopPropagation();
            ctx.shell.openFullView('clipboard');
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-600 hover:bg-black/10 dark:text-zinc-300 dark:hover:bg-white/15"
        >
          <Maximize2 size={13} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="mt-2 flex min-h-0 flex-1 items-center justify-center rounded-lg bg-black/[0.06] text-[11px] text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300">
          Copy something
        </div>
      ) : (
        <div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5" onClick={(e) => e.stopPropagation()}>
          {items.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => copy(item.id)}
              onKeyDown={(e) => e.key === 'Enter' && copy(item.id)}
              className="group flex h-6 cursor-pointer items-center gap-1.5 rounded-md bg-black/[0.06] px-1.5 text-[11px] text-zinc-700 transition-colors hover:bg-black/10 dark:bg-white/[0.07] dark:text-zinc-200 dark:hover:bg-white/15"
            >
              <TypeIcon item={item} />
              <span className="min-w-0 flex-1 truncate">
                {shown(item, reveal.isRevealed(item.id)).replace(/\s+/g, ' ')}
              </span>
              <EyeButton item={item} revealed={reveal.isRevealed(item.id)} onToggle={() => reveal.toggle(item.id)} />
              {copiedId === item.id ? (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-green-500">
                  <Check size={11} /> Copied!
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={item.pinned ? 'Unpin' : 'Pin'}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePin(item.id);
                  }}
                  className={`${actionBtn} ${item.pinned ? 'text-accent' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <Pin size={11} className={item.pinned ? 'fill-current' : ''} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FullViewBody({ ctx }: { ctx: PluginContext }) {
  const { items, copyItem, togglePin, deleteItem, clearUnpinned } = ctx.system.clipboard.useClipboardHistory();
  const { copiedId, copy } = useCopied(copyItem);
  const reveal = useReveal();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const input = useRef<HTMLInputElement>(null);
  const now = useNow(30_000);

  useEffect(() => {
    // After the global shortcut the notch window may not own keyboard focus yet.
    void getCurrentWindow()
      .setFocus()
      .catch(() => undefined)
      .finally(() => input.current?.focus());
    input.current?.focus();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'pinned' && !i.pinned) return false;
      if (filter === 'links' && i.type !== 'url') return false;
      if (filter === 'code' && i.type !== 'code') return false;
      return !q || (i.type !== 'secret' && i.text.toLowerCase().includes(q));
    });
  }, [items, query, filter]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-black/[0.06] px-2 dark:bg-white/[0.08]">
          <Search size={13} className="shrink-0 text-zinc-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible[0]) {
                copy(visible[0].id);
                ctx.shell.showToast('Copied');
              }
            }}
            placeholder="Search clipboard..."
            className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-800 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
          />
        </label>
        <div className="flex shrink-0 gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? 'bg-accent text-white'
                  : 'bg-black/[0.06] text-zinc-700 hover:bg-black/10 dark:bg-white/[0.08] dark:text-zinc-200 dark:hover:bg-white/15'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Clear unpinned"
          title="Clear unpinned"
          onClick={clearUnpinned}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-black/10 dark:text-zinc-300 dark:hover:bg-white/15"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-1.5 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <div className="col-span-2 py-8 text-center text-[12px] text-zinc-500">
            {items.length === 0 ? 'Nothing copied yet' : 'No matches'}
          </div>
        )}
        {visible.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => copy(item.id)}
            onKeyDown={(e) => e.key === 'Enter' && copy(item.id)}
            className="group flex cursor-pointer flex-col gap-0.5 rounded-xl bg-black/[0.06] px-2.5 py-1.5 text-left transition-colors hover:bg-black/10 dark:bg-white/[0.07] dark:hover:bg-white/15"
          >
            <div className="flex items-start gap-1.5">
              <div className="mt-0.5 flex shrink-0">
                <TypeIcon item={item} />
              </div>
              <span
                className={`line-clamp-2 min-w-0 flex-1 break-words text-[11px] leading-snug text-zinc-800 dark:text-zinc-100 ${
                  item.type === 'code' ? 'font-mono' : ''
                }`}
              >
                {shown(item, reveal.isRevealed(item.id))}
              </span>
              {item.type === 'color' && (
                <span
                  className="h-4 w-6 shrink-0 rounded border border-black/20 dark:border-white/30"
                  style={{ backgroundColor: item.text.trim() }}
                />
              )}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>{relativeTime(item.timestamp, now)}</span>
              <span>·</span>
              <span>{item.type === 'secret' ? 'secret · auto-clears' : `${item.text.length} chars`}</span>
              <span className="flex-1" />
              <EyeButton item={item} revealed={reveal.isRevealed(item.id)} onToggle={() => reveal.toggle(item.id)} />
              {copiedId === item.id ? (
                <span className="flex items-center gap-0.5 font-medium text-green-500">
                  <Check size={11} /> Copied!
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={item.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(item.id);
                    }}
                    className={`${actionBtn} ${item.pinned ? 'text-accent' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    <Pin size={11} className={item.pinned ? 'fill-current' : ''} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteItem(item.id);
                    }}
                    className={`${actionBtn} opacity-0 group-hover:opacity-100`}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default definePlugin({
  manifest: {
    id: 'clipboard',
    name: 'Clipboard',
    version: '2.0.0',
    author: 'WinNook',
    description: 'Searchable, persistent clipboard history with pinning (Ctrl+Alt+V)',
    slot: 'tile-large',
    defaultOrder: 3,
    shortcuts: [{ accelerator: 'Ctrl+Alt+V', actionId: 'open', description: 'Open clipboard history' }],
    permissions: ['clipboard'],
  },
  onShortcut(actionId, ctx) {
    if (actionId === 'open') ctx.shell.openFullView('clipboard');
  },
  renderTile: (ctx) => <Tile ctx={ctx} />,
  renderFullView: (ctx) => <FullViewBody ctx={ctx} />,
});
