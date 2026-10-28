import type { PluginSlotType } from '../sdk/types';

export const COLS = 8;
export const ROWS = 4;
export const LAYOUT_KEY = 'ui.layout';
export const SETTINGS_ITEM_ID = '__settings__';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Placement extends Rect {
  page: number;
}
export type Layout = Record<string, Placement>;
export interface LayoutItem {
  id: string;
  slot: PluginSlotType | 'settings';
}

const DEFAULT_SIZE: Record<LayoutItem['slot'], { w: number; h: number }> = {
  'tile-large': { w: 2, h: 3 },
  'tile-small': { w: 2, h: 1 },
  'action-icon': { w: 1, h: 1 },
  background: { w: 1, h: 1 },
  settings: { w: 1, h: 1 },
};
const SLOT_PRIORITY: LayoutItem['slot'][] = ['settings', 'tile-large', 'tile-small', 'action-icon', 'background'];
const SETTINGS_DEFAULT: Placement = { page: 0, x: COLS - 1, y: ROWS - 2, w: 1, h: 1 };

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inBounds(r: Rect): boolean {
  return r.w >= 1 && r.h >= 1 && r.x >= 0 && r.y >= 0 && r.x + r.w <= COLS && r.y + r.h <= ROWS;
}

function isPlacement(p: unknown): p is Placement {
  const v = p as Placement | undefined;
  return (
    !!v &&
    [v.page, v.x, v.y, v.w, v.h].every((n) => Number.isInteger(n)) &&
    v.page >= 0 &&
    inBounds(v)
  );
}

export function freeAt(rect: Rect, page: number, layout: Layout, ignoreId?: string): boolean {
  return (
    inBounds(rect) &&
    !Object.entries(layout).some(([id, p]) => id !== ignoreId && p.page === page && overlaps(rect, p))
  );
}

export function firstFit(size: { w: number; h: number }, page: number, layout: Layout, ignoreId?: string): Rect | null {
  for (let y = 0; y + size.h <= ROWS; y++) {
    for (let x = 0; x + size.w <= COLS; x++) {
      const rect = { x, y, ...size };
      if (freeAt(rect, page, layout, ignoreId)) return rect;
    }
  }
  return null;
}

/** Turns the stored layout into a complete, collision-free one; unknown or broken entries are auto-placed. */
export function resolveLayout(items: LayoutItem[], stored: Layout | undefined): Layout {
  const out: Layout = {};
  const pending: LayoutItem[] = [];
  const ordered = [...items].sort((a, b) => SLOT_PRIORITY.indexOf(a.slot) - SLOT_PRIORITY.indexOf(b.slot));

  for (const item of ordered) {
    const saved = stored?.[item.id];
    if (isPlacement(saved) && freeAt(saved, saved.page, out)) out[item.id] = saved;
    else if (item.slot === 'settings' && freeAt(SETTINGS_DEFAULT, 0, out)) out[item.id] = SETTINGS_DEFAULT;
    else pending.push(item);
  }
  for (const item of pending) {
    const size = DEFAULT_SIZE[item.slot];
    for (let page = 0; ; page++) {
      const rect = firstFit(size, page, out);
      if (rect) {
        out[item.id] = { page, ...rect };
        break;
      }
    }
  }
  return out;
}

export function pageCount(layout: Layout): number {
  return Math.max(0, ...Object.values(layout).map((p) => p.page)) + 1;
}

/** Removes empty pages so the page indices stay contiguous. */
export function compactPages(layout: Layout): Layout {
  const used = [...new Set(Object.values(layout).map((p) => p.page))].sort((a, b) => a - b);
  return Object.fromEntries(
    Object.entries(layout).map(([id, p]) => [id, { ...p, page: used.indexOf(p.page) }]),
  );
}
