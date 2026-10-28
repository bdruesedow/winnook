import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect } from 'react';
import { NotchShell } from './components/NotchShell';
import { OverlayCanvas } from './components/OverlayCanvas';
import { ScreenshotEditor } from './components/ScreenshotEditor';
import { useSettingsStore } from './store/useSettingsStore';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const accentHex = useSettingsStore((s) => s.accentHex);
  const glassOpacity = useSettingsStore((s) => s.glassOpacity);

  useEffect(() => {
    document.documentElement.style.setProperty('--glass-alpha', String(glassOpacity));
  }, [glassOpacity]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', hexToRgb(accentHex));
  }, [accentHex]);
}

export default function App() {
  useTheme();
  const label = getCurrentWebviewWindow().label;
  if (label === 'screenshot-editor') return <ScreenshotEditor />;
  return label === 'screen-overlay' ? <OverlayCanvas /> : <NotchShell />;
}
