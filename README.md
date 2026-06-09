# DesireMovies Reimagined 🎬

A modern Chrome Extension that completely transforms the DesireMovies browsing experience with a Netflix-inspired UI, real-time IMDb ratings, intelligent caching, and a fully automated download bypass engine.

> Built with Manifest V3, optimized for speed, automation, and a clutter-free experience.

---

## ✨ Features

### 🎨 Premium UI Redesign

* Netflix-inspired dark theme
* Glassmorphic sticky navigation bar
* Modern responsive movie cards
* Smooth staggered card animations
* Integrated search experience
* Zero-layout-shift rendering
* Lightweight screenshot gallery with 3-column responsive grid
* Skeleton shimmer loaders for seamless content loading

### ⭐ Live IMDb Ratings

* Automatic title parsing and cleanup
* Real-time IMDb rating retrieval
* JSON-LD metadata extraction
* Local caching using `chrome.storage.local`
* Instant subsequent loads with zero network requests
* Shimmer placeholders during rating fetch

### ⚡ Automated Download Bypass

* One-click download experience
* Background headless redirection engine
* Automatic form submission
* Popup suppression
* Cloudflare-safe fallback workflow
* Automatic GDFlix navigation
* Auto-click Instant Download buttons
* Self-closing automation tabs

---

## 🏗 Architecture

```mermaid
graph TD
    A[User Clicks Download] --> B[content.js]
    B --> C[background.js]

    C --> D[Headless Request]
    D --> E[Extract Hidden Fields]
    E --> F[Headless Form Submit]

    F --> G{GDFlix Link Found?}

    G -->|Yes| H[Open GDFlix]
    G -->|No| I[Fallback Automation]

    I --> J[shield.js]
    I --> K[gyanigurus.js]

    K --> L[Detect GDFlix Link]
    L --> H

    H --> M[gdflix.js]
    M --> N[Instant Download]
```

---

## ⭐ IMDb Rating Pipeline

1. Movie title is cleaned using the internal parser.
2. IMDb suggestion API is queried.
3. Matching IMDb ID is extracted.
4. IMDb title page is fetched.
5. Rating is parsed from JSON-LD metadata.
6. Result is cached locally.
7. Future requests load directly from cache.

### Supported Title Cleanup

The parser automatically removes:

* Release years
* Resolution tags
* Language tags
* Quality labels
* Bracket annotations
* Regional language identifiers

Examples:

```text
Salaar (2023) Hindi HDRip 1080p

↓

Salaar
```

---

## 🚀 Download Bypass Engine

### Layer 1: Headless Mode

The extension attempts a complete background bypass:

1. Fetch redirect page
2. Extract hidden form inputs
3. Submit form automatically
4. Locate GDFlix URL
5. Open final download page

No visible intermediate pages are shown to the user.

### Layer 2: Automation Fallback

If headless bypass fails:

* Popups are disabled
* Redirect buttons are auto-clicked
* Dynamic links are detected
* GDFlix is opened automatically
* Temporary tabs close themselves

---

## 📋 Script Execution Matrix

| Script          | Target         | Timing           | Context        | Purpose                                 |
| --------------- | -------------- | ---------------- | -------------- | --------------------------------------- |
| `content.js`    | DesireMovies   | `document_start` | ISOLATED       | UI rendering, IMDb integration, caching |
| `shield.js`     | GyaniGurus     | `document_start` | MAIN           | Popup suppression                       |
| `gyanigurus.js` | GyaniGurus     | `document_end`   | ISOLATED       | Redirect automation                     |
| `gdflix.js`     | GDFlix         | `document_end`   | ISOLATED       | Instant download automation             |
| `background.js` | Service Worker | N/A              | Service Worker | Headless bypass engine                  |

---

## 📂 Project Structure

```text
DesireMovies-Reimagined/
│
├── manifest.json
├── background.js
├── content.js
├── shield.js
├── gyanigurus.js
├── gdflix.js
├── redesign.css
│
└── icons/
    ├── 16.png
    ├── 32.png
    ├── 48.png
    └── 128.png
```

---

## 🛠 Installation

### Option 1: Load Unpacked

```bash
git clone https://github.com/Deepak5310/DesireMovies-Reimagined.git
```

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the extension directory
5. Visit DesireMovies

---

## ⚠️ Notes

* Target domains occasionally change.
* Some bypass routes may stop working when upstream providers modify their flow.
* Cloudflare or anti-bot protections can affect automation success rates.
* The fallback automation layer exists specifically to handle such scenarios.

---

## 👨‍💻 Developer

**Deepak Jangid**

GitHub: https://github.com/Deepak5310

---

## 📄 License

This project is provided for educational and personal-use purposes.
