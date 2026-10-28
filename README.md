<div align="center">

# 🏝️ WinNook

**A Dynamic Island / notch for Windows.**
A tiny pill at the top of your screen that blooms into a bento grid of plugins when you hover it.

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri&logoColor=black)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)
![Vibe coded](https://img.shields.io/badge/vibe--coded-100%25-ff69b4)

> 🤖 **100% vibe-coded.** Every line was written by AI (GitHub Copilot) while I steered with prompts. Expect rough edges and use at your own risk.

![Collapsed pill](docs/notch-pill.png)

![Expanded notch](docs/notch-expanded.png)

</div>

---

## ✨ Features

### 💊 The pill
- Always-on-top pill with clock and live indicators (music, timer, coffee, Teams, ...)
- Expands on hover into a bento grid, collapses when you leave. Hover delay is adjustable
- Click-through everywhere except the pill, so it never gets in your way
- 🫥 **Dodge mode:** hold a modifier key (Shift by default, or Ctrl/Alt) and the pill slides away from your mouse so you can reach whatever is underneath
- 🙈 **Peek-through:** `Ctrl+Alt+H` tucks the pill away for a few seconds
- 🧩 Edit mode: drag tiles around, resize them, multiple pages

### 🎨 Look and feel
- Frosted glass or solid material, light / dark / auto theme
- Accent color from your wallpaper, Windows accent, violet or any custom color
- Soft neon glow on the pill, left / center / right placement, optional follow-cursor monitor mode

### 🔌 Built-in plugins

| Plugin | What it does | Shortcut |
|---|---|---|
| ⏱️ **Timer** | Countdown with ring, chime and auto-expand when done | |
| 🎵 **Media Player** | Controls the current system media session, album art and progress | |
| ☕ **Coffee** | Keeps Windows awake (30 min / 1 h / 2 h / always), also keeps Teams "green" | `Ctrl+Alt+C` |
| 📋 **Clipboard History** | Searchable history with pinning, auto-classification (text, link, color, code) | `Ctrl+Alt+V` |
| 🔐 **Secret masking** | Tokens, keys and passwords are detected, encrypted with Windows DPAPI, hidden behind dots and expire after 30 min | |
| 📸 **Screenshot** | Capture an area or screen, then annotate and crop | `Ctrl+Alt+S` |
| ✏️ **Screen Draw** | Draw on top of your screen | `Ctrl+Alt+D` |
| 🔤 **Font Detector** | Identify a font from a screen selection | `Ctrl+Alt+F` |
| 📅 **Calendar** | Month view, agenda and reminders | |
| 📝 **Notes** | Quick note with instant auto-save | |
| 💬 **Teams Status** | Unread Teams notifications and call state in the pill, detected locally | |
| 👀 **Nook Buddy** | A little companion that lives in the pill (see below) | |
| 🍪 **Buddy Needs** | Hunger, fun, love and energy for your buddy | |

### 👀 Nook Buddy
A pair of eyes in the pill with a personality:
- Follows your cursor, blinks, gets dizzy when you circle it and startled when you rush it
- 🎧 Puts on headphones and grooves, headbangs or dances when music plays
- 📞 Wears a headset during Teams calls (and shows when the mic is active)
- 😴 Yawns, gets bored, plays pong with itself and falls asleep when you are away
- 😰 Sweats and looks scared when the pill dodges your mouse, then smiles when it is back
- Modes: Off / Subtle / Playful

### 🍪 Buddy Needs
A small tile that quietly tracks four needs. Low needs show up in the buddy's face, not as nagging popups.

| Need | Face when low | How to fill it |
|---|---|---|
| 🍪 Hunger | Looks down, thought bubble with a cookie | Tap **Snack** |
| 🎮 Fun | Half-lidded, unimpressed side-eye | Tap **Play**, or just listen to music |
| ❤️ Love | Droopy eyes and a tear | Tap **Pet**, or visit the notch |
| 🌙 Energy | Sleepy half-closed eyes | Tap **Nap**, or step away for a while |

Needs decay slowly and survive restarts.

---

## 🚀 Getting started

**Requirements:** Windows 10/11, Node.js 20+, Rust 1.80+, MSVC C++ Build Tools (Windows SDK), WebView2 Runtime.

```powershell
git clone https://github.com/bdruesedow/winnook.git
cd winnook
npm install
npm run tauri dev
```

Release build:

```powershell
npm run build
cd src-tauri
cargo build --release --features tauri/custom-protocol
```

The exe ends up in `src-tauri\target\release\winnook.exe`.

---

## 🧱 Tech stack

- 🦀 **Rust + Tauri v2** for window management, cursor polling, clipboard, DPAPI, WinRT media and notifications
- ⚛️ **React 18 + TypeScript** with Tailwind CSS and Framer Motion
- 🔌 **`@winnook/sdk`**: every feature is a plugin with a manifest, permissions and render slots

## 🧩 Write your own plugin

Plugins are just a folder with an `index.tsx` that calls `definePlugin`. Pick a slot (`tile-large`, `tile-small`, `action-icon` or `background`), declare permissions and optional global shortcuts, and render a tile, a full view and/or a pill indicator.
Dev mode in settings reloads external plugins every time you save a file.

Details: [CONTRIBUTING_PLUGINS.md](CONTRIBUTING_PLUGINS.md)

## 🤝 Contributing

Issues and pull requests are welcome. Please keep commit messages short and in English.

## 📄 License

[MIT](LICENSE) © Bastian Drüsedow
