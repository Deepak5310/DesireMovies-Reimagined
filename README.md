# DesireMovies Automation

A Chrome MV3 extension that automates the multi-hop download link bypass chain on DesireMovies and KatMovieHD, and normalizes the filenames of every download triggered by those sites.

---

## What it does

When you visit a DesireMovies or KatMovieHD page and click a download link, several redirect hops normally require manual interaction. This extension automates all of them:

```
Click download link
  └─ content.js intercepts the Gyanigurus link
       └─ background.js fetches the page and extracts the GDFlix URL (headless)
            └─ automation.js (GDFlix tab) finds & clicks "Instant DL"
                 └─ automation.js (FastCDN tab) waits for loader, clicks "Download Here", closes tab
```

For KatMovieHD (KMHD), the chain starts with an in-page "Unlock Links" button instead:

```
automation.js (KMHD tab) clicks "Unlock Links" → waits → clicks GDFlix link → closes tab
  └─ (then same GDFlix → FastCDN chain as above)
```

In addition, every file downloaded through Chrome is automatically renamed by the extension's filename cleaner.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Headless bypass** | Gyanigurus pages are fetched in the background — the user never sees a redirect tab |
| **Auto-click GDFlix** | Finds and clicks the "Instant DL" button as soon as it appears in the DOM |
| **Auto-click FastCDN** | Detects when the download link resolves, clicks "Download Here", then closes the tab |
| **KMHD support** | Unlocks links and navigates the GDFlix flow from KatMovieHD pages |
| **Filename normalization** | Strips site branding, quality tags, and dot-spacing; standardizes episode format |
| **Bypass cache** | Caches resolved GDFlix URLs per session to skip redundant network requests |
| **Fallback handling** | Falls back to direct navigation if headless bypass fails twice for a domain |
| **Self-closing tabs** | Automation tabs close themselves after completing their step |

---

## Installation

> This extension is not published on the Chrome Web Store. Load it as an unpacked extension.

```bash
git clone https://github.com/Deepak5310/DesireMovies-Reimagined.git
```

1. Open **chrome://extensions** in Chrome
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the cloned directory
5. Visit a DesireMovies or KatMovieHD page and click any download link

---

## Usage

No configuration required. Once the extension is loaded:

- **On DesireMovies / KatMovieHD**: Click any download link that points to Gyanigurus. The extension intercepts it, performs the bypass in the background, and opens the GDFlix tab automatically.
- **On GDFlix**: The extension auto-clicks the "Instant DL" button.
- **On FastCDN**: The extension waits for the download to resolve, auto-clicks "Download Here", and closes the tab after 5 seconds.
- **Downloads**: Every file downloaded through Chrome will have its filename automatically cleaned.

### Filename Cleaning Examples

| Raw filename | Cleaned filename |
|---|---|
| `EP.1.5.Movie.Name.S01.WEBDl.10bit.Desiremovies.mkv` | `Movie Name S01 EP01-05 WEB-DL.mkv` |
| `Movie.Name.2024.1080p.hq.desiremovies.in.mkv` | `Movie Name 2024 1080p.mkv` |
| `Show.S02.EP03.Hindi.5.1.WEBDl.mkv` | `Show S02 EP03 Hindi 5.1 WEB-DL.mkv` |

---

## Permissions

| Permission | Reason |
|---|---|
| `downloads` | Required to intercept `chrome.downloads.onDeterminingFilename` for filename normalization |
| `storage` | Stores the bypass cache and failure counters across service-worker restarts |
| `tabs` | Required to open background tabs (`chrome.tabs.create`) and close automation tabs (`chrome.tabs.remove`) |
| `<all_urls>` host permission | Target sites (DesireMovies, GDFlix, KMHD etc.) frequently change TLDs. Chrome's match pattern spec does not allow wildcard TLDs (e.g. `*.gdflix.*`), so `<all_urls>` is required. Each script guards itself with an early-exit domain check, so no action is taken on unrelated pages. |

---

## Project Structure

```
DesireMovies-Reimagined/
│
├── manifest.json     — Extension manifest (MV3)
├── background.js     — Service worker: headless bypass, tab management, filename cleaning
├── automation.js     — Content script: DOM auto-clicks for GDFlix, FastCDN, Gyanigurus, KMHD
├── content.js        — Content script: intercepts bypass links on DesireMovies / KMHD pages
│
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Script Execution Matrix

| Script | Runs on | Timing | Context | Purpose |
|---|---|---|---|---|
| `automation.js` | Gyanigurus, GDFlix, FastCDN, KMHD | `document_start` | Isolated world | DOM auto-clicks and tab-close signalling |
| `content.js` | DesireMovies, KatMovieHD | `document_idle` | Isolated world | Intercepts bypass link clicks, triggers headless bypass |
| `background.js` | Service Worker | N/A | Service Worker | Headless bypass fetch, tab management, filename normalization |

---

## Limitations

- **Domain changes**: Target sites occasionally change their subdomain or TLD. If a site moves, the `host_permissions` and `content_scripts.matches` in `manifest.json` must be updated to match.
- **Bypass flow changes**: If Gyanigurus, GDFlix, or FastCDN changes their page structure or button IDs, the corresponding automation block in `automation.js` may stop working.
- **Anti-bot / Cloudflare**: Headless fetch in the service worker does not execute JavaScript, so pages protected by Cloudflare JS challenges will fail the bypass. The extension falls back to opening the page directly.
- **Service worker restarts**: Chrome can terminate the service worker at any time. The session cache is restored from `chrome.storage.session` on restart, but any in-flight bypasses will be lost.
- **MV3 fetch cookies**: The service worker's `fetch()` does not send the user's cookies for Gyanigurus pages. This is usually fine but could affect logged-in bypass flows if the site adds auth requirements.

---

## Troubleshooting

**The bypass spinner shows but nothing opens**
> The headless bypass failed. Check the browser console (DevTools → Extensions → `background.js`) for `[DM]` error messages. The fallback should open the link directly — if it doesn't, the page structure may have changed.

**GDFlix tab opens but "Instant DL" is not clicked**
> The button text may have changed. Open the GDFlix page manually, inspect the button, and update the `INSTANT_DL_RE` regex in `automation.js`.

**FastCDN tab opens but doesn't close**
> The `#downloadbtn` or `#vd` element IDs may have changed. Inspect the FastCDN page and update the selectors in `automation.js`.

**Downloaded files aren't being renamed**
> Confirm the extension has the `downloads` permission and that `onDeterminingFilename` is supported in your Chrome version (requires Chrome 83+).

**KMHD unlock button isn't clicked**
> The SvelteKit hydration delay is set to 1.5 seconds. If the page loads slowly, try increasing `setTimeout(() => btn.click(), 1500)` in the KMHD block of `automation.js`.

---

## Security Notes

- The extension only performs automated actions on explicitly listed domains — it does not have broad access to all websites.
- The headless bypass allowlist in `background.js` (`isAllowedBypassUrl`) restricts `bypass_gyanigurus` requests to `gyanigurus.xyz` only.
- No data is sent to any external server by this extension.

---

## Developer

**Deepak Jangid**
GitHub: [Deepak5310](https://github.com/Deepak5310)

---

## License

This project is provided for educational and personal-use purposes only.
