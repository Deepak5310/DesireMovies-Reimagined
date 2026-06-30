# DesireMovies Bypass

A pure-headless Chrome MV3 extension that automates multi-hop download bypasses on DesireMovies. It resolves the entire download chain invisibly in the background — **zero tabs opened, download starts directly**.

---

## How It Works

When you click a download link on DesireMovies, several redirect pages normally require manual interaction. This extension resolves everything invisibly:

### The Headless Path (~2-3 seconds)

```
Click download link on DesireMovies
  └─ content.js intercepts the click and messages the Service Worker
       └─ background.js resolves the ENTIRE chain headlessly:
            1. GET Gyanigurus page → extract GDFlix URL
            2. GET GDFlix page → extract "Instant DL" (BusyCDN) URL
            3. fetch(BusyCDN) → read redirect location → parse ?url= param
            4. chrome.downloads.download(finalUrl) → ✅ Download starts directly
```

No tabs open. No visible redirects. The download just starts magically. 

### Fallback

If the headless chain fails (e.g., a Cloudflare challenge or a major page structure change), the extension will log an error, show a `❌ Failed` status next to the link, and simply open the original link in a new tab so you can complete the download manually.

---

## Features

- **Zero-tab download**: Entire chain resolved headlessly — download starts directly via `chrome.downloads`.
- **Lightning Fast**: Three sequential fetches take ~2-3s total compared to opening/closing multiple tabs.
- **Smart Filename Cleaning**: Strips site branding, preserves important quality/codec tags (like 1080p, WEB-DL, HEVC), and standardizes episode formats on every download.
- **Bypass Cache**: Caches resolved download URLs per session so clicking the same link twice instantly downloads the file.
- **Invisible Execution**: No popup UI, no options page, no bloat.

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
- **Downloads** — All filenames are automatically cleaned.

### Filename Examples

| Raw | Cleaned |
|---|---|
| `EP.1.5.Movie.Name.S01.WEBDl.10bit.Desiremovies.mkv` | `Movie Name S01 EP01-05 WEB-DL.mkv` |
| `Movie.Name.2024.1080p.hq.desiremovies.in.mkv` | `Movie Name 2024 1080p.mkv` |
| `Show.S02.EP03.Hindi.5.1.WEBDl.mkv` | `Show S02 EP03 Hindi 5.1 WEB-DL.mkv` |

---

## Project Structure

```
DesireMovies-Reimagined/
├── manifest.json     — MV3 manifest with strict domain-scoped permissions
├── background.js     — Service worker: headless chain bypass and filename cleaning
├── content.js        — Content script: intercepts clicks on DesireMovies
└── icons/            — Extension icons
```

---

## How to Update Domains Manually

Target sites often change their TLDs (e.g., from `.dad` to `.mom` or `.io` to `.dev`) to evade blocks. If the extension stops working because a domain changed, here is exactly how to update it:

### 1. If DesireMovies Changes Domain
If the main site changes (e.g., `1desiremovies.dad` moves to `1desiremovies.cat`):
* Open `manifest.json`.
* Under `content_scripts`, update the `matches` array:
  ```json
  "matches": ["*://*.1desiremovies.cat/*"]
  ```

### 2. If Gyanigurus Changes Domain
Gyanigurus is the first hop in the chain. If it changes:
* Open `manifest.json` and update the `host_permissions` array with the new domain.
* Open `background.js`, locate `function isAllowedBypassUrl(url)`, and change the hardcoded string `"gyanigurus.xyz"` to the new domain.

### 3. If GDFlix, BusyCDN, or FastCDN Change Domains
These are the intermediate and final hops. If they change:
* Open `manifest.json` and update the `host_permissions` array with the new domains. If you don't update this, Chrome will block the background fetch with a CORS error!
* Open `background.js` and locate the pre-compiled regexes near the top:
  * Update `GDFLIX_HREF_RE` if GDFlix changes.
  * Update `INSTANT_DL_RE` if the BusyCDN URL structure changes.

---

## Security & Permissions

| Permission | Reason |
|---|---|
| `downloads` | Used to trigger the final download and clean filenames (`onDeterminingFilename`). |
| `storage` | Used to persist the bypass cache across service-worker restarts (`chrome.storage.session`). |
| `host_permissions` | Strict permissions required by Chrome to allow `fetch()` requests to the specific intermediate domains in the background. |

- Headless fetch is strictly restricted to `gyanigurus.xyz` via an allowlist.
- Content scripts inject only on the listed DesireMovies domains.
- Zero analytics, zero tracking, no data sent to external servers.

---

## Developer

**Deepak Jangid** — [Deepak5310](https://github.com/Deepak5310)

## License

For educational and personal use only.
