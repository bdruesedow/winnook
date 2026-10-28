import { useEffect, useRef, useState } from 'react';
import type { CursorTracking, MediaSession } from '../../sdk/types';
import type { NookBuddyMode } from '../../store/useSettingsStore';
import type { DodgeMood } from '../../store/useDodgeStore';

export type BuddyState = 'IDLE' | 'TRACKING' | 'DIZZY' | 'STARTLED' | 'BORED' | 'SLEEPING' | 'JAMMING' | 'IN_CALL';
export type JamMode = 'GROOVE' | 'VIBE_CHECK' | 'HEADBANG' | 'DANCE';
export type AccentEyes = 'arc' | 'closed' | 'rock' | null;
export type Silly = 'yawn' | 'sideEye' | 'pong' | 'glance' | null;

export interface BuddyView {
  /** The pill is dodging the mouse (scared), returned (happy) or leaving (bye). */
  dodge: DodgeMood;
  state: BuddyState;
  jam: JamMode;
  /** Short-lived alternative eye shape; null = normal capsule eyes. */
  accentEyes: AccentEyes;
  silly: Silly;
  look: { x: number; y: number };
  blinking: boolean;
  headphones: boolean;
  headset: boolean;
  micActive: boolean;
  /** Increments per understanding nod. */
  nodding: boolean;
  relief: boolean;
  caffeinated: boolean;
  /** Eye scale multiplier (caffeinated / startled). */
  scale: number;
  notes: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const ROCK_WORDS = /rock|metal|punk|edm|techno|hardcore|rammstein|metallica|ac\/dc|slipknot|prodigy|dubstep|hardstyle/i;

const NOTCH_CENTER = { x: 360, y: 16 };
const DIZZY_ANGLE = 720;
const STARTLE_VELOCITY = 1800;
const TRACK_AREA_Y = 300;

interface Params {
  mode: NookBuddyMode;
  cursor: CursorTracking;
  media: Pick<MediaSession, 'isPlaying' | 'title' | 'artist'>;
  caffeinated: boolean;
  /** Teams call state (local detection). */
  call: { isInCall: boolean; isMicActive: boolean };
  /** True while the notch is expanded (user interaction). */
  interacting: boolean;
  dodge: DodgeMood;
}

/** setTimeout helper whose timers are cleared on unmount. */
function useLater() {
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const set = timers.current;
    return () => set.forEach((t) => window.clearTimeout(t));
  }, []);
  return useRef((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }).current;
}

