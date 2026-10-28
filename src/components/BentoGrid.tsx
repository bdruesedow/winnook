import { AnimatePresence, motion } from 'framer-motion';
import { Check, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { usePluginData, writeData } from '../sdk/PluginContext';
import { usePluginsForSlot, type LoadedPlugin } from '../sdk/PluginRegistry';
import {
  COLS,
  LAYOUT_KEY,
  ROWS,
  SETTINGS_ITEM_ID,
  compactPages,
  firstFit,
  freeAt,
  inBounds,
  overlaps,
  pageCount,
  resolveLayout,
  type Layout,
  type LayoutItem,
  type Placement,
  type Rect,
} from '../store/layout';
import { SETTINGS_VIEW_ID, useShellStore } from '../store/useShellStore';
import { PluginRender } from './PluginRender';
import { SPRING, cn } from './ui';

const SWIPE_THRESHOLD = 40;
const GAP = 10; // matches gap-2.5

const CELL = 'nook-tile rounded-2xl';

function Empty({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-black/10 dark:border-white/10',
        className,
      )}
    />
  );
}

function Tile({ lp, className }: { lp: LoadedPlugin; className?: string }) {
  return (
    <div className={cn(CELL, 'min-h-0 min-w-0 overflow-hidden', className)}>
      <PluginRender key={lp.instanceId} plugin={lp.plugin} ctx={lp.ctx} kind="renderTile" />
    </div>
  );
}

function ActionCell({ lp, className }: { lp: LoadedPlugin; className?: string }) {
  const openFullView = useShellStore((s) => s.openFullView);
  const hasFullView = !!lp.plugin.renderFullView;
  return (
    <div
      role={hasFullView ? 'button' : undefined}
      title={lp.plugin.manifest.name}
      onClick={hasFullView ? () => openFullView(lp.plugin.manifest.id) : undefined}
      className={cn(
        CELL,
        'flex items-center justify-center overflow-hidden transition-colors hover:bg-black/10 dark:hover:bg-white/15',
        hasFullView && 'cursor-pointer',
        className,
      )}
    >
      <PluginRender key={lp.instanceId} plugin={lp.plugin} ctx={lp.ctx} kind="renderActionIcon" />
    </div>
  );
}

function SettingsCell({ className }: { className?: string }) {
  const openFullView = useShellStore((s) => s.openFullView);
  return (
    <button
      type="button"
      title="Settings"
      onClick={() => openFullView(SETTINGS_VIEW_ID)}
      className={cn(
        CELL,
        'flex items-center justify-center text-zinc-700 transition-colors hover:bg-black/10 dark:text-zinc-200 dark:hover:bg-white/15',
        className,
      )}
    >
      <SettingsIcon size={20} />
    </button>
  );
}

/* ---------- edit mode: drag & resize ---------- */

interface Dir {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
}

interface Gesture {
  id: string;
  kind: 'move' | 'resize';
  dir: Dir;
  startX: number;
  startY: number;
  stepX: number;
  stepY: number;
  origin: Placement;
  dx: number;
  dy: number;
  /** Last valid rect (what a resize shows live). */
  rect: Rect;
  /** Where the pointer currently points; may be invalid. */
  attempt: Rect;
  valid: boolean;
  swapWith?: string;
  dropPage?: number;
}

const useGesture = create<{ g: Gesture | null }>(() => ({ g: null }));

