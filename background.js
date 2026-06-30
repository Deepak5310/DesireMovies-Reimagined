/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *   1. Full headless bypass: resolves the entire download chain
 *      (Gyanigurus → GDFlix → BusyCDN → final URL) without opening any tabs,
 *      then triggers chrome.downloads.download() directly.
 *   2. Tab management: opens background tabs, closes automation tabs (fallback).
 *   3. Filename normalization: cleans every Chrome download filename.
 */

"use strict";

// ─── Session State ─────────────────────────────────────────────────────────

/** Deduplication: url → in-flight bypass Promise. */
const activeBypasses = new Map();

/** Cache: gyanigurus url → final download url. */
const bypassCache = new Map();

/** Consecutive failure count per hostname. */
const failureCounts = new Map();

/** Hostnames that failed ≥2 times — skip headless, go foreground. */
const fallbackDomains = new Set();

/** Dynamic bypass domains added via Options page. */
let dynamicBypassDomains = [];

function extractDomain(pattern) {
  return pattern.replace(/^\*:\/\/(?:\*\.)?/, "").replace(/\/\*$/, "");
}

/**
 * Restore session state from chrome.storage.session.
 * Awaited before any bypass logic so state survives SW restarts.
 */
const ready = (async () => {
  try {
    const [sessionData, localData] = await Promise.all([
      chrome.storage.session.get(["bypassCache", "failureCounts", "fallbackDomains"]),
      chrome.storage.local.get(["dynamicDomains"])
    ]);
    
    if (sessionData.bypassCache) {
      for (const [k, v] of Object.entries(sessionData.bypassCache))
        bypassCache.set(k, v);
    }
    if (sessionData.failureCounts) {
      for (const [k, v] of Object.entries(sessionData.failureCounts))
        failureCounts.set(k, parseInt(v) || 0);
    }
    if (sessionData.fallbackDomains) {
      for (const d of sessionData.fallbackDomains) fallbackDomains.add(d);
    }
    
    if (localData.dynamicDomains?.bypass) {
      dynamicBypassDomains = localData.dynamicDomains.bypass.map(extractDomain);
    }
  } catch (e) {
    console.warn("[DM] Session restore failed:", e);
  }
})();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.dynamicDomains) {
    const bypass = changes.dynamicDomains.newValue?.bypass || [];
    dynamicBypassDomains = bypass.map(extractDomain);
  }
});

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

