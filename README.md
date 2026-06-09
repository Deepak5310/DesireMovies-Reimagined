# DesireMovies Reimagined 🎬

**DesireMovies Reimagined** is a high-performance Google Chrome extension (Manifest V3) designed to transform the DesireMovies web experience. It replaces the legacy, ad-heavy, and cluttered layout with a premium, glassmorphic Netflix-inspired user interface, while offering a dual-layer headless and automated link bypass engine.

---

## 📐 Architecture Overview

The extension coordinates background service workers, content scripts, and page-context shields to deliver optimized styling, real-time IMDb integration, and headless link redirection.

```mermaid
graph TD
    subgraph DesireMovies Page
        A[User Clicks Download Button] -->|Intercept Click| B[Show 'Bypassing...' Spinner]
        B -->|Message: bypass_gyanigurus| C[background.js]
    end

    subgraph background.js (Service Worker)
        C -->|1. Headless GET| D[gyanigurus.xyz]
        D -->|Extract Form Nonces & Inputs| E[Prepare URLSearchParams]
        E -->|2. Headless POST| F[gyanigurus.xyz]
        F -->|Extract Link| G{gdflix URL Found?}
        G -->|Yes| H[Open gdflix in New Tab]
        G -->|No / Fail| I[Open gyanigurus.xyz Fallback Tab]
    end

    subgraph gyanigurus.xyz Tab (Fallback)
        I -->|shield.js MAIN Context| J[Override window.open / Suppress Ads]
        I -->|gyanigurus.js ISOLATED Context| K[Auto-Click Form Button]
        K -->|MutationObserver| L[Click gdflix Link]
        L -->|Message: close_tab| M[Close gyanigurus Tab]
        L --> H
    end

    subgraph new.gdflix.io Tab
        H -->|gdflix.js ISOLATED Context| N[Auto-Click Instant DL Button]
        N -->|Message: close_tab| O[Close gdflix Tab after 200ms]
    end
```

---

## ✨ Core Features & Technical Deep-Dive

### 1. Modern Netflix-Style Visual Redesign
* **Glassmorphic Navbar**: The top header (`.dm-navbar`) features a sticky, translucent blur background (`rgba(17,17,19,0.92)` with `backdrop-filter: blur(12px)`) and a modern pill-shaped inline search bar.
* **Animated Movie Cards**: Custom grid configuration dynamically displays titles in responsive rows using a glassmorphic card design (`.dm-card`). Card introductions are staggered using custom CSS variables (`--delay`) and entry keyframes (`.dm-card--animate`).
* **Clean Screenshots Layout**: Screenshots on detail pages are set up in a balanced **3-column grid** (`.dm-single__ss-grid` with `grid-template-columns: repeat(3, 1fr)` and a `16px` gap). Aspect ratio is anchored to `16/9` with `object-fit: cover` to prevent layout shifts. Large modal lightboxes and disruptive hover zooms have been removed to prioritize speed and visual consistency.
* **Shimmer Loaders & Flash Prevention**: Shimmer animation rules (`.dm-skeleton`) run on categories and content containers to prevent layout snaps. Flash prevention is applied immediately at `document_start` by hiding original layout elements via CSS classes (`dm-extension-active`).

### 2. Live IMDb Rating & Local Cache Engine
* **Regional Title Cleaner**: Before querying IMDb, titles are processed through a parsing engine in `content.js` (`DMParser.parseTitle`). This strips tags, bracket annotations, year metadata, and regional Indian language keywords (including `Marathi`, `Bengali`, `Punjabi`, `Kannada`, `Bhojpuri`, `Gujarati`, `Tamil`, `Telugu`, `Malayalam`, `Hindi`, `English`, `Korean`) to yield clean, searchable titles.
* **Asynchronous IMDb Fetching**:
  1. The cleaner title queries the JSONP suggestion endpoint:
     `https://sg.media-imdb.com/suggests/${firstChar}/${cleanTitle}.json`
  2. The response is parsed to match the correct IMDb title ID (`ttXXXXXXX`).
  3. The background service worker fetches the official IMDb title page (`https://www.imdb.com/title/${imdbId}/`).
  4. Using regular expressions, the engine parses the JSON-LD schema content:
     `/"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*"?([\d.]+)"?/`
