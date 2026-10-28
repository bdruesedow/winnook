import { invoke } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { load, type Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand';

export type Theme = 'auto' | 'dark' | 'light';
export type Accent = 'wallpaper' | 'windows' | 'violet' | 'custom';
export type Material = 'glass' | 'solid';
export type Position = 'left' | 'center' | 'right';
export type MonitorMode = 'primary' | 'follow';
export type HoverDelay = 'fast' | 'normal' | 'calm';

export type NookBuddyMode = 'off' | 'subtle' | 'playful';

export const HOVER_DELAY_MS: Record<HoverDelay, number> = { fast: 50, normal: 180, calm: 400 };
export const VIOLET = '#7C3AED';

export interface Settings {
  theme: Theme;
  accent: Accent;
  customAccent: string;
  material: Material;
  /** Background opacity of the glass material, 0.5–1. */
  glassOpacity: number;
  position: Position;
  monitor: MonitorMode;
  hoverDelay: HoverDelay;
  nookBuddy: NookBuddyMode;
  alwaysOnTop: boolean;
  launchAtStartup: boolean;
  keepStatusActive: boolean;
  devMode: boolean;
  devDir: string;
}

const DEFAULTS: Settings = {
  theme: 'light',
  accent: 'violet',
  customAccent: '#F97316',
  material: 'glass',
  glassOpacity: 0.92,
  position: 'center',
  monitor: 'primary',
  hoverDelay: 'normal',
  nookBuddy: 'playful',
  alwaysOnTop: true,
  launchAtStartup: false,
  keepStatusActive: true,
  devMode: false,
  devDir: '',
};

interface SettingsStore extends Settings {
  loaded: boolean;
  /** Resolved `#RRGGBB` for the current accent mode. */
  accentHex: string;
  /** Only the notch window applies native side effects (position, autostart, ...). */
  init: (applyEffects: boolean) => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

let store: Store | null = null;
let effectsEnabled = false;

async function resolveAccent(accent: Accent, custom: string): Promise<string> {
  try {
    if (accent === 'custom') return custom;
    if (accent === 'windows') return await invoke<string>('get_windows_accent');
    if (accent === 'wallpaper') return await invoke<string>('get_wallpaper_color');
  } catch {
    // fall through to violet
  }
  return VIOLET;
}

async function applyEffect<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  if (!effectsEnabled) return;
  switch (key) {
    case 'position':
      await invoke('set_notch_position', { position: value });
      break;
    case 'monitor':
      await invoke('set_monitor_mode', { mode: value });
      break;
    case 'alwaysOnTop':
      await invoke('set_always_on_top', { enabled: value });
      break;
    case 'launchAtStartup':
      if (value) await enable();
      else await disable();
      break;
  }
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULTS,
  loaded: false,
  accentHex: VIOLET,

  init: async (applyEffects) => {
    effectsEnabled = applyEffects;
    store = await load('settings.json', { autoSave: 200 } as Parameters<typeof load>[1]);
    const stored: Partial<Settings> = {};
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      const value = await store.get<Settings[typeof key]>(key);
      if (value !== undefined && value !== null) (stored as Record<string, unknown>)[key] = value;
    }
    const merged: Settings = { ...DEFAULTS, ...stored };
    if (applyEffects) {
      try {
        merged.launchAtStartup = await isEnabled();
      } catch {
        // autostart unavailable (e.g. dev build); keep stored value
      }
    }
    set({ ...merged, loaded: true, accentHex: await resolveAccent(merged.accent, merged.customAccent) });

    if (applyEffects) {
      await Promise.allSettled([
        applyEffect('position', merged.position),
        applyEffect('monitor', merged.monitor),
        applyEffect('alwaysOnTop', merged.alwaysOnTop),
      ]);
    }
  },

  set: async (key, value) => {
    set({ [key]: value } as Partial<SettingsStore>);
    if (key === 'accent' || key === 'customAccent') {
      const s = useSettingsStore.getState();
      set({ accentHex: await resolveAccent(s.accent, s.customAccent) });
    }
    await store?.set(key, value);
    try {
      await applyEffect(key, value);
    } catch (err) {
      console.error(`Failed to apply setting ${key}`, err);
      if (key === 'launchAtStartup') set({ launchAtStartup: !value });
    }
  },
}));
