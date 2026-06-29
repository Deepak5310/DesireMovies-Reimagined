# DesireMovies Bypass

A Chrome MV3 extension that automates multi-hop download bypasses on DesireMovies and KatMovieHD. Resolves the entire download chain headlessly — **zero tabs opened, download starts directly**.

---

## How It Works

When you click a download link on DesireMovies, several redirect pages normally require manual interaction. This extension resolves everything in the background:

### Primary Path (Zero Tabs — ~2-3 seconds)

```
Click download link on DesireMovies
  └─ content.js intercepts the click
       └─ background.js resolves the ENTIRE chain headlessly:
            1. GET Gyanigurus page → extract GDFlix URL
            2. GET GDFlix page → extract "Instant DL" (BusyCDN) URL
            3. fetch(BusyCDN, no-redirect) → read Location header → parse ?url= param
            4. chrome.downloads.download(finalUrl) → ✅ Download starts directly
```

No tabs open. No visible redirects. Download just starts.

### Fallback Path (Tab-Based)

If the headless chain fails (e.g. Cloudflare challenge, page structure change):

```
content.js falls back to opening a GDFlix tab
  └─ automation.js (GDFlix) clicks "Instant DL"
       └─ automation.js (FastCDN) waits, clicks download, closes tab
```

For KMHD pages, automation.js handles "Unlock Links" → GDFlix → FastCDN.

---

## Features

| Feature | Description |
|---|---|
| **Zero-tab download** | Entire chain resolved headlessly — download starts directly via `chrome.downloads` |
| **~2-3s total** | Three sequential fetches vs. opening/closing multiple tabs |
| **Automatic fallback** | Falls back to tab-based flow if headless fails |
| **Filename cleaning** | Strips branding, quality tags, dot-spacing; standardizes episode format |
| **Bypass cache** | Caches resolved download URLs per session |
| **KMHD support** | Unlocks links and navigates the GDFlix flow |
| **Self-closing tabs** | Fallback automation tabs close themselves |

---

## Installation

> Not on the Chrome Web Store. Load as unpacked.

```bash
git clone https://github.com/Deepak5310/DesireMovies-Reimagined.git
```

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned directory
4. Visit a DesireMovies page and click any download link

---

## Usage

No configuration required. Once loaded:

- **DesireMovies** — Click any download link. You'll see "⏳ Bypassing…" then "✅ Download started". No tabs open.
- **GDFlix / FastCDN** — If opened manually or via fallback, automation.js handles clicks automatically.
- **KMHD** — Unlock buttons are clicked automatically.
- **Downloads** — All filenames are automatically cleaned.

### Filename Examples

| Raw | Cleaned |
|---|---|
| `EP.1.5.Movie.Name.S01.WEBDl.10bit.Desiremovies.mkv` | `Movie Name S01 EP01-05 WEB-DL.mkv` |
| `Movie.Name.2024.1080p.hq.desiremovies.in.mkv` | `Movie Name 2024 1080p.mkv` |
| `Show.S02.EP03.Hindi.5.1.WEBDl.mkv` | `Show S02 EP03 Hindi 5.1 WEB-DL.mkv` |

---

## Permissions

| Permission | Reason |
|---|---|
| `downloads` | `onDeterminingFilename` for filename cleaning + `chrome.downloads.download()` for direct downloads |
| `storage` | Persists bypass cache across service-worker restarts |
| `*://*.gyanigurus.xyz/*` | Headless fetch to extract GDFlix URL |
| `*://*.gdflix.io/*`, `*://*.gdflix.dev/*` | Headless fetch to extract Instant DL URL |
| `*://*.busycdn.xyz/*` | Read 302 redirect to extract final download URL |

> Content scripts inject only on specific target domains. No scripts run on unrelated pages.

---

## Project Structure

```
DesireMovies-Reimagined/
├── manifest.json     — MV3 manifest with domain-scoped permissions
├── background.js     — Service worker: full chain bypass, tab ops, filename cleaning
├── automation.js     — Content script (document_start): fallback auto-clicks
├── content.js        — Content script (document_idle): intercepts download clicks
└── icons/
```

### Script Matrix

| Script | Sites | Purpose |
|---|---|---|
| `content.js` | DesireMovies, KatMovieHD | Intercepts download clicks → triggers full headless bypass |
| `background.js` | Service Worker | Resolves entire chain, triggers direct download, cleans filenames |
| `automation.js` | Gyanigurus, GDFlix, FastCDN, KMHD | Fallback: DOM auto-clicks when tabs are opened |

---

## Adding New Domains

Target sites change TLDs frequently:

1. Add match patterns to `content_scripts` in `manifest.json`
2. For new bypass sources, add to `host_permissions`
3. Update `isAllowedBypassUrl` allowlist in `background.js`

---

## Limitations

- **TLD changes** — Update match patterns in `manifest.json` when sites move
- **Page structure changes** — If GDFlix removes the "Instant DL" link or BusyCDN changes its redirect, the headless chain breaks (falls back to tab-based)
- **Cloudflare challenges** — Headless fetch can't execute JS challenges
- **SW restarts** — Session cache restores, but in-flight bypasses are lost

---

## Security

- Headless bypass restricted to `gyanigurus.xyz` via allowlist
- Content scripts inject only on listed domains
- No data sent to external servers

---

## Developer

**Deepak Jangid** — [Deepak5310](https://github.com/Deepak5310)

## License

For educational and personal use only.
