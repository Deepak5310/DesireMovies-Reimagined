"use strict";
const activeBypasses = new Map();
const bypassCache = new Map();

// Matching Patterns
const GDFLIX_HREF_RE = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i;
const INSTANT_DL_RE = /href=["'](https?:\/\/[^"'\s]*busycdn\.[a-z0-9.]+\/[^"'\s]+)['"]/i;
const RE_GYANIGURUS = /^https?:\/\/[^/]*gyanigurus/i;
const RE_DESIREMOVIES = /^https?:\/\/[^/]*desiremovies/i;
const RE_KATMOVIEHD = /^https?:\/\/[^/]*katmoviehd/i;
const RE_KMHD = /^https?:\/\/[^/]*kmhd/i;

// Cache Persistence
const ready = (async () => {
  try {
    const sessionData = await chrome.storage.session.get(["bypassCache"]);
    if (sessionData.bypassCache) {
      for (const [k, v] of Object.entries(sessionData.bypassCache)) bypassCache.set(k, v);
    }
  } catch (e) {}
})();

function persistState() {
  chrome.storage.session.set({ bypassCache: Object.fromEntries(bypassCache) }).catch(() => {});
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  const headers = { ...BROWSER_HEADERS, ...options.headers };
  try {
    return await fetch(url, { ...options, headers, signal: ctrl.signal });
  } finally { clearTimeout(id); }
}

async function fetchHTML(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${new URL(url).hostname}`);
  return res.text();
}

function isAllowedBypassUrl(url) {
  return RE_GYANIGURUS.test(url) || RE_KMHD.test(url);
}

// Inject content script on target site loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url && (RE_DESIREMOVIES.test(tab.url) || RE_KATMOVIEHD.test(tab.url))) {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  }
});

// Headless redirect chain resolver
async function resolveFullChain(url) {
  await ready;
  if (bypassCache.has(url)) return { success: true, downloadUrl: bypassCache.get(url) };

  let gdflixUrl = "";
  if (RE_KMHD.test(url)) {
    const fileId = url.match(/\/file\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!fileId) throw new Error("Could not extract file ID from KMHD URL");
    const origin = new URL(url).origin;
    const touchRes = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST" });
    if (!touchRes.ok) throw new Error(`HTTP ${touchRes.status} on KMHD API`);
    const touchData = await touchRes.json();
    if (!touchData?.linkId) throw new Error("GDFlix linkId not found in KMHD API response");
    gdflixUrl = touchData.linkId;
  } else {
    const html1 = await fetchHTML(url);
    let match = html1.match(GDFLIX_HREF_RE);
    if (!match) {
      const body = new URLSearchParams();
      for (const m of html1.matchAll(/<input[^>]+>/gi)) {
        const tag = m[0];
        if (/type=["']?hidden["']?/i.test(tag)) {
          const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
          const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
          if (name) body.append(name, value);
        }
      }
      const res2 = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!res2.ok) throw new Error(`HTTP ${res2.status} on Gyanigurus POST`);
      match = (await res2.text()).match(GDFLIX_HREF_RE);
    }
    if (!match) throw new Error("GDFlix link not found on Gyanigurus page");
    gdflixUrl = match[1];
  }

  const html2 = await fetchHTML(gdflixUrl);
  const instantMatch = html2.match(INSTANT_DL_RE);
  if (!instantMatch) throw new Error("Instant DL link not found on GDFlix page");

  const redirectRes = await fetchWithTimeout(instantMatch[1]);
  const parsedUrl = new URL(redirectRes.url);
  const finalUrl = parsedUrl.searchParams.get("url") || redirectRes.url;
  if (!finalUrl) throw new Error("Could not resolve final download URL");

  bypassCache.set(url, finalUrl);
  persistState();
  return { success: true, downloadUrl: finalUrl };
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === "full_bypass") {
    const url = req.payload?.url;
    if (!url) { sendResponse({ success: false, error: "Missing URL" }); return false; }
    if (!isAllowedBypassUrl(url)) { sendResponse({ success: false, error: "URL not in bypass allowlist" }); return false; }

    let promise = activeBypasses.get(url);
    if (!promise) {
      promise = ready.then(() => resolveFullChain(url));
      activeBypasses.set(url, promise);
      promise.finally(() => activeBypasses.delete(url));
    }
    promise.then((result) => {
      chrome.downloads.download({ url: result.downloadUrl });
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  sendResponse({ success: false, error: `Unknown action: ${req.action}` });
  return false;
});

// Filename Cleaning Logic
const RE_TRAILING_DUP = /\s*\(\d+\)$/;
const RE_BRACKETS = /[\[\]\(\)\{\}]/g;
const RE_EP_PREFIX = /^EP((\.\d+)+)\./i;
const RE_BRANDING = /[-\s]*\b(desiremovies|katmoviehd|kmhd)[\w\-.]*\b|\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|x264|x265)\b/gi;
const RE_SEASON = /\b(S\d{2})\b/gi;
const RE_AUDIO_DOTS = /(5\.1|2\.0|7\.1|8\.1|2\.1)/g;
const RE_ALL_DOTS = /\./g;
const RE_DOT_PLACEHOLDER = /_DOT_/g;
const RE_NON_ALNUM = /[^a-zA-Z0-9\-.]/g;
const RE_MULTI_SPACE = /\s+/g;
const RE_TRAILING_PUNCT = /[-.]+$/;

function cleanFilename(filename) {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;
  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx);
  let epTag = "";

  base = base.replace(RE_TRAILING_DUP, "").replace(RE_BRACKETS, " ");
  base = base.replace(RE_EP_PREFIX, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    epTag = nums[0] === nums.at(-1) ? `EP${pad(nums[0])}` : `EP${pad(nums[0])}-${pad(nums.at(-1))}`;
    return "";
  });

  const clean = base
    .replace(RE_BRANDING, "")
    .replace(RE_SEASON, epTag ? `$1 ${epTag}` : "$1")
    .replace(RE_AUDIO_DOTS, (m) => m.replace(".", "_DOT_"))
    .replace(RE_ALL_DOTS, " ")
    .replace(RE_DOT_PLACEHOLDER, ".")
    .replace(RE_NON_ALNUM, " ")
    .replace(RE_MULTI_SPACE, " ")
    .trim()
    .replace(RE_TRAILING_PUNCT, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "4k") return "4K";
      if (lower === "web-dl" || lower === "webdl") return "WEB-DL";
      if (lower === "web-hdrip" || lower === "webhdrip") return "WEB-HDRip";
      if (lower === "bluray") return "BluRay";
      if (lower === "webrip") return "WEB-Rip";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  return clean + ext;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) { suggest(); return; }
  try {
    suggest({ filename: cleanFilename(item.filename) });
  } catch (e) {
    suggest();
  }
});
