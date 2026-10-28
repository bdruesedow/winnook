import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { definePlugin } from '@winnook/sdk';
import { formatClock } from '../_store';

function Visualizer({ playing }: { playing: boolean }) {
  return (
    <div className="flex h-4 items-end gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-accent"
          style={{
            height: playing ? undefined : 4,
            animation: playing ? `nook-bar ${0.7 + i * 0.13}s ease-in-out ${i * 0.1}s infinite alternate` : undefined,
          }}
        />
      ))}
    </div>
  );
}

const btn =
  'flex h-8 w-8 items-center justify-center rounded-full text-zinc-800 transition-colors hover:bg-black/10 dark:text-zinc-100 dark:hover:bg-white/15';

export default definePlugin({
  manifest: {
    id: 'media-player',
    name: 'Media Player',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Controls the current system media session',
    slot: 'tile-large',
    defaultOrder: 2,
    permissions: ['media'],
  },
  renderTile(ctx) {
    const m = ctx.system.media.useMediaSession();
    const hasTrack = !!m.title;
    const progress = m.duration > 0 ? Math.min(1, m.position / m.duration) : 0;
    const art = m.albumArtBase64 ? `data:${m.albumArtMime ?? 'image/png'};base64,${m.albumArtBase64}` : null;
    return (
      <div className={`flex h-full flex-col p-2.5 ${m.isPlaying ? 'nook-tile-active' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-black/10 dark:bg-white/10">
            {art ? <img src={art} alt="" className="h-full w-full object-cover" /> : <Music size={20} className="text-accent" />}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatClock(m.position)} / {formatClock(m.duration)}
            </span>
            <Visualizer playing={m.isPlaying} />
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1.5 truncate text-[13px] font-bold text-zinc-900 dark:text-white">
          {hasTrack ? m.title : 'Nothing playing'}
        </div>
        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{m.artist || '\u00A0'}</div>
        <div className="mt-auto flex items-center justify-center gap-3">
          <button type="button" aria-label="Previous" className={btn} onClick={() => void m.prev()}>
            <SkipBack size={16} />
          </button>
          <button type="button" aria-label={m.isPlaying ? 'Pause' : 'Play'} className={btn} onClick={() => void m.playPause()}>
            {m.isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button type="button" aria-label="Next" className={btn} onClick={() => void m.next()}>
            <SkipForward size={16} />
          </button>
        </div>
      </div>
    );
  },
  renderPillIndicator(ctx) {
    const m = ctx.system.media.useMediaSession();
    return m.isPlaying ? <Music size={14} className="text-accent" /> : null;
  },
});
