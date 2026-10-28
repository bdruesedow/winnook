import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { useEffect } from 'react';
import { useNow } from './index';
import type { MediaSession } from './types';

interface RawMedia {
  title: string;
  artist: string;
  albumArtBase64?: string | null;
  albumArtMime?: string | null;
  position: number;
  duration: number;
  isPlaying: boolean;
}

interface MediaStore {
  info: RawMedia | null;
  fetchedAt: number;
}

const POLL_MS = 1500;
const useMediaStore = create<MediaStore>(() => ({ info: null, fetchedAt: 0 }));

let subscribers = 0;
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    const info = await invoke<RawMedia | null>('media_get_session');
    useMediaStore.setState({ info, fetchedAt: Date.now() });
  } catch {
    useMediaStore.setState({ info: null, fetchedAt: Date.now() });
  }
}

async function control(action: 'playpause' | 'next' | 'prev'): Promise<void> {
  await invoke('media_control', { action });
  window.setTimeout(() => void refresh(), 250);
}

/** Shared polling: one poller regardless of how many components subscribe. */
export function useMediaSession(): MediaSession {
  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) {
      void refresh();
      timer = window.setInterval(() => void refresh(), POLL_MS);
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
  }, []);

  const { info, fetchedAt } = useMediaStore();
  const now = useNow(info?.isPlaying ? 500 : 5000);

  const elapsed = info?.isPlaying ? Math.max(0, (now - fetchedAt) / 1000) : 0;
  const position = info
    ? Math.min(info.duration > 0 ? info.duration : Infinity, info.position + elapsed)
    : 0;

  return {
    title: info?.title ?? '',
    artist: info?.artist ?? '',
    albumArtBase64: info?.albumArtBase64 ?? undefined,
    albumArtMime: info?.albumArtMime ?? undefined,
    position,
    duration: info?.duration ?? 0,
    isPlaying: info?.isPlaying ?? false,
    playPause: () => control('playpause'),
    next: () => control('next'),
    prev: () => control('prev'),
  };
}
