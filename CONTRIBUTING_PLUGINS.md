# Writing WinNook plugins

Everything in WinNook – timer, media player, calendar – is a plugin. Community plugins use the same API as the built-in ones.

## Quick start

```powershell
Copy-Item -Recurse plugin-template my-plugin
cd my-plugin
npm install
npm run dev
```

1. Edit `manifest.json` and set a unique `id`.
2. Turn on **Settings → Plugin dev mode** in WinNook.
3. Edit `src/index.tsx` and save. `npm run dev` rebuilds into the plugin folder and WinNook reloads the plugin within a moment.

The plugin folder is `%APPDATA%\WinNook\plugins\<id>\`. It must contain:

| File            | Purpose                                      |
| --------------- | -------------------------------------------- |
| `manifest.json` | Metadata (see below)                         |
| `index.js`      | ES module with the plugin as default export  |

`npm run build` produces both files in that folder. To ship a plugin, zip the folder; users unzip it into their plugin folder (Settings → Manage plugins → *Show plugin folder*).

## Manifest

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "What it does",
  "slot": "tile-small",
  "defaultOrder": 100,
  "permissions": ["storage"],
  "shortcuts": [{ "accelerator": "Ctrl+Alt+H", "actionId": "hello", "description": "Say hello" }]
}
```

`manifest.json` is authoritative; the `manifest` inside `index.tsx` is only there for typing.

### Slots

| Slot          | Where it appears                                   | Render hook        |
| ------------- | -------------------------------------------------- | ------------------ |
| `tile-large`  | Large Bento tile                                   | `renderTile`       |
| `tile-small`  | Compact tile below a large one                     | `renderTile`       |
| `action-icon` | Small icon button; opens `renderFullView` on click | `renderActionIcon` |
| `background`  | No tile, only `onInit` / pill indicator            | –                  |

Any plugin may also provide `renderPillIndicator` (shown in the collapsed pill) and `renderFullView` (opened via `ctx.shell.openFullView(id)`). Action icons without a full view should render their own `<button>`.

### Permissions

Calling a system API without declaring its permission throws.

`power` · `media` · `clipboard` · `overlay` · `storage` · `notifications` · `cursor` · `teams`

## Plugin API

```ts
export default definePlugin({
  manifest,
  onInit(ctx) { /* runs once; may return a cleanup function */ },
  onShortcut(actionId, ctx) {},
  renderTile(ctx) {},
  renderActionIcon(ctx) {},
  renderFullView(ctx) {},
  renderPillIndicator(ctx) {}, // return null to hide
});
```

All `render*` functions are React components in disguise, so hooks are allowed.

`ctx` offers:

- `usePluginStore(key, initial)` – like `useState`, persisted to disk per plugin.
- `shell.expand() / collapse() / openFullView(id) / closeFullView() / playChime() / showToast(msg)`
- `system.power.setKeepAwake(bool)` – `power`
- `system.media.useMediaSession()` – `media`
- `system.teams.useTeamsStatus()` – `teams` (`unreadCount`, `isInCall`, `isMicActive`, `focusTeams()`; local detection only) (`normX/normY` in -1..1 relative to the notch, `velocity` px/s, `idleSeconds`)
- `system.clipboard.useClipboardHistory()` – `clipboard` (persistent history: `items`, `copyItem(id)`, `copyText(text)`, `togglePin(id)`, `deleteItem(id)`, `clearUnpinned()`)
- `system.overlay.openDrawingOverlay()` / `openRegionSelector(prompt)` – `overlay`

`useNow(intervalMs)` from `@winnook/sdk` re-renders on an interval and returns `Date.now()`.

## Good to know

- **Tiles unmount when the notch collapses.** Keep running state (timers, counters) in `usePluginStore` or module-level variables, and do background work in `onInit` or `renderPillIndicator`, which stay mounted.
- **Never bundle React or the SDK.** The template marks `react`, `react/jsx-runtime` and `@winnook/sdk` as external; WinNook supplies them via an import map so plugins share the host's React instance.
- **Styling:** Tailwind classes are generated from WinNook's own sources, so only classes already used by the app are available (e.g. `bg-accent`, `text-accent`, `rounded-xl`, `dark:` variants). For anything else use inline `style`. Use `accent` for highlights so your plugin follows the user's accent color, and support both light and dark.
- **Errors are isolated.** A crashing plugin shows an error in its tile and is listed in *Manage plugins*; it never takes the notch down.
- Keep tiles small: a large tile is roughly 200×150 px, a small tile 200×55 px.