/** Fetch page HTML as text. Throws on non-OK status. */
async function fetchHTML(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${new URL(url).hostname}`);
  return res.text();
}

// ─── Logging ───────────────────────────────────────────────────────────────

const MAX_LOGS = 10;
async function addLog(title, message, status = "info") {
  try {
    const data = await chrome.storage.local.get(["bypassLogs"]);
    const logs = data.bypassLogs || [];
    logs.unshift({ title, message, status, timestamp: Date.now() });
    if (logs.length > MAX_LOGS) logs.pop();
    await chrome.storage.local.set({ bypassLogs: logs });
  } catch (e) {
    console.warn("[DM] Failed to add log", e);
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

/** Allowlist: allows statically defined and dynamically added bypass domains. */
function isAllowedBypassUrl(url) {
  if (!isHttpUrl(url)) return false;
  const h = new URL(url).hostname;
  if (h === "gyanigurus.xyz" || h.endsWith(".gyanigurus.xyz")) return true;
  return dynamicBypassDomains.some(domain => h === domain || h.endsWith("." + domain));
}

// ─── Headless Bypass — Full Chain ──────────────────────────────────────────

const GDFLIX_HREF_RE = /href=["'](https?:\/\/[^"']*gdflix[^"']*)['"]/i;
const INSTANT_DL_RE = /href=["'](https?:\/\/instant\.busycdn\.xyz\/[^"']+)['"]/i;

/**
 * Resolve the ENTIRE download chain headlessly:
 *
 *   1. GET Gyanigurus page → extract GDFlix URL
 *   2. GET GDFlix page → extract "Instant DL" busycdn URL
 *   3. fetch(busycdn, redirect:manual) → read Location header
 *      → parse ?url= param → final Google download URL
 *
 * @param {string} url - A validated Gyanigurus URL.
 * @returns {Promise<{ success: true, downloadUrl: string }>}
 */
async function resolveFullChain(url) {
  await ready;

  if (bypassCache.has(url)) {
    return { success: true, downloadUrl: bypassCache.get(url) };
  }

  const domain = new URL(url).hostname;

  // Step 1: Gyanigurus → GDFlix URL
  const html1 = await fetchHTML(url);
  let match = html1.match(GDFLIX_HREF_RE);
  if (!match) {
    // Try POST with hidden form fields (some pages need this)
    const body = new URLSearchParams();
    for (const match of html1.matchAll(/<input[^>]+>/gi)) {
      const tag = match[0];
      if (/type=["']?hidden["']?/i.test(tag)) {
        const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
        const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
        if (name) body.append(name, value);
      }
    }
    const res2 = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res2.ok) throw new Error(`HTTP ${res2.status} on Gyanigurus POST`);
    match = (await res2.text()).match(GDFLIX_HREF_RE);
  }
  if (!match) throw new Error("GDFlix link not found on Gyanigurus page");

  const gdflixUrl = match[1];
  console.log("[DM] Step 1 done: GDFlix URL →", gdflixUrl);

  // Step 2: GDFlix → "Instant DL" busycdn URL
  const html2 = await fetchHTML(gdflixUrl);
  const instantMatch = html2.match(INSTANT_DL_RE);
  if (!instantMatch) throw new Error("Instant DL link not found on GDFlix page");

  const busycdnUrl = instantMatch[1];
  console.log("[DM] Step 2 done: BusyCDN URL →", busycdnUrl.slice(0, 60) + "…");

  // Step 3: BusyCDN 302 → follows redirect to FastCDN → extract ?url= from final URL
  // NOTE: redirect:"manual" returns opaque response in service workers (can't read
  // Location header). Instead, let fetch follow the redirect and read response.url.
  const redirectRes = await fetchWithTimeout(busycdnUrl);
  const finalUrl = new URL(redirectRes.url).searchParams.get("url");
  if (!finalUrl) throw new Error("No ?url= param in redirect destination");

  console.log("[DM] Step 3 done: Final URL →", finalUrl.slice(0, 80) + "…");

  // Cache the final download URL
  bypassCache.set(url, finalUrl);
  failureCounts.set(domain, 0);
  persistState();

  return { success: true, downloadUrl: finalUrl };
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

  /**
   * Full headless bypass: resolves entire chain and triggers download directly.
   * No tabs opened at all.
   */
  async full_bypass({ url }) {
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
      promise = resolveFullChain(url);
      activeBypasses.set(url, promise);
      promise.finally(() => activeBypasses.delete(url));
    }

    try {
      const result = await promise;

      // Trigger the download directly from the service worker.
      chrome.downloads.download({ url: result.downloadUrl });
      console.log("[DM] Download triggered directly — zero tabs opened.");

      return { success: true, downloadStarted: true };
    } catch (err) {
      const count = (failureCounts.get(domain) ?? 0) + 1;
      failureCounts.set(domain, count);
      if (count >= 2) fallbackDomains.add(domain);
      persistState();
      console.warn("[DM] Full bypass failed:", err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Legacy bypass: resolves only to GDFlix URL (for tab-based fallback).
   */
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

    try {
      const html = await fetchHTML(url);
      let match = html.match(GDFLIX_HREF_RE);
      if (!match) {
        const body = new URLSearchParams();
        for (const match of html.matchAll(/<input[^>]+>/gi)) {
          const tag = match[0];
          if (/type=["']?hidden["']?/i.test(tag)) {
            const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
            const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
            if (name) body.append(name, value);
          }
        }
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (res.ok) match = (await res.text()).match(GDFLIX_HREF_RE);
      }
      if (match) return { success: true, gdflixUrl: match[1] };
      throw new Error("GDFlix link not found");
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "add_log") {
    addLog(req.payload.title, req.payload.message, req.payload.status);
    sendResponse({ success: true });
    return false;
  }

  if (req.action === "full_bypass") {
    addLog("Bypass Started", `Headless fetch for ${new URL(req.payload.url).hostname}`, "info");
    resolveFullChain(req.payload.url)
      .then((result) => {
        addLog("Download Started", "Successfully resolved final download link.", "success");
        chrome.downloads.download({ url: result.downloadUrl });
        sendResponse({ success: true });
      })
      .catch((err) => {
        addLog("Headless Failed", err.message, "error");
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (req.action === "bypass_gyanigurus") {
    actions.bypass_gyanigurus(req.payload)
      .then((res) => {
        if (res.success) {
          addLog("Tab Fallback", "Headless failed, using background tab for GDFlix.", "warning");
        }
        sendResponse(res);
      })
      .catch((err) => {
        addLog("Tab Fallback Failed", err.message, "error");
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  const handler = actions[req.action];
  if (!handler) {
    sendResponse({ success: false, error: `Unknown action: ${req.action}` });
    return false;
  }

  const result = handler(req.payload ?? {}, sender);
  if (result instanceof Promise) {
    result.then(sendResponse).catch((e) => sendResponse({ success: false, error: e.message }));
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
const RE_BRANDING = /[-\s]*\b(desiremovies|katmoviehd)[\w\-.]*\b|\b(10bits?|hevc|hq|hd|4k|2160p|1080p|720p|480p|dual[- ]?audio|esubs?|multi[- ]?audio|x264|x265|web[- ]?dl|brrip|bluray)\b/gi;
const RE_EXTRA_DASHES = /-{2,}/g;
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
