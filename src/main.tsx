import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { definePlugin, useNow } from './sdk';
import { useRegistry } from './sdk/PluginRegistry';
import { useSettingsStore } from './store/useSettingsStore';

declare global {
  interface Window {
    __WINNOOK__: unknown;
  }
}

// External plugins resolve react / @winnook/sdk through these shared instances (see public/shims).
window.__WINNOOK__ = { React, jsxRuntime, sdk: { definePlugin, useNow } };

async function bootstrap() {
  const isNotch = getCurrentWebviewWindow().label === 'main-notch';
  await useSettingsStore.getState().init(isNotch);
  if (isNotch) await useRegistry.getState().init();
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
}

const showError = (err: unknown) => {
  console.error('WinNook error', err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#b00;padding:12px;white-space:pre-wrap;font-size:12px';
  pre.textContent = String((err as Error)?.stack ?? err);
  document.body.appendChild(pre);
};
window.addEventListener('error', (e) => {
  if (getCurrentWebviewWindow().label === 'screenshot-editor') showError(e.error ?? e.message);
});

bootstrap().catch(showError);
