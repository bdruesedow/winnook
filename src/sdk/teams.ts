import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

interface TeamsInfo {
  unreadCount: number;
  isInCall: boolean;
  isMicActive: boolean;
}

export interface TeamsStatus extends TeamsInfo {
  focusTeams: () => Promise<void>;
}

const EMPTY: TeamsInfo = { unreadCount: 0, isInCall: false, isMicActive: false };
let state: TeamsInfo = EMPTY;
let started = false;
const listeners = new Set<(s: TeamsInfo) => void>();

function publish(next: TeamsInfo) {
  state = next;
  listeners.forEach((l) => l(next));
}

function start() {
  if (started) return;
  started = true;
  void listen<TeamsInfo>('system://teams-status', (e) => publish(e.payload));
  void invoke<TeamsInfo>('get_teams_status').then(publish).catch(() => undefined);
}

const focusTeams = () => invoke<void>('focus_teams_window');

export function useTeamsStatus(): TeamsStatus {
  const [s, setS] = useState(state);
  useEffect(() => {
    start();
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return { ...s, focusTeams };
}
