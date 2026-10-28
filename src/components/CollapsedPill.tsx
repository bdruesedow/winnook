import { useEffect, useRef } from 'react';
import { useAllPlugins } from '../sdk/PluginRegistry';
import { useNow } from '../sdk';
import { PluginRender } from './PluginRender';

export const PILL_MIN_WIDTH = 110;
export const PILL_MAX_WIDTH = 180;
export const PILL_HEIGHT = 32;
const NEON_SOFT = 'drop-shadow(0 0 2px rgb(var(--accent) / 0.45))';

// Neon glow in the accent color, only used on the collapsed pill.
const NEON = 'drop-shadow(0 0 3px rgb(var(--accent) / 0.9)) drop-shadow(0 0 7px rgb(var(--accent) / 0.45))';

interface Props {
  onWidth: (width: number) => void;
}

export function CollapsedPill({ onWidth }: Props) {
  const now = new Date(useNow(1000));
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { plugins, disabled } = useAllPlugins();
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const report = () => onWidth(Math.ceil(el.getBoundingClientRect().width));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onWidth]);

  const indicators = plugins.filter(
    (p) => p.active && !disabled.includes(p.plugin.manifest.id) && p.plugin.renderPillIndicator,
  );

  return (
    <div className="absolute inset-x-0 top-0 flex justify-center" style={{ height: PILL_HEIGHT }}>
      <div
        ref={inner}
        className="flex w-max items-center justify-between gap-3 px-4 text-white"
        style={{ height: PILL_HEIGHT }}
      >
        <span className="text-[13px] font-medium tabular-nums" style={{ filter: NEON }}>{time}</span>
        <div className="flex items-center gap-1.5 empty:hidden">
          {indicators.map((p) => (
            <span
              key={`${p.plugin.manifest.id}:${p.instanceId}`}
              className="flex items-center"
              style={{ filter: p.plugin.manifest.id === 'nook-buddy' ? NEON_SOFT : NEON }}
            >
              <PluginRender plugin={p.plugin} ctx={p.ctx} kind="renderPillIndicator" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
