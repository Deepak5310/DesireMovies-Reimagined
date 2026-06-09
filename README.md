# DesireMovies Reimagined 🎬

**DesireMovies Reimagined** is a modern, high-performance Google Chrome extension designed to completely transform the user interface and automation flow of DesireMovies. It replaces the ad-heavy, cluttered interface with a premium, glassmorphic Netflix-style grid and offers fully automated, headless download redirection.

---

## ✨ Features

### 1. Modern Dark UI & Glassmorphism
* **Netflix-Style Grid**: Replaces standard blog rolls with a high-end cards grid.
* **Compact Premium Footer**: Clean branding layout, tagline, and developer credentials.
* **Shimmering Skeleton Loaders**: Shimmer loaders for loading cards and metadata blocks to prevent layout shifts.
* **Unified Layout**: High-specificity CSS overrides ensure details pages use matching alignment and container widths.

### 2. Live & Cached IMDb Integration
* **Non-Blocking Fetch**: Details pages render instantly, while suggestions and ratings are resolved in the background.
* **Live JSON-LD Parsing**: Fetches live title pages from `www.imdb.com` and parses accurate ratings directly from Schema.org metadata.
* **IMDb Local Cache**: Caches rating values under `chrome.storage.local` to deliver **instant (0ms) load times** on revisited pages.
* **Regional Language Parsing**: Automatically cleans Indian regional tags (e.g. `Marathi`, `Bengali`, `Punjabi`, `Kannada`, `Bhojpuri`, `Gujarati`) from titles to maximize IMDb search match success rates.

### 3. Headless Link Bypass (`gyanigurus.xyz`)
* **Click Interception**: When clicking a download button on the details page, the extension displays a spinning `"Bypassing..."` loader.
* **Headless Form Solver**: In the background script, the extension headlessly fetches `gyanigurus.xyz`, extracts hidden CSRF tokens and input fields, submits them via HTTP POST, and extracts the target `new.gdflix.io` link.
* **Tab-less Redirection**: Bypasses opening the gyanigurus landing page tab altogether in the user's workspace.
* **Fail-Safe Fallback**: If the background bypass fails for any reason (e.g., Cloudflare checks), it opens the tab and executes automated clicks natively with an ad-shield.

### 4. Native Automation & Protection Fallback
* **Auto-Clicker (`gyanigurus.js`)**: Executes clicks synchronously on the page inside `document_end` to redirect.
* **Ad Shield (`shield.js`)**: Overrides `window.open` in the page's actual context (`world: "MAIN"`) at `document_start` to neutralize popup advertisements.
* **GDFlix Automation (`gdflix.js`)**: Runs at `document_end` to automatically trigger the "Instant DL [10GBPS]" button and closes itself within `200ms`.

### 5. Structured Screenshots Grid
* Displays screenshot images in a clean, balanced **3-column grid** per row with `16px` gap spacing and no hover zoom layout clutter.

---

## 📂 Project Structure

```bash
├── manifest.json         # Extension registry, permissions, script registration
├── background.js        # Background Service Worker for CORS bypass and headless fetch bypass
├── content.js           # Main script: scrapes post data, fetches IMDb ratings, builds Netflix UI
├── gyanigurus.js        # Fallback click automation script for gyanigurus.xyz
├── gdflix.js            # Auto-clicker script for new.gdflix.io download pages
├── shield.js            # Context-isolated ad/popup blocker running in MAIN context
├── redesign.css         # CSS variables, glassmorphism, card alignments, shimmer loaders
└── icons/               # Extension icons (16px, 32px, 48px, 128px)
```

---

## 🚀 Installation

1. Clone or download this repository to your local computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (top-left button).
5. Select the `DesMov` folder containing the extension files.
6. Refresh any open DesireMovies page, and watch it transform!

---

## 🛠️ Configuration Details
* **Manifest version**: `3`
* **Inject Timing**: Content scripts (`gyanigurus.js`, `gdflix.js`) run at `document_end` for immediate DOM response times.
* **Permissions**: Uses `"storage"` permission to cache IMDb ratings locally.

---

## 👤 Developer
* **Deepak5310** ([GitHub](https://github.com/Deepak5310))