export function useBuddyBrain({ mode, cursor, media, caffeinated, call, interacting, dodge }: Params): BuddyView {
  const playful = mode === 'playful';
  const inCall = call.isInCall && mode !== 'off';
  const [nodding, setNodding] = useState(false);
  const [callLook, setCallLook] = useState(0);
  const [relief, setRelief] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [saccade, setSaccade] = useState({ x: 0, y: 0 });
  const [dizzy, setDizzy] = useState(false);
  const [startled, setStartled] = useState(false);
  const [silly, setSilly] = useState<Silly>(null);
  const [jam, setJam] = useState<JamMode>('GROOVE');
  const [accentEyes, setAccentEyes] = useState<AccentEyes>(null);
  const [boredSince, setBoredSince] = useState(() => Date.now());
  const [glanceLook, setGlanceLook] = useState(1);
  const later = useLater();

  const music = media.isPlaying && playful && !inCall;
  const rockish = ROCK_WORDS.test(`${media.title} ${media.artist}`);
  const live = useRef({ music, rockish });
  live.current = { music, rockish };

  /* ---- dizzy (circling) and startled (fast approach) detection ---- */
  const track = useRef({ angles: [] as Array<{ t: number; a: number }>, lastDist: Infinity, lastStartle: 0 });
  useEffect(() => {
    if (!playful || cursor.velocity === 0) return;
    const t = track.current;
    const dx = cursor.x - NOTCH_CENTER.x;
    const dy = cursor.y - NOTCH_CENTER.y;
    const dist = Math.hypot(dx, dy);
    const now = Date.now();

    if (
      cursor.velocity > STARTLE_VELOCITY &&
      dist < t.lastDist - 8 &&
      dist < 160 &&
      now - t.lastStartle > 3000 &&
      !live.current.music
    ) {
      t.lastStartle = now;
      setStartled(true);
      later(() => setStartled(false), 200);
    }
    t.lastDist = dist;

    if (dist > 20 && dist < 400) {
      t.angles.push({ t: now, a: Math.atan2(dy, dx) });
      while (t.angles.length && now - t.angles[0].t > 2000) t.angles.shift();
      let total = 0;
      for (let i = 1; i < t.angles.length; i++) {
        let d = t.angles[i].a - t.angles[i - 1].a;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      if (Math.abs(total) * (180 / Math.PI) > DIZZY_ANGLE) {
        t.angles.length = 0;
        setDizzy(true);
        later(() => setDizzy(false), 3000);
      }
    }
  }, [cursor, playful, later]);

  /* ---- interaction / music reset boredom ---- */
  useEffect(() => {
    if (interacting || music) setBoredSince(Date.now());
  }, [interacting, music]);

  /* ---- natural blinking (2.5–6 s, 15% double blink) ---- */
  useEffect(() => {
    if (mode === 'off') return;
    let alive = true;
    let id = 0;
    const blink = (double: boolean) => {
      setBlinking(true);
      id = window.setTimeout(() => {
        setBlinking(false);
        if (double) id = window.setTimeout(() => alive && blink(false), 140);
      }, 130);
    };
    const schedule = () => {
      id = window.setTimeout(() => {
        if (!alive) return;
        blink(Math.random() < 0.15);
        schedule();
      }, rand(2500, 6000));
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [mode]);

  /* ---- random saccades ---- */
  useEffect(() => {
    if (mode === 'off') return;
    let alive = true;
    let id = 0;
    const schedule = () => {
      id = window.setTimeout(() => {
        if (!alive) return;
        setSaccade(pick([{ x: -3, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 2.5 }, { x: -2, y: 2 }, { x: 2, y: 2 }]));
        id = window.setTimeout(() => alive && setSaccade({ x: 0, y: 0 }), rand(500, 1000));
        schedule();
      }, rand(3500, 8000));
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [mode]);

  /* ---- bored / silly micro animations ---- */
  const sleepy = playful && !music && cursor.idleSeconds > 300;
  const bored = playful && !music && !sleepy && !interacting && !inCall;
  useEffect(() => {
    if (!bored) return;
    let alive = true;
    let id = 0;
    const run = () => {
      if (!alive) return;
      const kind = pick<Silly>(['yawn', 'sideEye', 'pong']);
      setSilly(kind);
      id = window.setTimeout(
        () => {
          setSilly(null);
          id = window.setTimeout(run, rand(30_000, 60_000));
        },
        kind === 'pong' ? 4000 : 1800,
      );
    };
    id = window.setTimeout(run, Math.max(0, 60_000 - (Date.now() - boredSince)));
    return () => {
      alive = false;
      window.clearTimeout(id);
      setSilly((s) => (s === 'glance' ? s : null));
    };
  }, [bored, boredSince]);

  /* ---- jamming: mostly normal eyes, short accents (vibe check, headbang/dance bursts) ---- */
  const jamRef = useRef<JamMode>('GROOVE');
  jamRef.current = jam;
  useEffect(() => {
    if (!music) {
      setJam('GROOVE');
      setAccentEyes(null);
      return;
    }
    let alive = true;
    const ids: number[] = [];
    const after = (fn: () => void, ms: number) => ids.push(window.setTimeout(() => alive && fn(), ms));
    const vibe = () =>
      after(() => {
        if (jamRef.current === 'GROOVE') {
          setJam('VIBE_CHECK');
          setAccentEyes(pick<AccentEyes>(['arc', 'closed']));
          after(() => {
            if (jamRef.current === 'VIBE_CHECK') {
              setJam('GROOVE');
              setAccentEyes(null);
            }
          }, 2500);
        }
        vibe();
      }, rand(25_000, 40_000));
    const burst = () =>
      after(
        () => {
          const kind: JamMode = live.current.rockish || Math.random() < 0.5 ? 'HEADBANG' : 'DANCE';
          setJam(kind);
          if (kind === 'HEADBANG') {
            setAccentEyes('rock');
            after(() => setAccentEyes(null), 2000);
          } else {
            setAccentEyes(null);
          }
          after(() => {
            setJam('GROOVE');
            setAccentEyes(null);
          }, rand(3000, 4000));
          burst();
        },
        rand(30_000, 45_000) * (caffeinated ? 0.5 : 1),
      );
    vibe();
    burst();
    return () => {
      alive = false;
      ids.forEach((i) => window.clearTimeout(i));
    };
  }, [music, caffeinated]);

  /* ---- track change: double quick blink, glance right at the music info, keep grooving ---- */
  const lastTitle = useRef(media.title);
  useEffect(() => {
    const changed = lastTitle.current !== media.title;
    lastTitle.current = media.title;
    if (!changed || !live.current.music) return;
    setBlinking(true);
    later(() => setBlinking(false), 90);
    later(() => setBlinking(true), 180);
    later(() => setBlinking(false), 270);
    later(() => {
      setSilly('glance');
      setGlanceLook(1);
      later(() => setSilly(null), 900);
    }, 350);
  }, [media.title, later]);
  /* ---- meeting focus: understanding nods every 8–15 s, attentive glances ---- */
  useEffect(() => {
    if (!inCall) return;
    let alive = true;
    const ids: number[] = [];
    const nod = () => {
      ids.push(
        window.setTimeout(() => {
          if (!alive) return;
          setNodding(true);
          ids.push(window.setTimeout(() => alive && setNodding(false), 700));
          nod();
        }, rand(8000, 15000)),
      );
    };
    const glance = () => {
      ids.push(
        window.setTimeout(() => {
          if (!alive) return;
          setCallLook(pick([-3, 3, 0]));
          glance();
        }, rand(4000, 9000)),
      );
    };
    nod();
    glance();
    return () => {
      alive = false;
      ids.forEach((i) => window.clearTimeout(i));
      setNodding(false);
      setCallLook(0);
    };
  }, [inCall]);

  /* ---- call ended: take the headset off and sigh ---- */
  const wasInCall = useRef(false);
  useEffect(() => {
    if (wasInCall.current && !inCall) {
      setRelief(true);
      later(() => setRelief(false), 2000);
    }
    wasInCall.current = inCall;
  }, [inCall, later]);

  /* ---- compose ---- */
  let state: BuddyState = 'IDLE';
  if (inCall) state = 'IN_CALL';
  else if (!inCall && dodge !== 'none') state = 'STARTLED';
  else if (dizzy) state = 'DIZZY';
  else if (startled) state = 'STARTLED';
  else if (silly === 'glance') state = 'JAMMING';
  else if (silly) state = 'BORED';
  else if (sleepy) state = 'SLEEPING';
  else if (music) state = 'JAMMING';
  else if (playful && cursor.idleSeconds < 3 && cursor.y < TRACK_AREA_Y)
    state = 'TRACKING';

  let look = { ...saccade };
  if (state === 'TRACKING') look = { x: cursor.normX * 4, y: Math.max(0, cursor.normY) * 3 };
  if (state === 'BORED' && silly === 'sideEye') look = { x: -4, y: 0 };
  if (silly === 'glance') look = { x: glanceLook * 4, y: -1 };
  if (state === 'JAMMING' && silly !== 'glance') {
    const follows = playful && cursor.idleSeconds < 3 && cursor.y < TRACK_AREA_Y;
    look = follows ? { x: cursor.normX * 4, y: Math.max(0, cursor.normY) * 3 } : { ...saccade };
  }
  if (state === 'SLEEPING' || state === 'DIZZY') look = { x: 0, y: 0 };
  if (state === 'IN_CALL') look = { x: callLook, y: 0 };
  if (!inCall && dodge === 'scared') look = { x: cursor.normX * 4, y: 0 };
  if (!inCall && dodge === 'bye') look = { x: 0, y: -1 };

  return {
    dodge: inCall ? 'none' : dodge,
    state,
    jam,
    accentEyes,
    silly,
    look,
    blinking,
    headphones: music,
    headset: inCall,
    micActive: call.isMicActive,
    nodding,
    relief,
    caffeinated,
    scale: (startled || (!inCall && dodge === 'scared') ? 1.35 : 1) * (caffeinated ? 1.15 : 1),
    notes: music && jam === 'GROOVE',
  };
}
