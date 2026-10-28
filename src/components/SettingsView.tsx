import { Code2, LayoutGrid } from 'lucide-react';
import { useSettingsStore, type Settings } from '../store/useSettingsStore';
import { MANAGE_PLUGINS_VIEW_ID, useShellStore } from '../store/useShellStore';
import { SectionTitle, Segmented, Toggle } from './ui';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      {children}
    </div>
  );
}

export function SettingsView() {
  const s = useSettingsStore();
  const openFullView = useShellStore((st) => st.openFullView);
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => void s.set(key, value);

  return (
    <div className="flex h-full flex-col gap-3 text-zinc-900 dark:text-zinc-100">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6">
        <section className="flex flex-col gap-2.5">
          <SectionTitle>Appearance</SectionTitle>
          <Row label="Theme">
            <Segmented
              value={s.theme}
              onChange={set('theme')}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </Row>
          <Row label="Accent">
            <div className="flex items-center gap-2">
              {s.accent === 'custom' && (
                <input
                  type="color"
                  aria-label="Custom accent color"
                  value={s.customAccent}
                  onChange={(e) => void s.set('customAccent', e.target.value.toUpperCase())}
                  className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              )}
              <Segmented
                value={s.accent}
                onChange={set('accent')}
                options={[
                  { value: 'wallpaper', label: 'Wallpaper' },
                  { value: 'windows', label: 'Windows' },
                  { value: 'violet', label: 'Violet' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>
          </Row>
          <Row label="Material">
            <div className="flex items-center gap-2">
              {s.material === 'glass' && (
                <input
                  type="range"
                  aria-label="Glass opacity"
                  title={`Opacity ${Math.round(s.glassOpacity * 100)}%`}
                  min={50}
                  max={100}
                  value={Math.round(s.glassOpacity * 100)}
                  onChange={(e) => void s.set('glassOpacity', Number(e.target.value) / 100)}
                  className="h-1 w-20 cursor-pointer accent-[rgb(var(--accent))]"
                />
              )}
              <Segmented
                value={s.material}
                onChange={set('material')}
                options={[
                  { value: 'glass', label: 'Glass' },
                  { value: 'solid', label: 'Solid' },
                ]}
              />
            </div>
          </Row>
          <Row label="Position">
            <Segmented
              value={s.position}
              onChange={set('position')}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Row>
        </section>

        <section className="flex flex-col gap-2.5">
          <SectionTitle>Behavior</SectionTitle>
          <Row label="Monitor">
            <Segmented
              value={s.monitor}
              onChange={set('monitor')}
              options={[
                { value: 'primary', label: 'Primary' },
                { value: 'follow', label: 'Follow cursor' },
              ]}
            />
          </Row>
          <Row label="Hover delay">
            <Segmented
              value={s.hoverDelay}
              onChange={set('hoverDelay')}
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'normal', label: 'Normal' },
                { value: 'calm', label: 'Calm' },
              ]}
            />
          </Row>
          <Row label="Nook Buddy">
            <Segmented
              value={s.nookBuddy}
              onChange={set('nookBuddy')}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'subtle', label: 'Subtle' },
                { value: 'playful', label: 'Playful' },
              ]}
            />
          </Row>
          <Row label="Dodge key">
            <Segmented
              value={s.dodgeKey}
              onChange={set('dodgeKey')}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'shift', label: 'Shift' },
                { value: 'ctrl', label: 'Ctrl' },
                { value: 'alt', label: 'Alt' },
              ]}
            />
          </Row>
        </section>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Row label="Always on top">
          <Toggle checked={s.alwaysOnTop} onChange={set('alwaysOnTop')} label="Always on top" />
        </Row>
        <Row label="Coffee keeps Teams green">
          <Toggle checked={s.keepStatusActive} onChange={set('keepStatusActive')} label="Keep status active" />
        </Row>
        <Row label="Launch at startup">
          <Toggle checked={s.launchAtStartup} onChange={set('launchAtStartup')} label="Launch at startup" />
        </Row>
      </div>

      <footer className="flex items-center justify-between gap-3 rounded-xl bg-black/[0.06] px-3 py-2 dark:bg-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <Code2 size={18} className="text-accent" />
          <div>
            <div className="text-[12px] font-semibold">Plugin dev mode</div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
              Restarts a plugin each time you save one of its files
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={s.devMode} onChange={set('devMode')} label="Plugin dev mode" />
          <button
            type="button"
            onClick={() => useShellStore.getState().startEdit()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11px] font-medium text-white"
          >
            <LayoutGrid size={12} /> Edit layout
          </button>
          <button
            type="button"
            onClick={() => openFullView(MANAGE_PLUGINS_VIEW_ID)}
            className="rounded-lg bg-black/10 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/20"
          >
            Manage plugins
          </button>
        </div>
      </footer>
    </div>
  );
}
