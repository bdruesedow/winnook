import { create } from 'zustand';

export type ShellView =
  | { kind: 'collapsed' }
  | { kind: 'expanded' }
  | { kind: 'full'; pluginId: string };

export const SETTINGS_VIEW_ID = '__settings__';
export const MANAGE_PLUGINS_VIEW_ID = '__plugins__';

interface ShellState {
  view: ShellView;
  /** Who opened the notch; programmatic opens auto-collapse if the cursor never arrives. */
  openedBy: 'hover' | 'plugin';
  page: number;
  toast: string | null;
  editMode: boolean;
  startEdit: () => void;
  setEditMode: (on: boolean) => void;
  expand: (by?: 'hover' | 'plugin') => void;
  collapse: () => void;
  openFullView: (pluginId: string) => void;
  closeFullView: () => void;
  setPage: (page: number) => void;
  showToast: (msg: string) => void;
}

let toastTimer: number | undefined;

export const useShellStore = create<ShellState>((set, get) => ({
  view: { kind: 'collapsed' },
  openedBy: 'hover',
  page: 0,
  toast: null,
  editMode: false,
  startEdit: () => set({ editMode: true, view: { kind: 'expanded' }, page: 0 }),
  setEditMode: (editMode) => set({ editMode }),
  expand: (by = 'plugin') =>
    set((s) => (s.view.kind === 'collapsed' ? { view: { kind: 'expanded' }, openedBy: by } : s)),
  collapse: () => set({ view: { kind: 'collapsed' }, page: 0, editMode: false }),
  openFullView: (pluginId) => set({ view: { kind: 'full', pluginId } }),
  closeFullView: () =>
    set((s) => {
      if (s.view.kind !== 'full') return s;
      // Back goes to the grid, or straight to settings when leaving "manage plugins".
      return s.view.pluginId === MANAGE_PLUGINS_VIEW_ID
        ? { view: { kind: 'full', pluginId: SETTINGS_VIEW_ID } }
        : { view: { kind: 'expanded' } };
    }),
  setPage: (page) => set({ page }),
  showToast: (msg) => {
    window.clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = window.setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 2400);
  },
}));
