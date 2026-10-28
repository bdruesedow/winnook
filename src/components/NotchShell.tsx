import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOVER_DELAY_MS, useSettingsStore, type Position } from '../store/useSettingsStore';
import { useShellStore } from '../store/useShellStore';
import { BentoGrid } from './BentoGrid';
import { CollapsedPill, PILL_HEIGHT, PILL_MAX_WIDTH, PILL_MIN_WIDTH } from './CollapsedPill';
import { FullView } from './FullView';
import { SPRING, cn } from './ui';
import { ViewBoundary } from './ViewBoundary';

export const WINDOW_WIDTH = 720;
const TOP_GAP = 6;
const EXPANDED = { w: 660, h: 250 };
const FULL = { w: 660, h: 350 };
const PILL_RADIUS = PILL_HEIGHT / 2;
const PANEL_RADIUS = 24;
const HIT_PADDING_COLLAPSED = 6;
const HIT_PADDING_EXPANDED = 12;
const PROGRAMMATIC_OPEN_TIMEOUT_MS = 10_000;

const ALIGN: Record<Position, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

function alignX(position: Position, width: number): number {
  if (position === 'left') return 0;
  if (position === 'right') return WINDOW_WIDTH - width;
  return (WINDOW_WIDTH - width) / 2;
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function NotchShell() {
  const view = useShellStore((s) => s.view);
  const toast = useShellStore((s) => s.toast);
  const position = useSettingsStore((s) => s.position);
  const material = useSettingsStore((s) => s.material);

  const [pillWidth, setPillWidth] = useState(PILL_MIN_WIDTH);
  const onPillWidth = useCallback(
    (w: number) => setPillWidth(Math.min(PILL_MAX_WIDTH, Math.max(PILL_MIN_WIDTH, w))),
    [],
  );

  const collapsed = view.kind === 'collapsed';
  const size = collapsed
    ? { w: pillWidth, h: PILL_HEIGHT }
    : view.kind === 'expanded'
      ? EXPANDED
      : FULL;

  // Tell Rust which area is interactive; it toggles click-through based on the cursor.
  useEffect(() => {
    const pad = collapsed ? HIT_PADDING_COLLAPSED : HIT_PADDING_EXPANDED;
    const x = alignX(position, size.w) - pad;
    void invoke('set_hit_rect', {
      rect: { x, y: 0, w: size.w + pad * 2, h: TOP_GAP + size.h + pad },
    });
  }, [collapsed, position, size.w, size.h]);

  // Hover handling driven by the Rust cursor poller.
  const cursorInside = useRef(false);
  // Entering/leaving edit mode resizes the panel under the cursor; give the user time to move back in.
  const graceUntil = useRef(0);
  const editMode = useShellStore((s) => s.editMode);
  useEffect(() => {
    graceUntil.current = Date.now() + 2000;
  }, [editMode]);
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let hoverTimer: number | undefined;
    let pendingBlur: ((e: FocusEvent) => void) | null = null;

    const collapseNow = () => {
      if (pendingBlur) {
        document.removeEventListener('focusout', pendingBlur);
        pendingBlur = null;
      }
      useShellStore.getState().collapse();
    };

    const unlisten = Promise.all([
      win.listen('notch://cursor-enter', () => {
        cursorInside.current = true;
        if (pendingBlur) {
          document.removeEventListener('focusout', pendingBlur);
          pendingBlur = null;
        }
        const shell = useShellStore.getState();
        if (shell.view.kind !== 'collapsed') {
          useShellStore.setState({ openedBy: 'hover' });
          return;
        }
        const delay = HOVER_DELAY_MS[useSettingsStore.getState().hoverDelay];
        hoverTimer = window.setTimeout(() => {
          if (cursorInside.current) useShellStore.getState().expand('hover');
        }, delay);
      }),
      win.listen('notch://cursor-leave', () => {
        cursorInside.current = false;
        window.clearTimeout(hoverTimer);
        if (useShellStore.getState().view.kind === 'collapsed') return;
        const wait = graceUntil.current - Date.now();
        if (wait > 0) {
          window.setTimeout(() => {
            if (!cursorInside.current && useShellStore.getState().view.kind !== 'collapsed') collapseNow();
          }, wait);
          return;
        }
        if (isTyping()) {
          // Don't yank the notch away while the user is typing; collapse once focus leaves.
          pendingBlur = () => window.setTimeout(() => !cursorInside.current && !isTyping() && collapseNow(), 0);
          document.addEventListener('focusout', pendingBlur);
        } else {
          collapseNow();
        }
      }),
    ]);

    return () => {
      window.clearTimeout(hoverTimer);
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  // A plugin-opened notch (e.g. a reminder) closes by itself if the cursor never arrives.
  const openedBy = useShellStore((s) => s.openedBy);
  useEffect(() => {
    if (collapsed || openedBy !== 'plugin') return;
    const id = window.setTimeout(() => {
      if (!cursorInside.current) useShellStore.getState().collapse();
    }, PROGRAMMATIC_OPEN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [collapsed, openedBy, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const shell = useShellStore.getState();
      if (shell.editMode) shell.setEditMode(false);
      else if (shell.view.kind === 'full') shell.closeFullView();
      else shell.collapse();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const viewKey = view.kind === 'full' ? `full:${view.pluginId}` : view.kind;

  return (
    <div className={cn('relative flex h-screen w-screen items-start', ALIGN[position])}>
      <motion.div
        className="relative overflow-hidden text-zinc-900 dark:text-zinc-100"
        style={{ marginTop: TOP_GAP }}
        initial={false}
        animate={{
          width: size.w,
          height: size.h,
          borderRadius: collapsed ? PILL_RADIUS : PANEL_RADIUS,
        }}
        transition={SPRING}
      >
        <motion.div
          className="absolute inset-0 bg-pill"
          initial={false}
          animate={{ opacity: collapsed ? 1 : 0 }}
          transition={{ duration: 0.18 }}
        />
        <motion.div
          className={cn(
            'absolute inset-0',
            material === 'glass'
              ? 'nook-glass border border-white/20 backdrop-blur-xl'
              : 'bg-stone-100 dark:bg-zinc-900',
          )}
          style={{ borderRadius: 'inherit' }}
          initial={false}
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={{ duration: 0.18 }}
        />

        {/* Kept mounted so pill indicators of background plugins keep their state while expanded. */}
        <motion.div
          initial={false}
          animate={{ opacity: collapsed ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ pointerEvents: collapsed ? 'auto' : 'none' }}
        >
          <CollapsedPill onWidth={onPillWidth} />
        </motion.div>

        {/* Fade-in only: exit animations (AnimatePresence "wait") could get stuck and leave the view blank. */}
        {!collapsed && (
          <motion.div
            key={viewKey}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.14 }}
          >
            <ViewBoundary key={viewKey}>
              {view.kind === 'full' ? <FullView pluginId={view.pluginId} /> : <BentoGrid />}
            </ViewBoundary>
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            className="pointer-events-none absolute left-0 right-0 flex"
            style={{ top: TOP_GAP + size.h + 10, justifyContent: position === 'left' ? 'flex-start' : position === 'right' ? 'flex-end' : 'center' }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING}
          >
            <div className="max-w-[640px] truncate rounded-full bg-pill px-4 py-1.5 text-[12px] font-medium text-white shadow-lg">
              {toast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
