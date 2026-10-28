import { useEffect, useState } from 'react';
import type { NookPlugin } from './types';

export * from './types';

export function definePlugin(plugin: NookPlugin): NookPlugin {
  return plugin;
}

/** Current timestamp (ms), refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
