import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Crop,
  FolderOpen,
  Highlighter,
  Minus,
  Pencil,
  Redo2,
  Save,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './ui';

type Tool = 'pen' | 'highlight' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'text' | 'crop';

interface P {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ann =
  | { t: 'pen' | 'highlight'; color: string; size: number; pts: P[] }
  | { t: 'arrow' | 'line' | 'rect' | 'ellipse'; color: string; size: number; a: P; b: P }
  | { t: 'text'; color: string; size: number; p: P; text: string };

interface Snapshot {
  img: HTMLImageElement;
  anns: Ann[];
}

const COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#000000', '#FFFFFF'];
const SIZES = [2, 4, 8];
const MIN_DRAG = 3;

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', icon: <Pencil size={16} /> },
  { id: 'highlight', label: 'Highlighter', icon: <Highlighter size={16} /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={16} /> },
  { id: 'line', label: 'Line', icon: <Minus size={16} /> },
  { id: 'rect', label: 'Rectangle', icon: <Square size={16} /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle size={16} /> },
  { id: 'text', label: 'Text', icon: <Type size={16} /> },
  { id: 'crop', label: 'Crop', icon: <Crop size={16} /> },
];

const fontSize = (size: number) => 16 + size * 4;

function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = `data:image/png;base64,${base64}`;
  });
}