* **Zero-Delay (0ms) Local Caching**: Once resolved, ratings are stored inside Chrome's local storage (`chrome.storage.local`) mapped under `imdb_${cleanTitle}`. Subsequent visits to the same details page bypass network fetches entirely, loading cached ratings instantly.
* **Shimmer Skeleton Placeholder**: Detail pages display a shimmering placeholder loader for the IMDb rating. It updates to the live score as soon as the background query resolves, eliminating visual stuttering.

### 3. Dual-Layer Redirection & Bypass Engine
* **Layer A: Headless Redirection (Background)**:
  * When a user clicks a download button, the content script intercepts the click and changes the button text to `"Bypassing..."` accompanied by a CSS spinning loader (`@keyframes dmSpin`).
  * `background.js` performs a background fetch to `gyanigurus.xyz` to pull the first landing page.
  * It extracts hidden form fields using regex `/name=["']([^"']*)["']/i` and `/value=["']([^"']*)["']/i`.
  * It executes a background HTTP POST request to the same URL passing these parameters.
  * It extracts the `new.gdflix.io` link from the POST response using `href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i` and opens it in a new tab, bypassing the gyanigurus page entirely.
* **Layer B: Native Automation Fallback (Foreground)**:
  * If the headless bypass fails (e.g. Cloudflare triggers), the extension falls back to opening the gyanigurus page in a new tab.
  * **MAIN-Context Ad Shield**: `shield.js` is injected into the page's `MAIN` execution context at `document_start` to override `window.open`, neutralizing popups.
  * **Automated Clicker**: `gyanigurus.js` executes at `document_end`. It locates the redirection form buttons, programmatically triggers clicks, sets up a `MutationObserver` to watch for the dynamically rendered `gdflix` link, clicks it, and sends a runtime message to close itself after `200ms`.
  * **GDFlix Closer**: `gdflix.js` runs at `document_end` on `new.gdflix.io`. It searches for anchors matching the `"Instant DL"` regex, clicks the element to trigger the download, and closes the tab within `200ms` via `chrome.runtime.sendMessage({ action: "close_tab" })`.

---

## 📋 Timing & Script Execution Matrix

The following table details how scripts are registered in [manifest.json](file:///c:/Users/D%20E%20E%20P%20A%20K/Desktop/DesMov/manifest.json) to control execution scope:

| Script | Match Patterns | Timing (`run_at`) | Context World | Role |
| :--- | :--- | :--- | :--- | :--- |
| **`content.js`** | `https://1desiremovies.top/*` | `document_start` | `ISOLATED` | Parses DOM, blocks default layout, renders UI, handles caching & async IMDb calls. |
| **`shield.js`** | `https://gyanigurus.xyz/*` | `document_start` | `MAIN` | Replaces `window.open` in window context to disable popup triggers. |
| **`gyanigurus.js`** | `https://gyanigurus.xyz/*` | `document_end` | `ISOLATED` | Fallback automation clicker, observers dynamic link generation, shuts tab down. |
| **`gdflix.js`** | `https://new.gdflix.io/*` | `document_end` | `ISOLATED` | Identifies Instant DL button, triggers click event, issues tab closure request. |
| **`background.js`** | Service Worker | *N/A* | *Service Worker* | CORS proxy fetch dispatcher and headless form POST bypass runner. |

---

## 📂 Directory Layout

```bash
├── manifest.json         # Extension configuration, permissions, and script scopes
├── background.js         # Service Worker handling async cors fetches and headless bypass logic
├── content.js            # Main content processor, title parser, IMDb rating controller, and view renderer
├── shield.js             # MAIN world script that suppresses window.open popups on gyanigurus.xyz
├── gyanigurus.js         # Fallback script to automate redirection clicks on gyanigurus.xyz
├── gdflix.js             # Automation script to click download buttons and close tabs on new.gdflix.io
├── redesign.css          # Design token definitions, glassmorphism UI, shimmer templates, card layouts
└── icons/                # Brand logo files (16px, 32px, 48px, 128px)
```

---

## 🚀 Installation & Developer Setup

1. Clone or download this directory to your machine:
   ```bash
   git clone https://github.com/Deepak5310/DesireMovies-Reimagined.git
   ```
2. Open Google Chrome and navigate to the extensions control page: `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click **Load unpacked** in the top-left corner.
5. Select the `DesMov` folder containing the code and `manifest.json`.
6. Navigate to any DesireMovies details page. Verify the rating renders with a shimmering loader before loading the live rating, and click download to experience the headless bypass!

---

## 👤 Developer
* **Deepak5310** ([GitHub Profile](https://github.com/Deepak5310))
