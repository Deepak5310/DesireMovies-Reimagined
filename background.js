/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *   1. Headless bypass: fetches Gyanigurus pages, submits the hidden form,
 *      and extracts the GDFlix URL without navigating the user's tab.
 *   2. Tab management: opens background tabs, closes automation tabs.
 *   3. Filename normalization: cleans every Chrome download filename.
 */

"use strict";

// ─── Session State ─────────────────────────────────────────────────────────

/** Deduplication: url → in-flight bypass Promise. */
const activeBypasses = new Map();

/** Cache: source url → resolved GDFlix url. */
const bypassCache = new Map();

/** Consecutive failure count per hostname. */
const failureCounts = new Map();

/** Hostnames that failed ≥2 times — skip headless, go foreground. */
const fallbackDomains = new Set();

/**
 * Restore session state from chrome.storage.session.
 * Awaited before any bypass logic so state survives SW restarts.
 */
const ready = (async () => {
  try {
    const data = await chrome.storage.session.get([
      "bypassCache", "failureCounts", "fallbackDomains",
    ]);
    if (data.bypassCache) {
      for (const [k, v] of Object.entries(data.bypassCache))
        bypassCache.set(k, v);
    }
    if (data.failureCounts) {
      for (const [k, v] of Object.entries(data.failureCounts))
        failureCounts.set(k, parseInt(v) || 0);
    }
    if (data.fallbackDomains) {
      for (const d of data.fallbackDomains) fallbackDomains.add(d);
    }
  } catch (e) {
    console.warn("[DM] Session restore failed:", e);
  }
})();

/** Persist all session state. */
function persistState() {
  chrome.storage.session.set({
    bypassCache: Object.fromEntries(bypassCache),
    failureCounts: Object.fromEntries(failureCounts),
    fallbackDomains: [...fallbackDomains],
  }).catch((e) => console.warn("[DM] Session persist failed:", e));
}

// ─── Network ───────────────────────────────────────────────────────────────

/** Fetch with an abort timeout. */
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ─── Security ──────────────────────────────────────────────────────────────

/** True only for http/https URLs. */
function isHttpUrl(str) {
  try {
    const p = new URL(str).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/** Allowlist: only gyanigurus.xyz may be headless-bypassed. */
function isAllowedBypassUrl(url) {
  if (!isHttpUrl(url)) return false;
  const h = new URL(url).hostname;
  return h === "gyanigurus.xyz" || h.endsWith(".gyanigurus.xyz");
}

// ─── Headless Bypass ───────────────────────────────────────────────────────

const GDFLIX_HREF_RE = /href=["'](https?:\/\/[^"']*gdflix[^"']*)['"]/i;

/**
 * Fetch a Gyanigurus page, submit its hidden form, and extract the GDFlix URL.
 *
 * Strategy:
 *   GET  → check if GDFlix href already present (some pages skip the POST)
 *   POST → submit hidden form fields → extract GDFlix href from response
 */
async function performBypass(url) {
  await ready;

  if (bypassCache.has(url)) {
    return { success: true, gdflixUrl: bypassCache.get(url) };
  }

  const domain = new URL(url).hostname;

  // Step 1: GET landing page
  const res1 = await fetchWithTimeout(url);
  if (!res1.ok) throw new Error(`HTTP ${res1.status} on GET`);
  const html1 = await res1.text();

  let match = html1.match(GDFLIX_HREF_RE);
  if (match) return cacheResult(url, domain, match[1]);

  // Step 2: Extract hidden form fields
  const doc = new DOMParser().parseFromString(html1, "text/html");
  const body = new URLSearchParams();
  for (const el of doc.querySelectorAll('input[type="hidden"][name]')) {
    body.append(el.name, el.value ?? "");
  }

  // Step 3: POST
  const res2 = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res2.ok) throw new Error(`HTTP ${res2.status} on POST`);

  match = (await res2.text()).match(GDFLIX_HREF_RE);
  if (match) return cacheResult(url, domain, match[1]);

  throw new Error("GDFlix link not found in response");
}

/** Cache a resolved bypass and reset the failure counter. */
function cacheResult(sourceUrl, domain, gdflixUrl) {
  bypassCache.set(sourceUrl, gdflixUrl);
  failureCounts.set(domain, 0);
  persistState();
  return { success: true, gdflixUrl };
}

// ─── Message Handler ───────────────────────────────────────────────────────

/** Action handlers keyed by message action string. */
const actions = {
  close_tab(_, sender) {
    const tabId = sender.tab?.id;
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    return { success: true };
  },

  open_background_tab({ url }) {
    if (url) chrome.tabs.create({ url, active: false });
    return { success: true };
  },

  async bypass_gyanigurus({ url }) {
    if (!url) return { success: false, error: "Missing URL" };
    if (!isAllowedBypassUrl(url)) {
      return { success: false, error: "URL not in bypass allowlist" };
    }

    await ready;
    const domain = new URL(url).hostname;

    if (fallbackDomains.has(domain)) {
      return { success: false, fallback: true, error: "Domain flagged for fallback" };
    }

    // Deduplicate concurrent requests for the same URL.
    let promise = activeBypasses.get(url);
    if (!promise) {
      promise = performBypass(url);
      activeBypasses.set(url, promise);
      promise.finally(() => activeBypasses.delete(url));
    }

    try {
      return await promise;
    } catch (err) {
      const count = (failureCounts.get(domain) ?? 0) + 1;
      failureCounts.set(domain, count);
      if (count >= 2) fallbackDomains.add(domain);
      persistState();
      return { success: false, error: err.message };
    }
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.action) {
    sendResponse({ success: false, error: "Invalid message" });
    return false;
  }

  const handler = actions[msg.action];
  if (!handler) {
    sendResponse({ success: false, error: `Unknown action: ${msg.action}` });
    return false;
  }

  const result = handler(msg.payload ?? {}, sender);

  // Async handler returns a Promise — keep the channel open.
  if (result instanceof Promise) {
    result.then(sendResponse).catch((e) =>
      sendResponse({ success: false, error: e.message })
    );
    return true;
  }

  sendResponse(result);
  return false;
});

