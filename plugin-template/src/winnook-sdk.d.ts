// Type definitions of the WinNook plugin SDK. `@winnook/sdk` is provided by the host app at runtime.
declare module '@winnook/sdk' {
  import type { ReactNode } from 'react';

  export type PluginSlotType = 'tile-large' | 'tile-small' | 'action-icon' | 'background';
  export type PluginPermission = 'power' | 'media' | 'clipboard' | 'overlay' | 'storage' | 'notifications' | 'cursor' | 'teams';

  export interface ClipboardItem {
    id: string;
    text: string;
    timestamp: number;
    pinned: boolean;
    type: 'text' | 'url' | 'color' | 'code' | 'secret';
  }

  export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    slot: PluginSlotType;
    defaultOrder?: number;
    shortcuts?: Array<{ accelerator: string; actionId: string; description: string }>;
    permissions: PluginPermission[];
  }

  export interface RegionSelection {
    imageBase64: string;
    bounds: { x: number; y: number; w: number; h: number };
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

  export interface PluginContext {
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
      power: { setKeepAwake: (enabled: boolean) => Promise<void> };
      media: { useMediaSession: () => MediaSession };
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
        useCursorTracking: () => {
          normX: number;
          normY: number;
          velocity: number;
          idleSeconds: number;
          x: number;
          y: number;
        };
      };
      teams: {
        useTeamsStatus: () => {
          unreadCount: number;
          isInCall: boolean;
          isMicActive: boolean;
          focusTeams: () => Promise<void>;
        };
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

  export function definePlugin(plugin: NookPlugin): NookPlugin;
  /** Re-renders every `intervalMs` and returns `Date.now()`. */
  export function useNow(intervalMs?: number): number;
}
