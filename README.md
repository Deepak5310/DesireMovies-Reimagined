# DesireMovies Bypass

A Chrome MV3 extension that automates multi-hop download bypasses on DesireMovies and KatMovieHD and cleans every downloaded filename.

---

## How It Works

When you click a download link on DesireMovies or KatMovieHD, several redirect pages normally require manual interaction. This extension automates all of them:

```
DesireMovies / KatMovieHD page
  └─ content.js intercepts the Gyanigurus link click
       └─ background.js fetches the page headlessly and extracts the GDFlix URL
            └─ automation.js (GDFlix tab) clicks "Instant DL"
                 └─ automation.js (FastCDN tab) waits for the download link, clicks it, closes the tab
```

For KMHD pages, the chain starts with an "Unlock Links" button instead:

```
automation.js (KMHD tab) clicks "Unlock Links" → clicks GDFlix link → closes tab
  └─ (same GDFlix → FastCDN chain)
```

Every file downloaded through Chrome is also automatically renamed by the filename cleaner.

---

## Features

| Feature | Description |
|---|---|
| **Headless bypass** | Gyanigurus pages are fetched in the background — no redirect tab shown |
| **Auto-click chain** | Clicks through GDFlix "Instant DL" and FastCDN "Download Here" automatically |
| **KMHD support** | Unlocks links and navigates the GDFlix flow from KatMovieHD pages |
| **Filename cleaning** | Strips branding, quality tags, dot-spacing; standardizes episode format |
| **Bypass cache** | Caches resolved GDFlix URLs per session to skip redundant requests |
| **Fallback handling** | Opens links directly if headless bypass fails twice for a domain |
| **Self-closing tabs** | Automation tabs close themselves after completing their step |

---

## Installation

> This extension is not on the Chrome Web Store. Load it as an unpacked extension.

```bash
git clone https://github.com/Deepak5310/DesireMovies-Reimagined.git
```

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned directory
4. Visit a DesireMovies or KatMovieHD page and click any download link

---

## Usage

No configuration required. Once loaded:

- **DesireMovies / KatMovieHD** — Click any Gyanigurus download link. The extension bypasses it in the background and opens the GDFlix tab automatically.
- **GDFlix** — Auto-clicks "Instant DL".
- **FastCDN** — Waits for the download link, clicks it, closes the tab.
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
| `downloads` | Intercepts `onDeterminingFilename` to clean filenames |
| `storage` | Persists bypass cache and failure counters across service-worker restarts |
| `*://*.gyanigurus.xyz/*` | Host permission for headless `fetch()` to Gyanigurus pages |

> **Note:** Content scripts are injected only on specific target domains (DesireMovies, KatMovieHD, Gyanigurus, GDFlix, FastCDN, KMHD). No scripts run on unrelated pages. The `tabs` permission is not required — `chrome.tabs.create` and `chrome.tabs.remove` work without it.

---

## Project Structure

```
DesireMovies-Reimagined/
├── manifest.json     — MV3 manifest with domain-scoped content scripts
├── background.js     — Service worker: headless bypass, tab ops, filename cleaning
├── automation.js     — Content script (document_start): auto-clicks on bypass pages
├── content.js        — Content script (document_idle): intercepts links on source pages
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Script Matrix

| Script | Sites | Timing | Purpose |
|---|---|---|---|
| `automation.js` | Gyanigurus, GDFlix, FastCDN, KMHD | `document_start` | DOM auto-clicks and tab closing |
| `content.js` | DesireMovies, KatMovieHD | `document_idle` | Intercept download links, trigger headless bypass |
| `background.js` | Service Worker | — | Headless bypass, tab management, filename cleaning |

---

## Adding New Domains

Target sites frequently change TLDs. To add a new domain:

1. Add a match pattern to the appropriate `content_scripts` entry in `manifest.json`
2. If the site is a new bypass source (like Gyanigurus), also add it to `host_permissions`
3. If needed, update the `isAllowedBypassUrl` allowlist in `background.js`

---

## Limitations

- **TLD changes** — Sites change TLDs frequently. Update match patterns in `manifest.json` when they do.
- **Page structure changes** — If a bypass site changes its button IDs or layout, update the selectors in `automation.js`.
- **Cloudflare challenges** — Headless `fetch()` can't execute JavaScript, so CF-protected pages fall back to direct navigation.
- **Service worker restarts** — Chrome may terminate the SW at any time. Session cache is restored, but in-flight bypasses are lost.

---

## Troubleshooting

**Spinner shows but nothing opens** — Headless bypass failed. Check DevTools → Extensions → Service Worker for `[DM]` errors. The fallback should open the link directly.

**GDFlix "Instant DL" not clicked** — Button text may have changed. Inspect the page and update `INSTANT_DL_RE` in `automation.js`.

**FastCDN tab doesn't close** — The `#downloadbtn` or `#vd` selectors may have changed. Inspect and update.

**KMHD unlock not working** — Increase the hydration delay (`1500` ms) in the KMHD block of `automation.js`.

**Filenames not cleaned** — Verify the extension has the `downloads` permission and Chrome ≥ 83.

---

## Security

- Headless bypass is restricted to `gyanigurus.xyz` via the `isAllowedBypassUrl` allowlist
- Content scripts only inject on explicitly listed domains — not on all pages
- No data is sent to any external server

---

## Developer

**Deepak Jangid** — [Deepak5310](https://github.com/Deepak5310)

## License

For educational and personal use only.