// ─── Filename Normalization ────────────────────────────────────────────────

// Pre-compiled regexes (avoid re-creation on every download event).
const RE_TRAILING_DUP   = /\s*\(\d+\)$/;
const RE_BRACKETS       = /[\[\]\(\)\{\}]/g;
const RE_EP_PREFIX      = /^EP((\.\d+)+)\./i;
const RE_BRANDING       = /[-\s]*\bdesiremovies[\w\-.]*\b|\b(10bits?|hevc|hq|hd)\b/gi;
const RE_WEBDL          = /\bwebdl\b/gi;
const RE_SEASON         = /\b(S\d{2})\b/gi;
const RE_AUDIO_DOTS     = /(5\.1|2\.0|7\.1|8\.1|2\.1)/g;
const RE_ALL_DOTS       = /\./g;
const RE_DOT_PLACEHOLDER = /_DOT_/g;
const RE_NON_ALNUM      = /[^a-zA-Z0-9\-.]/g;
const RE_MULTI_SPACE    = /\s+/g;
const RE_TRAILING_PUNCT = /[-.]+$/;

/**
 * Clean and normalize a downloaded filename.
 *
 * Strips site branding, quality tags, and dot-spacing. Standardizes episode
 * ranges, audio channel notation, and WEB-DL naming. Title-cases each word.
 */
function cleanFilename(filename) {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;

  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx);
  let epTag = "";

  // Remove trailing duplicate-file suffix and bracket characters.
  base = base.replace(RE_TRAILING_DUP, "").replace(RE_BRACKETS, " ");

  // Extract leading EP range (e.g. "EP.1.5." → "EP01-05").
  base = base.replace(RE_EP_PREFIX, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    epTag = nums[0] === nums.at(-1)
      ? `EP${pad(nums[0])}`
      : `EP${pad(nums[0])}-${pad(nums.at(-1))}`;
    return "";
  });

  const clean = base
    .replace(RE_BRANDING, "")
    .replace(RE_WEBDL, "WEB-DL")
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
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return clean + ext;
}

/** Intercept every download and suggest a cleaned filename. */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  try {
    suggest({ filename: cleanFilename(item.filename) });
  } catch (e) {
    console.error("[DM] Filename cleaning error:", e);
    suggest();
  }
});
