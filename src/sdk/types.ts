import type { ReactNode } from 'react';

export type PluginSlotType = 'tile-large' | 'tile-small' | 'action-icon' | 'background';

export type PluginPermission =
  | 'power'
  | 'media'
  | 'clipboard'
  | 'overlay'
  | 'storage'
  | 'notifications'
  | 'cursor'
  | 'teams';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  slot: PluginSlotType;
  defaultOrder?: number;
  shortcuts?: Array<{
    accelerator: string; // e.g. "Ctrl+Alt+C"
    actionId: string;
    description: string;
  }>;
  permissions: PluginPermission[];
}

export interface RegionSelection {
  imageBase64: string;
  bounds: { x: number; y: number; w: number; h: number };
  /** Selection in logical px relative to the overlay window (input for `detect_font`). */
  region: { x: number; y: number; w: number; h: number };
}

export interface MediaSession {
  title: string;
  artist: string;
  albumArtBase64?: string;
  albumArtMime?: string;
  position: number;
  duration: number;
  isPlaying: boolean;
  playPause: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
}

export interface ClipboardItem {
  id: string;
  text: string;
  timestamp: number;
  pinned: boolean;
  type: 'text' | 'url' | 'color' | 'code' | 'secret';
}

export interface CursorTracking {
  /** -1..1 relative to the notch center (left → right). */
  normX: number;
  /** -1..1 relative to the notch (up → down). */
  normY: number;
  /** Cursor speed in logical px/s. */
  velocity: number;
  idleSeconds: number;
  /** Cursor position in logical px relative to the notch window. */
  x: number;
  y: number;
}

export interface TeamsStatus {
  unreadCount: number;
  isInCall: boolean;
  isMicActive: boolean;
  focusTeams: () => Promise<void>;
}

export interface PluginContext {
  /** Reactive per-plugin state, persisted automatically as JSON. */
  usePluginStore: <T>(key: string, initialValue: T) => [T, (val: T | ((prev: T) => T)) => void];

  shell: {
    expand: () => void;
    collapse: () => void;
    openFullView: (pluginId: string) => void;
    closeFullView: () => void;
    playChime: () => void;
    showToast: (msg: string) => void;
  };

  system: {
    power: {
      setKeepAwake: (enabled: boolean) => Promise<void>;
    };
    media: {
      useMediaSession: () => MediaSession;
    };
    clipboard: {
      useClipboardHistory: () => {
        items: ClipboardItem[];
        copyItem: (id: string) => Promise<void>;
        copyText: (text: string) => Promise<void>;
        togglePin: (id: string) => void;
        deleteItem: (id: string) => void;
        clearUnpinned: () => void;
      };
    };
    cursor: {
      useCursorTracking: () => CursorTracking;
    };
    teams: {
      useTeamsStatus: () => TeamsStatus;
    };
    overlay: {
      openDrawingOverlay: () => Promise<void>;
      openRegionSelector: (promptText: string) => Promise<RegionSelection | null>;
    };
  };
}

export interface NookPlugin {
  manifest: PluginManifest;
  onInit?: (ctx: PluginContext) => void | (() => void);
  onShortcut?: (actionId: string, ctx: PluginContext) => void;

  renderTile?: (ctx: PluginContext) => ReactNode;
  renderActionIcon?: (ctx: PluginContext) => ReactNode;
  renderFullView?: (ctx: PluginContext) => ReactNode;
  renderPillIndicator?: (ctx: PluginContext) => ReactNode | null;
}
