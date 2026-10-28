import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegionSelection } from '../sdk/types';
import { cn } from './ui';

type Mode = 'draw' | 'region';
interface Activation {
  mode: Mode;
  prompt?: string | null;
}

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  size: number;
  points: Point[];
}

const COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308', '#FFFFFF'];
const SIZES = [3, 6, 12];
const MIN_SELECTION = 8;

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { points, color, size } = stroke;
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length < 3) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Quadratic curves through midpoints give smooth freehand lines.
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

async function closeOverlay() {
  await invoke('close_overlay');
}

function DrawLayer({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);

  const redraw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    [...strokes.current, ...(current.current ? [current.current] : [])].forEach((s) => drawStroke(ctx, s));
  }, []);

  useEffect(() => {
    const resize = () => {
      const el = canvas.current;
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(window.innerWidth * dpr);
      el.height = Math.round(window.innerHeight * dpr);
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw]);

  const undo = () => {
    strokes.current.pop();
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    redraw();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'z' && e.ctrlKey) undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pos = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

  return (
    <>
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        style={{ background: 'rgba(0,0,0,0.01)' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = { color, size, points: [pos(e)] };
          redraw();
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          current.current.points.push(pos(e));
          redraw();
        }}
        onPointerUp={() => {
          if (current.current) strokes.current.push(current.current);
          current.current = null;
          redraw();
        }}
      />
      <div
        className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-pill px-4 py-2 text-white shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Pen size ${s}`}
              onClick={() => setSize(s)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                size === s ? 'bg-white/25' : 'hover:bg-white/10',
              )}
            >
              <span className="rounded-full bg-white" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
        </div>
        <span className="h-5 w-px bg-white/20" />
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={cn('h-5 w-5 rounded-full border-2 transition-transform', color === c ? 'scale-125 border-white' : 'border-transparent')}
              style={{ background: c }}
            />
          ))}
        </div>
        <span className="h-5 w-px bg-white/20" />
        <button type="button" aria-label="Undo" onClick={undo} className="rounded-full p-1.5 hover:bg-white/10">
          <Undo2 size={16} />
        </button>
        <button type="button" aria-label="Clear all" onClick={clear} className="rounded-full p-1.5 hover:bg-white/10">
          <Trash2 size={16} />
        </button>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-white/10">
          <X size={16} />
        </button>
      </div>
    </>
  );
}

function RegionLayer({ prompt, onDone }: { prompt?: string | null; onDone: (r: RegionSelection | null) => void }) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef<Point | null>(null);
  const busy = useRef(false);

  const finish = async (r: { x: number; y: number; w: number; h: number }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await invoke<Omit<RegionSelection, 'region'>>('capture_region', { region: r });
      onDone({ ...result, region: r });
    } catch (err) {
      console.error(err);
      onDone(null);
    }
  };

  const toRect = (a: Point, b: Point) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <div
      className="absolute inset-0 cursor-crosshair touch-none select-none"
      style={{ background: 'rgba(0,0,0,0.18)' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
      }}
      onPointerMove={(e) => {
        if (start.current) setRect(toRect(start.current, { x: e.clientX, y: e.clientY }));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const r = toRect(start.current, { x: e.clientX, y: e.clientY });
        start.current = null;
        if (r.w < MIN_SELECTION || r.h < MIN_SELECTION) {
          setRect(null);
          return;
        }
        // Hide the frame first so it never ends up in the capture.
        setRect(null);
        window.setTimeout(() => void finish(r), 60);
      }}
    >
      {prompt && (
        <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-pill px-4 py-1.5 text-[13px] font-medium text-white shadow-lg">
          {prompt}
        </div>
      )}
      {rect && (
        <div
          className="pointer-events-none absolute border-2 border-white/90"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
            background: 'transparent',
          }}
        />
      )}
    </div>
  );
}

export function OverlayCanvas() {
  const [active, setActive] = useState<Activation | null>(null);

  const cancel = useCallback(async () => {
    await emit('overlay://region-result', null);
    await closeOverlay();
    setActive(null);
  }, []);

  useEffect(() => {
    const un = listen<Activation>('overlay://activate', (e) => setActive(e.payload));
    return () => void un.then((fn) => fn());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (active?.mode === 'draw') {
        void closeOverlay().then(() => setActive(null));
      } else {
        void cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cancel]);

  if (!active) return null;

  return (
    <div className="fixed inset-0">
      {active.mode === 'draw' ? (
        <DrawLayer
          onClose={() => {
            void closeOverlay().then(() => setActive(null));
          }}
        />
      ) : (
        <RegionLayer
          prompt={active.prompt}
          onDone={async (result) => {
            await emit('overlay://region-result', result);
            await closeOverlay();
            setActive(null);
          }}
        />
      )}
    </div>
  );
}
