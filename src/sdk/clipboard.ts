import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { load, type Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand';
import type { ClipboardItem } from './types';

/** Limit for unpinned entries; pinned entries are never evicted. */
const MAX_UNPINNED = 50;
const STORE_KEY = 'items';

const HEX_RE = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i;
const CODE_RE = /[{}]|;\s*$|(^|\s)(const|function|import|SELECT) /m;

/** Unpinned secrets disappear from the history after this long. */
const SECRET_TTL_MS = 30 * 60_000;

const SECRET_PATTERNS = [
  /^gh[pousr]_[A-Za-z0-9]{20,}$/, // GitHub tokens
  /^sk_(live|test)_[A-Za-z0-9]{10,}$|^sk-[A-Za-z0-9_-]{20,}$/, // Stripe / API-style keys
  /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/, // JWT
  /-----BEGIN [A-Z ]*-----/, // PEM blocks, private keys
  /^[a-f0-9]{32,}$/i, // long hex strings (hashes, keys)
];

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Generated passwords: short-to-medium, no whitespace, mixed character classes, high entropy. */
function looksLikePassword(t: string): boolean {
  if (t.length < 12 || t.length > 64 || /\s/.test(t)) return false;
  if (/^[A-Za-z]:[\\/]|^\/|^\.{1,2}[\\/]|^[\w.+-]+@[\w-]+\.\w+$/.test(t)) return false; // paths, e-mail addresses
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(t)).length;
  return classes >= 3 && shannonEntropy(t) >= 3.3;
}

export function classify(text: string): ClipboardItem['type'] {
  const t = text.trim();
  if (SECRET_PATTERNS.some((r) => r.test(t))) return 'secret';
  if (/^https?:\/\//i.test(t)) return 'url';
  if (HEX_RE.test(t) || RGB_RE.test(t)) return 'color';
  if (looksLikePassword(t)) return 'secret';
  if (CODE_RE.test(text)) return 'code';
  return 'text';
}

const isExpired = (i: ClipboardItem, now: number) => i.type === 'secret' && !i.pinned && now - i.timestamp > SECRET_TTL_MS;

interface PersistedItem extends Omit<ClipboardItem, 'text'> {
  text: string;
  /** DPAPI-encrypted text (base64); secrets are never written in clear. */
  enc?: string;
}

interface ClipboardStore {
  items: ClipboardItem[];
  push: (text: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  clearUnpinned: () => void;
}

let diskStore: Store | null = null;
let hydrated = false;

let persistChain: Promise<void> = Promise.resolve();

function persist(items: ClipboardItem[]): void {
  if (!hydrated) return;
  // Serialized so an older, slower write can never overwrite a newer one.
  persistChain = persistChain
    .then(async () => {
      const out = await Promise.all(
        items.map(async (i): Promise<PersistedItem | null> => {
          if (i.type !== 'secret') return i;
          try {
            return { ...i, text: '', enc: await invoke<string>('dpapi_protect', { text: i.text }) };
          } catch {
            return null; // never fall back to storing a secret in clear
          }
        }),
      );
      await diskStore?.set(STORE_KEY, out.filter(Boolean));
    })
    .catch(() => undefined);
}

/** Newest first, expired secrets dropped, unpinned entries capped. */
function normalize(items: ClipboardItem[]): ClipboardItem[] {
  const now = Date.now();
  const sorted = items.filter((i) => !isExpired(i, now)).sort((a, b) => b.timestamp - a.timestamp);
  let unpinned = 0;
  return sorted.filter((i) => i.pinned || ++unpinned <= MAX_UNPINNED);
}

const useClipboardStore = create<ClipboardStore>((set, get) => {
  const commit = (items: ClipboardItem[]) => {
    const next = normalize(items);
    set({ items: next });
    persist(next);
  };
  return {
    items: [],
    push: (text) => {
      if (!text.trim()) return;
      const now = Date.now();
      const existing = get().items.find((i) => i.text === text);
      commit(
        existing
          ? get().items.map((i) => (i === existing ? { ...i, timestamp: now } : i))
          : [{ id: crypto.randomUUID(), text, timestamp: now, pinned: false, type: classify(text) }, ...get().items],
      );
    },
    togglePin: (id) => commit(get().items.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i))),
    remove: (id) => commit(get().items.filter((i) => i.id !== id)),
    clearUnpinned: () => commit(get().items.filter((i) => i.pinned)),
  };
});

let tracking = false;

export function ensureClipboardTracking(): void {
  if (tracking) return;
  tracking = true;
  void (async () => {
    // Events that arrive while the history loads are queued and applied afterwards.
    const queued: string[] = [];
    let ready = false;
    await listen<string>('clipboard://changed', (e) => {
      if (ready) useClipboardStore.getState().push(e.payload);
      else queued.push(e.payload);
    });
    try {
      diskStore = await load('clipboard.json', { autoSave: 300 } as Parameters<typeof load>[1]);
      const saved = await diskStore.get<PersistedItem[]>(STORE_KEY);
      if (Array.isArray(saved)) {
        const restored = await Promise.all(
          saved.map(async (i): Promise<ClipboardItem | null> => {
            if (!i.enc) return { ...i, type: classify(i.text) }; // re-check entries saved before secret detection existed
            try {
              return { ...i, text: await invoke<string>('dpapi_unprotect', { encoded: i.enc }) };
            } catch {
              return null;
            }
          }),
        );
        useClipboardStore.setState({ items: normalize(restored.filter((i): i is ClipboardItem => !!i)) });
      }
    } catch {
      // Falls back to an in-memory history if the store cannot be read.
    }
    hydrated = true;
    ready = true;
    window.setInterval(() => {
      const { items } = useClipboardStore.getState();
      const kept = normalize(items);
      if (kept.length !== items.length) {
        useClipboardStore.setState({ items: kept });
        persist(kept);
      }
    }, 30_000);
    const current = await readText().catch(() => '');
    // Oldest first so the newest entry ends on top.
    for (const text of [...(current ? [current] : []), ...queued]) useClipboardStore.getState().push(text);
  })();
}

export function useClipboardHistory() {
  ensureClipboardTracking();
  const items = useClipboardStore((s) => s.items);
  const { push, togglePin, remove, clearUnpinned } = useClipboardStore.getState();
  const copyText = async (text: string) => {
    await writeText(text);
    push(text);
  };
  return {
    items,
    copyText,
    copyItem: async (id: string) => {
      const item = useClipboardStore.getState().items.find((i) => i.id === id);
      if (item) await copyText(item.text);
    },
    togglePin,
    deleteItem: remove,
    clearUnpinned,
  };
}