function drawSmooth(ctx: CanvasRenderingContext2D, pts: P[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function drawAnn(ctx: CanvasRenderingContext2D, a: Ann) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = a.size * 2;
  ctx.lineWidth = w;

  if (a.t === 'pen' || a.t === 'highlight') {
    if (a.t === 'highlight') {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = w * 4;
      ctx.lineCap = 'butt';
    }
    if (a.pts.length < 3) {
      ctx.beginPath();
      ctx.arc(a.pts[0].x, a.pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawSmooth(ctx, a.pts);
    }
  } else if (a.t === 'line' || a.t === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(a.a.x, a.a.y);
    ctx.lineTo(a.b.x, a.b.y);
    ctx.stroke();
    if (a.t === 'arrow') {
      const angle = Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x);
      const head = w * 3 + 8;
      ctx.beginPath();
      ctx.moveTo(a.b.x, a.b.y);
      ctx.lineTo(a.b.x - head * Math.cos(angle - Math.PI / 7), a.b.y - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(a.b.x - head * Math.cos(angle + Math.PI / 7), a.b.y - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  } else if (a.t === 'rect') {
    ctx.strokeRect(Math.min(a.a.x, a.b.x), Math.min(a.a.y, a.b.y), Math.abs(a.b.x - a.a.x), Math.abs(a.b.y - a.a.y));
  } else if (a.t === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      (a.a.x + a.b.x) / 2,
      (a.a.y + a.b.y) / 2,
      Math.abs(a.b.x - a.a.x) / 2,
      Math.abs(a.b.y - a.a.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (a.t === 'text') {
    const fs = fontSize(a.size);
    ctx.font = `600 ${fs}px "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    a.text.split('\n').forEach((line, i) => ctx.fillText(line, a.p.x, a.p.y + i * fs * 1.25));
  }
  ctx.restore();
}

function translate(a: Ann, dx: number, dy: number): Ann {
  const mv = (p: P): P => ({ x: p.x + dx, y: p.y + dy });
  if ('pts' in a) return { ...a, pts: a.pts.map(mv) };
  if ('p' in a) return { ...a, p: mv(a.p) };
  return { ...a, a: mv(a.a), b: mv(a.b) };
}

function paint(canvas: HTMLCanvasElement, img: HTMLImageElement, anns: Ann[], draft: Ann | null, crop: Rect | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  [...anns, ...(draft ? [draft] : [])].forEach((a) => drawAnn(ctx, a));
  if (crop) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, canvas.width / 900);
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    ctx.restore();
  }
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-30',
        active ? 'bg-accent text-white' : 'text-zinc-700 hover:bg-black/10 dark:text-zinc-200 dark:hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px bg-black/15 dark:bg-white/20" />;

export function ScreenshotEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [draft, setDraft] = useState<Ann | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [textEdit, setTextEdit] = useState<{ p: P; value: string } | null>(null);
  const [notice, setNotice] = useState<{ msg: string; path?: string } | null>(null);
  const [, setHistoryTick] = useState(0);

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const dragStart = useRef<P | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string, path?: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ msg, path });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const commit = useCallback(
    (nextImg: HTMLImageElement, nextAnns: Ann[]) => {
      if (img) undoStack.current.push({ img, anns });
      redoStack.current = [];
      setImg(nextImg);
      setAnns(nextAnns);
      setHistoryTick((n) => n + 1);
    },
    [img, anns],
  );

  const addAnn = useCallback((a: Ann) => img && commit(img, [...anns, a]), [img, anns, commit]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !img) return;
    redoStack.current.push({ img, anns });
    setImg(prev.img);
    setAnns(prev.anns);
    setCrop(null);
    setHistoryTick((n) => n + 1);
  }, [img, anns]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !img) return;
    undoStack.current.push({ img, anns });
    setImg(next.img);
    setAnns(next.anns);
    setHistoryTick((n) => n + 1);
  }, [img, anns]);

  // New capture: reset everything and copy the untouched shot, like the Snipping Tool.
  const loadBase64 = useCallback(async (base64: string) => {
    const loaded = await loadImage(base64);
    undoStack.current = [];
    redoStack.current = [];
    setImg(loaded);
    setAnns([]);
    setCrop(null);
    setDraft(null);
    setTextEdit(null);
    setHistoryTick((n) => n + 1);
    try {
      const blob = await (await fetch(loaded.src)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      // clipboard may be unavailable; the Copy button reports errors
    }
  }, []);

  useEffect(() => {
    void invoke<string | null>('get_editor_image').then((b) => {
      if (b) void loadBase64(b);
    });
    const un = listen<string>('editor://new-image', (e) => void loadBase64(e.payload));
    return () => void un.then((fn) => fn());
  }, [loadBase64]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    paint(canvas, img, anns, draft, crop);
  }, [img, anns, draft, crop]);

  const render = useCallback(async (): Promise<Blob | null> => {
    if (!img) return null;
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    paint(out, img, anns, null, null);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }, [img, anns]);

  const copy = useCallback(async () => {
    const blob = await render();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard');
    } catch (err) {
      toast(`Copy failed: ${String(err)}`);
    }
  }, [render, toast]);

  const save = useCallback(async () => {
    const blob = await render();
    if (!blob) return;
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(blob);
    });
    try {
      const path = await invoke<string>('save_screenshot', { imageBase64: base64 });
      toast('Saved', path);
    } catch (err) {
      toast(`Save failed: ${String(err)}`);
    }
  }, [render, toast]);

  const applyCrop = useCallback(() => {
    if (!img || !crop || crop.w < 4 || crop.h < 4) return;
    const c = document.createElement('canvas');
    c.width = Math.round(crop.w);
    c.height = Math.round(crop.h);
    c.getContext('2d')?.drawImage(img, -Math.round(crop.x), -Math.round(crop.y));
    const next = new Image();
    next.onload = () => {
      commit(next, anns.map((a) => translate(a, -Math.round(crop.x), -Math.round(crop.y))));
      setCrop(null);
    };
    next.src = c.toDataURL('image/png');
  }, [img, crop, anns, commit]);

  const commitText = useCallback(() => {
    if (textEdit && textEdit.value.trim()) {
      addAnn({ t: 'text', color, size, p: textEdit.p, text: textEdit.value });
    }
    setTextEdit(null);
  }, [textEdit, addAnn, color, size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        if (textEdit) setTextEdit(null);
        else if (crop) setCrop(null);
      } else if (e.key === 'Enter' && crop && !typing) {
        applyCrop();
      } else if (e.ctrlKey && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) undo();
        else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
        else if (k === 's') {
          e.preventDefault();
          void save();
        } else if (k === 'c') void copy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textEdit, crop, applyCrop, undo, redo, save, copy]);

  const toImg = (e: React.PointerEvent): P => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(canvas.width, Math.max(0, ((e.clientX - r.left) * canvas.width) / r.width)),
      y: Math.min(canvas.height, Math.max(0, ((e.clientY - r.top) * canvas.height) / r.height)),
    };
  };

  const toRect = (a: P, b: P): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    e.preventDefault();
    const p = toImg(e);
    if (tool === 'text') {
      if (textEdit) commitText();
      setTextEdit({ p, value: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = p;
    if (tool === 'pen' || tool === 'highlight') setDraft({ t: tool, color, size, pts: [p] });
    else if (tool === 'crop') setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
    else setDraft({ t: tool, color, size, a: p, b: p });
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const p = toImg(e);
    if (tool === 'crop') setCrop(toRect(start, p));
    else if (draft && 'pts' in draft) setDraft({ ...draft, pts: [...draft.pts, p] });
    else if (draft && 'b' in draft) setDraft({ ...draft, b: p });
  };

  const onUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (tool === 'crop') {
      if (crop && (crop.w < MIN_DRAG || crop.h < MIN_DRAG)) setCrop(null);
      return;
    }
    if (!draft) return;
    const tiny = 'b' in draft && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < MIN_DRAG;
    if (!tiny) addAnn(draft);
    setDraft(null);
  };

  const canvas = canvasRef.current;
  const textStyle = (() => {
    if (!textEdit || !canvas) return undefined;
    const r = canvas.getBoundingClientRect();
    const parent = canvas.parentElement!.getBoundingClientRect();
    const k = r.width / canvas.width;
    return {
      left: r.left - parent.left + textEdit.p.x * k,
      top: r.top - parent.top + textEdit.p.y * k,
      fontSize: fontSize(size) * k,
      color,
    };
  })();

  const cropActive = tool === 'crop';

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-zinc-800">
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            label={t.label}
            active={tool === t.id}
            onClick={() => {
              if (textEdit) commitText();
              if (t.id !== 'crop') setCrop(null);
              setTool(t.id);
            }}
          >
            {t.icon}
          </ToolButton>
        ))}
        <Divider />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={cn('mx-0.5 h-5 w-5 rounded-full border-2 transition-transform', color === c ? 'scale-125 border-accent' : 'border-black/20')}
            style={{ background: c }}
          />
        ))}
        <Divider />
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Size ${s}`}
            onClick={() => setSize(s)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              size === s ? 'bg-black/15 dark:bg-white/20' : 'hover:bg-black/10 dark:hover:bg-white/10',
            )}
          >
            <span className="rounded-full bg-current" style={{ width: s * 2 + 2, height: s * 2 + 2 }} />
          </button>
        ))}
        <Divider />
        <ToolButton label="Undo (Ctrl+Z)" disabled={undoStack.current.length === 0} onClick={undo}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton label="Redo (Ctrl+Y)" disabled={redoStack.current.length === 0} onClick={redo}>
          <Redo2 size={16} />
        </ToolButton>
        {cropActive && crop && crop.w >= 4 && (
          <>
            <Divider />
            <button
              type="button"
              onClick={applyCrop}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white"
            >
              <Check size={14} /> Apply crop
            </button>
            <ToolButton label="Cancel crop" onClick={() => setCrop(null)}>
              <X size={16} />
            </ToolButton>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium hover:bg-black/10 dark:hover:bg-white/10"
          >
            <Copy size={14} /> Copy
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white"
          >
            <Save size={14} /> Save
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {img ? (
          <canvas
            ref={canvasRef}
            className={cn('max-h-full max-w-full rounded shadow-2xl', tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
            style={{ touchAction: 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        ) : (
          <div className="text-[13px] text-zinc-500">No screenshot yet</div>
        )}
        {textEdit && textStyle && (
          <textarea
            autoFocus
            value={textEdit.value}
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText();
              }
            }}
            rows={1}
            placeholder="Type…"
            className="absolute min-w-[80px] resize-none border border-dashed border-white/70 bg-black/10 font-semibold leading-tight outline-none"
            style={{ ...textStyle, fontFamily: '"Segoe UI", sans-serif' }}
          />
        )}
        {notice && (
          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-pill px-4 py-1.5 text-[12px] font-medium text-white shadow-lg">
            <span>{notice.msg}</span>
            {notice.path && (
              <button
                type="button"
                onClick={() => void invoke('reveal_in_explorer', { path: notice.path })}
                className="flex items-center gap-1 text-accent hover:underline"
              >
                <FolderOpen size={13} /> Show in folder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
