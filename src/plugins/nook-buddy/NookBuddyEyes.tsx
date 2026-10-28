import { motion } from 'framer-motion';
import type { BuddyView } from './useBuddyBrain';

const W = 44;
const H = 24;
const CX = W / 2;
const CY = 12;
const EYE_W = 6;
const EYE_H = 10;
const GAP = 5;
const LEFT = CX - GAP / 2 - EYE_W / 2;
const RIGHT = CX + GAP / 2 + EYE_W / 2;
// Glow lives on the svg itself so the moving wrapper only composites a cached texture.
const NEON = 'drop-shadow(0 0 3px rgb(var(--accent) / 0.75))';

const centered = { transformBox: 'fill-box', transformOrigin: 'center' } as const;

function HeadphonesOverlay({ color, bang }: { color: string; bang: boolean }) {
  return (
    <motion.g
      initial={{ y: -15, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
      style={centered}
    >
      <motion.g
        animate={bang ? { rotate: [-3, 3, -3] } : { rotate: 0 }}
        transition={bang ? { duration: 0.22, repeat: Infinity } : { duration: 0.2 }}
        style={centered}
      >
        <path
          d={`M${LEFT - 8.5} 15 C${LEFT - 8.5} -2 ${RIGHT + 8.5} -2 ${RIGHT + 8.5} 15`}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        <rect x={LEFT - 11} y={10} width={4.5} height={9} rx={2.2} fill={color} />
        <rect x={RIGHT + 6.5} y={10} width={4.5} height={9} rx={2.2} fill={color} />
      </motion.g>
    </motion.g>
  );
}

function CallHeadsetOverlay({ color, mic }: { color: string; mic: boolean }) {
  const led = mic ? '#22C55E' : '#EF4444';
  const tipX = CX;
  const tipY = 21;
  return (
    <motion.g
      initial={{ y: -15, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
      style={centered}
    >
      <path
        d={`M${LEFT - 8.5} 15 C${LEFT - 8.5} -2 ${RIGHT + 8.5} -2 ${RIGHT + 8.5} 15`}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <rect x={LEFT - 11} y={10} width={4.5} height={9} rx={2.2} fill={color} />
      <rect x={RIGHT + 6.5} y={10} width={4.5} height={9} rx={2.2} fill={color} />
      <path
        d={`M${LEFT - 8.7} 18.5 Q${LEFT - 8} 24.5 ${tipX} ${tipY}`}
        fill="none"
        stroke={color}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <motion.circle
        cx={tipX}
        cy={tipY}
        r={1}
        fill={led}
        className={mic ? 'buddy-led' : undefined}
        style={centered}
      />
    </motion.g>
  );
}

function Particles({ kind }: { kind: 'zzz' | 'note' }) {
  const items = kind === 'zzz' ? ['z', 'Z', 'z'] : ['♪'];
  return (
    <>
      {items.map((ch, i) => (
        <text
          key={`${kind}${i}`}
          className={kind === 'zzz' ? 'buddy-zzz' : 'buddy-note'}
          x={kind === 'zzz' ? CX + 9 + i * 3 : RIGHT + 7}
          y={kind === 'zzz' ? 7 : 4}
          fontSize={kind === 'zzz' ? 5 + i * 1.5 : 6}
          fill="white"
          style={{ animationDelay: `${i * 0.8}s` }}
        >
          {ch}
        </text>
      ))}
    </>
  );
}

function Pong() {
  return (
    <>
      <motion.rect
        x={LEFT - 3}
        width={2}
        height={8}
        rx={1}
        fill="white"
        animate={{ y: [CY - 8, CY, CY - 6, CY - 2, CY - 8] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.rect
        x={RIGHT + 1}
        width={2}
        height={8}
        rx={1}
        fill="white"
        animate={{ y: [CY - 2, CY - 8, CY - 1, CY - 7, CY - 2] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.circle
        r={1.5}
        fill="white"
        animate={{ cx: [LEFT, RIGHT, LEFT], cy: [CY - 3, CY + 2, CY - 3] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
    </>
  );
}

function Spiral({ cx, dir }: { cx: number; dir: 1 | -1 }) {
  return (
    <motion.path
      d="M0 0 a1 1 0 0 1 2 0 a2 2 0 0 1 -4 0 a3 3 0 0 1 6 0 a4 4 0 0 1 -8 0"
      transform={`translate(${cx} ${CY})`}
      fill="none"
      stroke="white"
      strokeWidth={1.2}
      strokeLinecap="round"
      animate={{ rotate: dir * 360 }}
      transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
      style={{ ...centered }}
    />
  );
}

function bodyAnimation(v: BuddyView) {
  if (v.state === 'IN_CALL') {
    return v.nodding
      ? { animate: { y: [0, 2, 0, 2, 0] }, transition: { duration: 0.7, ease: 'easeInOut' as const } }
      : { animate: { y: 0 }, transition: { duration: 0.2 } };
  }
  // Looping groove states run as CSS keyframes (compositor) instead of per-frame JS.
  return { animate: {}, transition: {} };
}

function bodyClass(v: BuddyView) {
  if (v.state !== 'JAMMING' || v.silly === 'glance') return undefined;
  if (v.jam === 'HEADBANG') return 'buddy-headbang';
  if (v.jam === 'DANCE') return 'buddy-dance';
  if (v.jam === 'VIBE_CHECK') return 'buddy-vibe';
  return 'buddy-groove';
}

export function NookBuddyEyes({ view, accent }: { view: BuddyView; accent: string }) {
  const { state, jam, silly } = view;
  const jamming = state === 'JAMMING' && silly !== 'glance';
  const rock = jamming && view.accentEyes === 'rock';
  const happy = !view.headset && (view.dodge === 'happy' || view.dodge === 'bye' || (!!view.reaction && view.reaction !== 'nap'));
  const arc = happy || (jamming && view.accentEyes === 'arc');
  const closed = jamming && view.accentEyes === 'closed';
  const bang = jamming && jam === 'HEADBANG';
  const sleeping = state === 'SLEEPING';
  const dizzy = state === 'DIZZY';
  const pong = silly === 'pong';
  const yawn = silly === 'yawn' || view.relief;
  const focused = view.state === 'IN_CALL';
  const blinkNow = view.blinking;

  const body = bodyAnimation(view);
  const glow = view.caffeinated ? `drop-shadow(0 0 3px ${accent})` : undefined;

  const needy = view.need !== null && (state === 'IDLE' || state === 'TRACKING');
  const needScaleY = !needy ? 1 : view.need === 'energy' ? 0.4 : view.need === 'fun' ? 0.6 : view.need === 'love' ? 0.8 : 0.85;
  const eyeTilt = needy && view.need === 'love' ? 1 : 0;

  const eyeTarget = {
    x: view.look.x,
    y: view.look.y,
    rotate: 0,
    scaleX: (yawn ? 1.2 : 1) * view.scale,
    scaleY: (sleeping ? 0.15 : yawn ? 0.25 : focused ? 0.8 : blinkNow ? 0.1 : needScaleY) * view.scale,
  };

  const eyes = [LEFT, RIGHT].map((cx, i) => {
    if (dizzy) return <Spiral key={i} cx={cx} dir={i === 0 ? 1 : -1} />;
    if (arc || closed) {
      return (
        <motion.path
          key={i}
          d={
            arc
              ? `M${cx - 3} ${CY + 2.5} Q${cx} ${CY - 4} ${cx + 3} ${CY + 2.5}`
              : `M${cx - 3} ${CY - 1} Q${cx} ${CY + 5} ${cx + 3} ${CY - 1}`
          }
          fill="none"
          stroke="white"
          strokeWidth={1.8}
          strokeLinecap="round"
          animate={{ scaleY: blinkNow ? 0.2 : 1 }}
          style={centered}
        />
      );
    }
    if (rock) {
      const s = i === 0 ? 1 : -1;
      return (
        <polyline
          key={i}
          points={`${cx - 2.5 * s} ${CY - 3.5} ${cx + 2 * s} ${CY} ${cx - 2.5 * s} ${CY + 3.5}`}
          fill="none"
          stroke="white"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    if (pong) return null;
    return (
      <motion.rect
        key={i}
        x={cx - EYE_W / 2}
        y={CY - EYE_H / 2}
        width={EYE_W}
        height={EYE_H}
        rx={EYE_W / 2}
        fill="white"
        initial={false}
        animate={{ ...eyeTarget, rotate: eyeTilt * (i === 0 ? -14 : 14) }}
        transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
        style={centered}
      />
    );
  });

  return (
    <motion.div
      initial={false}
      animate={{ width: yawn ? W + 14 : W }}
      transition={{ type: 'spring', stiffness: 220, damping: 16 }}
      className="relative flex justify-center"
      style={{ height: H, filter: glow }}
      aria-hidden
    >
      <div className={['flex', bodyClass(view)].filter(Boolean).join(' ')}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} overflow="visible" style={{ filter: NEON }}>
        <motion.g initial={false} animate={body.animate} transition={body.transition} style={centered}>
          {view.headset ? (
            <CallHeadsetOverlay color={accent} mic={view.micActive} />
          ) : (
            view.headphones && <HeadphonesOverlay color={accent} bang={bang} />
          )}
          {eyes}
          {pong && <Pong />}
        </motion.g>
        {needy && view.need === 'hunger' && (
          <g className="buddy-thought">
            <circle cx={RIGHT + 8} cy={4} r={2.6} fill="#d6a56b" />
            <circle cx={RIGHT + 7.2} cy={3.4} r={0.45} fill="#5b3a1a" />
            <circle cx={RIGHT + 9} cy={4.6} r={0.45} fill="#5b3a1a" />
          </g>
        )}
        {needy && view.need === 'love' && (
          <path className="buddy-sweat" d={`M${LEFT - 2} ${CY + 3} q-1.6 2.4 0 3.4 q1.6 -1 0 -3.4z`} fill="#7dd3fc" />
        )}
        {view.reaction && view.reaction !== 'nap' && (
          <text className="buddy-heart" x={RIGHT + 6} y={6} fontSize={7} fill="#f472b6">
            {view.reaction === 'played' ? '★' : '♥'}
          </text>
        )}
        {sleeping && <Particles kind="zzz" />}
        {view.dodge === 'scared' && (
          <path
            className="buddy-sweat"
            d={`M${RIGHT + 7} 2 q-2 3 0 4.2 q2 -1.2 0 -4.2z`}
            fill="#7dd3fc"
          />
        )}
        {view.notes && view.headphones && <Particles kind="note" />}
      </svg>
      </div>
    </motion.div>
  );
}