const HANDLES: { dir: Dir; cls: string; bar: string }[] = [
  { dir: { r: true }, cls: 'right-0 top-3 bottom-3 w-3 cursor-ew-resize', bar: 'h-5 w-[3px]' },
  { dir: { l: true }, cls: 'left-0 top-3 bottom-3 w-3 cursor-ew-resize', bar: 'h-5 w-[3px]' },
  { dir: { b: true }, cls: 'bottom-0 left-3 right-3 h-3 cursor-ns-resize', bar: 'h-[3px] w-5' },
  { dir: { t: true }, cls: 'top-0 left-3 right-3 h-3 cursor-ns-resize', bar: 'h-[3px] w-5' },
  { dir: { r: true, b: true }, cls: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize', bar: 'h-1.5 w-1.5' },
  { dir: { l: true, t: true }, cls: 'left-0 top-0 h-3 w-3 cursor-nwse-resize', bar: 'h-1.5 w-1.5' },
  { dir: { r: true, t: true }, cls: 'right-0 top-0 h-3 w-3 cursor-nesw-resize', bar: 'h-1.5 w-1.5' },
  { dir: { l: true, b: true }, cls: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize', bar: 'h-1.5 w-1.5' },
];

const area = (r: Rect) => ({ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` });

function PagingDots({
  pages,
  page,
  onSelect,
  dropPage,
}: {
  pages: number;
  page: number;
  onSelect: (i: number) => void;
  dropPage?: number;
}) {
  if (pages <= 1) return null;
  return (
    <div className="absolute bottom-[1px] left-1/2 flex -translate-x-1/2">
      {Array.from({ length: pages }, (_, i) => (
        <button
          key={i}
          type="button"
          data-page-dot={i}
          aria-label={`Page ${i + 1}`}
          onClick={() => onSelect(i)}
          className="flex h-4 w-4 items-center justify-center"
        >
          <span
            className={cn(
              'rounded-full transition-all',
              dropPage === i ? 'h-2.5 w-2.5 bg-accent' : 'h-1.5 w-1.5',
              dropPage !== i && (i === page ? 'bg-accent' : 'bg-black/25 dark:bg-white/30'),
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function BentoGrid() {
  const large = usePluginsForSlot('tile-large');
  const small = usePluginsForSlot('tile-small');
  const actions = usePluginsForSlot('action-icon');
  const stored = usePluginData((s) => s.data[LAYOUT_KEY]) as Layout | undefined;
  const page = useShellStore((s) => s.page);
  const setPage = useShellStore((s) => s.setPage);
  const edit = useShellStore((s) => s.editMode);
  const g = useGesture((s) => s.g);

  const byId = new Map<string, LoadedPlugin>();
  const items: LayoutItem[] = [{ id: SETTINGS_ITEM_ID, slot: 'settings' }];
  for (const lp of [...large, ...small, ...actions]) {
    byId.set(lp.plugin.manifest.id, lp);
    items.push({ id: lp.plugin.manifest.id, slot: lp.plugin.manifest.slot });
  }
  const layout = resolveLayout(items, stored);

  const pages = pageCount(layout) + (edit ? 1 : 0);
  const current = Math.min(page, pages - 1);
  const direction = useRef(1);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(pages - 1, next));
    if (clamped === current) return;
    direction.current = clamped > current ? 1 : -1;
    setPage(clamped);
  };

  // Horizontal trackpad swipe; accumulates deltaX so one gesture flips one page.
  const accumulated = useRef(0);
  const cooldown = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!delta || Date.now() < cooldown.current) return;
    accumulated.current += delta;
    if (Math.abs(accumulated.current) > SWIPE_THRESHOLD * 2) {
      go(current + (accumulated.current > 0 ? 1 : -1));
      accumulated.current = 0;
      cooldown.current = Date.now() + 450;
    }
  };

  useEffect(() => {
    const reset = window.setInterval(() => (accumulated.current = 0), 300);
    return () => window.clearInterval(reset);
  }, []);

  /* ----- gestures (window listeners; state lives in refs so handlers stay stable) ----- */
  const gridRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const onMove = useCallback((e: PointerEvent) => {
    const cur = useGesture.getState().g;
    if (!cur) return;
    const lay = layoutRef.current;
    const o = cur.origin;
    const dx = e.clientX - cur.startX;
    const dy = e.clientY - cur.startY;
    const dc = Math.round(dx / cur.stepX);
    const dr = Math.round(dy / cur.stepY);

    let attempt: Rect;
    if (cur.kind === 'move') {
      attempt = { x: o.x + dc, y: o.y + dr, w: o.w, h: o.h };
    } else {
      let { x, y, w, h } = o;
      if (cur.dir.r) w = Math.max(1, o.w + dc);
      if (cur.dir.l) {
        const c = Math.min(dc, o.w - 1);
        x = o.x + c;
        w = o.w - c;
      }
      if (cur.dir.b) h = Math.max(1, o.h + dr);
      if (cur.dir.t) {
        const c = Math.min(dr, o.h - 1);
        y = o.y + c;
        h = o.h - c;
      }
      attempt = { x, y, w, h };
    }

    let valid = freeAt(attempt, o.page, lay, cur.id);
    let swapWith: string | undefined;
    let dropPage: number | undefined;

    if (cur.kind === 'move') {
      if (!valid && inBounds(attempt)) {
        const hits = Object.entries(lay).filter(
          ([id, p]) => id !== cur.id && p.page === o.page && overlaps(attempt, p),
        );
        if (hits.length === 1 && hits[0][1].w === o.w && hits[0][1].h === o.h) {
          valid = true;
          swapWith = hits[0][0];
        }
      }
      const dot = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-page-dot]');
      const target = dot ? Number(dot.getAttribute('data-page-dot')) : undefined;
      if (target !== undefined && target !== o.page) {
        const fit = firstFit({ w: o.w, h: o.h }, target, lay, cur.id);
        dropPage = target;
        valid = !!fit;
        if (fit) attempt = fit;
        swapWith = undefined;
      }
    }

    useGesture.setState({
      g: { ...cur, dx, dy, attempt, valid, swapWith, dropPage, rect: cur.kind === 'resize' && valid ? attempt : cur.rect },
    });
  }, []);

  const onUp = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const cur = useGesture.getState().g;
    useGesture.setState({ g: null });
    if (!cur) return;
    const lay = layoutRef.current;
    const o = cur.origin;
    const next: Layout = { ...lay };
    if (cur.kind === 'resize') {
      next[cur.id] = { ...o, ...cur.rect };
    } else if (cur.valid) {
      if (cur.swapWith) next[cur.swapWith] = { ...lay[cur.swapWith], x: o.x, y: o.y };
      next[cur.id] = { ...o, ...cur.attempt, page: cur.dropPage ?? o.page };
    } else {
      return;
    }
    writeData(LAYOUT_KEY, compactPages(next));
  }, [onMove]);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      useGesture.setState({ g: null });
    },
    [onMove, onUp],
  );

  const start = (e: React.PointerEvent, id: string, kind: Gesture['kind'], dir: Dir = {}) => {
    const grid = gridRef.current;
    const origin = layoutRef.current[id];
    if (!grid || !origin || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = grid.getBoundingClientRect();
    useGesture.setState({
      g: {
        id,
        kind,
        dir,
        startX: e.clientX,
        startY: e.clientY,
        stepX: (r.width + GAP) / COLS,
        stepY: (r.height + GAP) / ROWS,
        origin,
        dx: 0,
        dy: 0,
        rect: origin,
        attempt: origin,
        valid: true,
      },
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /* ----- render ----- */
  const renderItem = (id: string, p: Placement) => {
    const moving = g?.id === id && g.kind === 'move';
    const resizing = g?.id === id && g.kind === 'resize';
    const rect: Rect = resizing ? g.rect : p;
    const seed = (id.length * 37) % 5;
    const lp = byId.get(id);

    let content = null;
    if (id === SETTINGS_ITEM_ID) content = <SettingsCell className="h-full w-full" />;
    else if (lp) {
      content =
        lp.plugin.manifest.slot === 'action-icon' ? (
          <ActionCell lp={lp} className="h-full w-full" />
        ) : (
          <Tile lp={lp} className="h-full w-full" />
        );
    }

    return (
      <div
        key={id}
        style={{ ...area(rect), zIndex: moving ? 30 : 1 }}
        className={cn('relative min-h-0 min-w-0', moving && 'pointer-events-none')}
      >
        <motion.div
          className={cn('h-full w-full', moving && 'drop-shadow-xl')}
          initial={false}
          animate={
            !edit
              ? { rotate: 0, x: 0, y: 0, scale: 1 }
              : moving
                ? { x: g.dx, y: g.dy, scale: 1.06, rotate: [-2.2, 2.2] }
                : { x: 0, y: 0, scale: 1, rotate: resizing ? 0 : [-0.7, 0.7] }
          }
          transition={
            moving
              ? { x: { duration: 0 }, y: { duration: 0 }, scale: { duration: 0.12 }, rotate: { duration: 0.1, repeat: Infinity, repeatType: 'mirror' } }
              : edit
                ? { rotate: { duration: 0.13 + seed * 0.012, repeat: Infinity, repeatType: 'mirror', delay: seed * 0.03 }, default: { duration: 0.12 } }
                : { duration: 0.15 }
          }
        >
          {content}
        </motion.div>
        {edit && (
          <>
            <div
              onPointerDown={(e) => start(e, id, 'move')}
              className={cn(
                'absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-accent/50',
                moving ? 'cursor-grabbing' : 'cursor-grab',
              )}
            />
            {!moving &&
              HANDLES.map((h, i) => (
                <div
                  key={i}
                  onPointerDown={(e) => start(e, id, 'resize', h.dir)}
                  className={cn('absolute z-20 flex items-center justify-center', h.cls)}
                >
                  <span className={cn('rounded-full bg-accent/80', h.bar)} />
                </div>
              ))}
          </>
        )}
      </div>
    );
  };

  const pageItems = Object.entries(layout).filter(([, p]) => p.page === current);

  return (
    <div className={cn('relative h-full w-full p-3', edit && 'pb-8')} onWheel={onWheel}>
      <AnimatePresence initial={false} mode="popLayout" custom={direction.current}>
        <motion.div
          key={current}
          custom={direction.current}
          className="relative h-full w-full"
          variants={{
            enter: (d: number) => ({ x: 40 * d, opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit: (d: number) => ({ x: -40 * d, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SPRING}
        >
          {edit && (
            <div
              className="absolute inset-0 grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}
            >
              {Array.from({ length: COLS * ROWS }, (_, i) => (
                <Empty key={i} />
              ))}
            </div>
          )}
          <div
            ref={gridRef}
            className="relative grid h-full w-full gap-2.5"
            style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}
          >
            {pageItems.map(([id, p]) => renderItem(id, p))}
            {g?.kind === 'move' && g.dropPage === undefined && (
              <div
                style={{ ...area(g.attempt), zIndex: 2 }}
                className={cn(
                  'pointer-events-none rounded-2xl border-2 border-dashed',
                  g.valid ? 'border-accent bg-accent/15' : 'border-red-500/70 bg-red-500/10',
                )}
              />
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {edit && (
        <div className="absolute bottom-1 left-3 right-3 flex items-center justify-between text-[10px]">
          <span className="rounded-full bg-accent/20 px-2 py-0.5 font-semibold text-accent">
            Editing layout · drag to move, pull edges to resize
          </span>
          <button
            type="button"
            onClick={() => useShellStore.getState().setEditMode(false)}
            className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 font-semibold text-white"
          >
            <Check size={11} /> Done
          </button>
        </div>
      )}
      <PagingDots pages={pages} page={current} onSelect={go} dropPage={g?.kind === 'move' ? g.dropPage : undefined} />
    </div>
  );
}
