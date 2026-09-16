# DesireMovies Bypass & Stream — Chrome Extension (Manifest V3)

A high-performance Chrome Extension built with modern **Manifest V3** standards. Automates multi-hop download bypasses across redirect chains, cleans download filenames, and provides an in-page streaming video player with resume functionality, audio codec troubleshooting, and VLC/MPV integration.

---

## 🚀 Key Features

- **Automated Multi-Hop Bypass:** Directly resolves final direct stream/download URLs across Gyanigurus, KMHD, GDFlix, GoFlix, HubCloud, HubDrive, Gamerxyt, and Sportverse chains with zero tabs opened.
- **In-Page Video Player:** Stream movies and episodes directly in-browser with custom controls, time-remaining toggle, picture-in-picture, and radial HUD progress feedback.
- **Playback Resume System:** Remembers video playback position for up to 7 days with a 10-second auto-dismiss resume prompt.
- **Dolby / DTS Audio Troubleshooting:** Informs users when browser audio codecs (e.g. EAC3 / DTS) are unsupported, offering one-click MPV command copying and direct download options.
- **Batch Episode Pack Downloader:** Resolves and queues all episodes in a TV show pack with a controlled worker concurrency pool.
- **Smart Filename Sanitizer:** Strips site branding, release tags (`10bit`, `HEVC`, `x264`, `x265`, `Dual-Audio`), normalizes Season & Episode numbers (`S01 EP01`), and preserves audio channel descriptors (`5.1`, `7.1`).

---

## 🏗️ Architecture & MV3 Optimization

The extension follows Manifest V3 event-driven architectural principles:

```
┌─────────────────────────────────────────────────────────────┐
│                       manifest.json                         │
│   Declarative content script & stylesheet registration      │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│   content.js + player.css   │ │   background.js (Worker)    │
│  - DOM Link Observers       │ │  - Ephemeral Service Worker │
│  - In-Page Video Overlay    │ │  - Multi-Hop URL Resolvers  │
│  - Throttled Storage Sync   │ │  - In-Flight Request Dedup  │
│  - Radial HUD & Scrubber    │ │  - Filename Sanitizer Hook  │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
               └────── Chrome Runtime IPC ─────┘
```

### Optimizations Implemented:
1. **Zero-Overhead Declarative Injection:** Replaced manual `chrome.scripting` injection and `tabs.onUpdated` polling with native declarative `content_scripts` in `manifest.json`. This eliminates unnecessary background service worker wakeups on unrelated tab navigations across the browser.
2. **In-Flight Request Deduplication:** The Service Worker prevents redundant network fetches by mapping active Promises in an in-memory queue.
3. **Ephemeral Cache Hydration:** Uses `chrome.storage.session` to persist bypass tokens across Service Worker restarts with a 3-hour TTL.
4. **Layout Thrashing & Memory Cleanup:** Replaced programmatic inline styles in `content.js` with structured, hardware-accelerated CSS classes in `player.css`. Teardown routines safely release video decoding memory and remove window event listeners.
5. **Throttled Storage I/O:** Debounces playback timestamp writes to stay well within Chrome extension storage write quotas (`MAX_WRITE_OPERATIONS_PER_HOUR`).

---

## 📂 Project Structure

```
├── manifest.json       # Manifest V3 configuration & declarative rules
├── background.js       # Event-driven Service Worker (resolvers, deduplication, downloads)
├── content.js          # In-page UI, video overlay, and link interception
├── player.css          # Modular styles for player, radial HUD, and modals
├── icons/              # Extension icons (16px, 32px, 48px, 128px)
└── README.md           # Architecture documentation & setup instructions
```

---

## 🔒 Permissions Breakdown

| Permission | Purpose |
|---|---|
| `downloads` | Required to trigger background file downloads and invoke `onDeterminingFilename` to clean movie filenames. |
| `storage` | Required for ephemeral session caching (`chrome.storage.session`) and 7-day video playback position storage (`chrome.storage.local`). |
| `host_permissions` (`<all_urls>`) | Required to perform `fetch()` requests against dynamic, multi-hop redirect and mirror domains (Cloudflare Workers, GDFlix, HubCloud, KMHD, etc.). |

*Note: The `scripting` permission was removed as script and style injection are now handled declaratively by the browser.*

---

## ⌨️ Player Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> or <kbd>J</kbd> / <kbd>L</kbd> | Seek backward / forward 10 seconds |
| <kbd>↑</kbd> / <kbd>↓</kbd> or <kbd>Scroll Wheel</kbd> | Volume up / down 5% |
| <kbd>M</kbd> | Toggle Mute |
| <kbd>F</kbd> / <kbd>Double-Click</kbd> | Toggle Fullscreen |
| <kbd>P</kbd> | Picture-in-Picture |
| <kbd>0</kbd> – <kbd>9</kbd> | Jump to 0% – 90% of duration |
| <kbd>?</kbd> | Open Keyboard Shortcuts Guide |
| <kbd>Esc</kbd> | Close Modal / Exit Fullscreen / Close Player |

---

## 🛠️ Installation & Setup

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the extension root directory (`DesireMovies`).
5. Open any supported page to use the in-page stream player or automated multi-hop bypass download.

---

## 👤 Developer

**Deepak Jangid** — [Deepak5310](https://github.com/Deepak5310)

## 📄 License

For educational and personal use only.
