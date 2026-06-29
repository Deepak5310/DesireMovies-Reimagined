/**
 * background.js — Service Worker
 * DesireMovies Automation
 *
 * Responsibilities:
 *   1. Headless bypass: fetches Gyanigurus pages and extracts the GDFlix URL
 *      so content.js can open it without navigating the user's current tab.
 *   2. Tab management: opens background tabs and closes automation tabs on request.
 *   3. Filename normalization: intercepts chrome.downloads and cleans filenames.
 */

"use strict";

// ─── Session State ─────────────────────────────────────────────────────────
// These in-memory Maps are restored from chrome.storage.session on startup.
// They will reset if the service worker is killed (expected MV3 behaviour).

/** Deduplication map: url → pending bypass Promise. */
const activeBypasses = new Map();

/** Cache of successfully resolved GDFlix URLs keyed by source URL. */
const bypassCache = new Map();

/** Consecutive failure count per hostname. */
const failureCounters = new Map();

/** Hostnames that have failed ≥2 times and should fall back to foreground navigation. */
const fallbackDomains = new Set();

/**
 * Restore Maps from session storage. Awaited before any bypass logic runs,
 * so state survives service-worker restarts within the same browser session.
 */
const initPromise = (async () => {
  try {
    const data = await chrome.storage.session.get([
      "bypassCache",
      "failureCounters",
      "fallbackDomains"
    ]);
    if (data.bypassCache) {
      for (const [k, v] of Object.entries(data.bypassCache)) bypassCache.set(k, v);
    }
    if (data.failureCounters) {
      for (const [k, v] of Object.entries(data.failureCounters))
        failureCounters.set(k, parseInt(v) || 0);
    }
    if (data.fallbackDomains) {
      for (const d of data.fallbackDomains) fallbackDomains.add(d);
    }
  } catch (err) {
    console.warn("[DM] Failed to restore session state:", err);
  }
})();

/** Persist the current state of all Maps back to session storage. */
async function persistSessionState() {
  try {
    await chrome.storage.session.set({
      bypassCache: Object.fromEntries(bypassCache),
      failureCounters: Object.fromEntries(failureCounters),
      fallbackDomains: Array.from(fallbackDomains)
    });
  } catch (err) {
    console.warn("[DM] Failed to persist session state:", err);
  }
}

// ─── Network Utilities ─────────────────────────────────────────────────────

/**
 * fetch() wrapper that aborts after `timeoutMs` milliseconds.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}

// ─── Security Helpers ──────────────────────────────────────────────────────

/** Returns true only for http: or https: URLs. */
function isValidHttpUrl(string) {
  try {
    const { protocol } = new URL(string);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Allowlist for headless bypass targets.
 * Only Gyanigurus URLs may be submitted to performBypass().
 */
function isAllowedBypassUrl(urlStr) {
  if (!isValidHttpUrl(urlStr)) return false;
  const { hostname } = new URL(urlStr);
  return hostname === "gyanigurus.xyz" || hostname.endsWith(".gyanigurus.xyz");
}

// ─── Headless Bypass ───────────────────────────────────────────────────────

/**
 * Fetches a Gyanigurus page, submits the hidden form, and extracts the GDFlix URL.
 *
 * Strategy:
 *   GET  → check if GDFlix href is already present (some pages don't need a POST)
 *   POST → submit hidden form inputs → extract GDFlix href from response HTML
 *
 * @param {string} url - A validated Gyanigurus URL.
 * @returns {Promise<{ success: true, gdflixUrl: string }>}
 * @throws {Error} if the GDFlix URL cannot be extracted.
 */
async function performBypass(url) {
  await initPromise;

  if (bypassCache.has(url)) {
    return { success: true, gdflixUrl: bypassCache.get(url) };
  }

  const domain = new URL(url).hostname;

  // Step 1: GET landing page
  const getResponse = await fetchWithTimeout(url);
  if (!getResponse.ok) {
    throw new Error(`HTTP ${getResponse.status} fetching landing page`);
  }
  const html1 = await getResponse.text();

  // Check if GDFlix link is already present (no POST needed)
  let gdflixMatch = html1.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)['"]/i);
  if (gdflixMatch) {
    return cacheAndReturn(url, domain, gdflixMatch[1]);
  }

  // Step 2: Extract hidden form fields using DOMParser (safe, no regex HTML parsing)
  const doc = new DOMParser().parseFromString(html1, "text/html");
  const formData = new URLSearchParams();
  for (const input of doc.querySelectorAll('input[type="hidden"][name]')) {
    formData.append(input.name, input.value ?? "");
  }

  // Step 3: POST the hidden form to unlock links
  const postResponse = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString()
  });
  if (!postResponse.ok) {
    throw new Error(`HTTP ${postResponse.status} submitting bypass form`);
  }
  const html2 = await postResponse.text();

  // Step 4: Extract GDFlix URL from POST response
  gdflixMatch = html2.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)['"]/i);
  if (gdflixMatch) {
    return cacheAndReturn(url, domain, gdflixMatch[1]);
  }

  throw new Error("GDFlix link not found in POST response");
}

/** Cache a successful bypass result and reset the failure counter. */
async function cacheAndReturn(sourceUrl, domain, gdflixUrl) {
  bypassCache.set(sourceUrl, gdflixUrl);
  failureCounters.set(domain, 0);
  await persistSessionState();
  return { success: true, gdflixUrl };
}

// ─── Message Handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || !message.action) {
    sendResponse({ success: false, error: "Invalid message format" });
    return false;
  }

  const { action, payload = {} } = message;

  switch (action) {
    // Close the tab that sent this message.
    case "close_tab": {
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          chrome.tabs.remove(tabId).catch(() => {});
        });
      }
      sendResponse({ success: true });
      return false;
    }

    // Open a URL in a new background tab.
    case "open_background_tab": {
      if (payload.url) {
        chrome.tabs.create({ url: payload.url, active: false });
      }
      sendResponse({ success: true });
      return false;
    }

    // Headless Gyanigurus bypass: fetch + form-submit + extract GDFlix URL.
    case "bypass_gyanigurus": {
      const url = payload.url;
      if (!url) {
        sendResponse({ success: false, error: "Missing URL in payload" });
        return false;
      }
      if (!isAllowedBypassUrl(url)) {
        sendResponse({ success: false, error: "URL not in bypass allowlist" });
        return false;
      }

      (async () => {
        await initPromise;
        const domain = new URL(url).hostname;

        if (fallbackDomains.has(domain)) {
          sendResponse({ success: false, fallback: true, error: "Domain flagged for foreground fallback" });
          return;
        }

        // Deduplicate concurrent requests for the same URL.
        let bypassPromise = activeBypasses.get(url);
        if (!bypassPromise) {
          bypassPromise = performBypass(url);
          activeBypasses.set(url, bypassPromise);
          bypassPromise.finally(() => activeBypasses.delete(url));
        }

        try {
          const result = await bypassPromise;
          sendResponse(result);
        } catch (err) {
          const failures = (failureCounters.get(domain) ?? 0) + 1;
          failureCounters.set(domain, failures);
          if (failures >= 2) fallbackDomains.add(domain);
          await persistSessionState();
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep message channel open for async sendResponse
    }

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
  }
});

// ─── Filename Normalization ────────────────────────────────────────────────

/**
 * Clean and normalize a downloaded filename.
 *
 * Transformations applied (in order):
 *   - Strip trailing duplicate-number suffixes e.g. " (2)"
 *   - Remove bracket characters
 *   - Extract leading EP range prefix (e.g. "EP.1.5." → "EP01-05")
 *   - Strip DesireMovies branding and quality tags (10bit, hevc, hq, hd)
 *   - Normalise "webdl" → "WEB-DL"
 *   - Insert extracted EP range after the season token (S01 → "S01 EP01-05")
 *   - Preserve audio channel dots (5.1, 7.1, etc.) via a _DOT_ placeholder
 *     while replacing all other dots with spaces
 *   - Strip non-alphanumeric characters (except hyphens and dots)
 *   - Collapse whitespace and title-case every word
 *
 * @param {string} filename - Raw filename including extension.
 * @returns {string} Cleaned filename.
 */
function cleanFilename(filename) {
  const lastDotIdx = filename.lastIndexOf(".");
  if (lastDotIdx === -1) return filename;

  const ext = filename.slice(lastDotIdx);
  let baseName = filename.slice(0, lastDotIdx);
  let episodeTag = "";

  // 1. Remove trailing duplicate-file suffix and bracket characters.
  baseName = baseName
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\[\]\(\)\{\}]/g, " ");

  // 2. Extract leading EP range (e.g. "EP.1.5." → episodeTag = "EP01-05").
  baseName = baseName.replace(/^EP((\.\d+)+)\./i, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    const first = nums[0];
    const last = nums[nums.length - 1];
    episodeTag = first === last ? `EP${pad(first)}` : `EP${pad(first)}-${pad(last)}`;
    return "";
  });

  // 3. Clean, normalise, and format the base name.
  const cleanName = baseName
    // Remove site branding and common quality/codec tags.
    .replace(/[\-\s]*\bdesiremovies[\w\-\.]*\b|\b(10bits?|hevc|hq|hd)\b/gi, "")
    // Normalise WEB-DL variants.
    .replace(/\bwebdl\b/gi, "WEB-DL")
    // Inject the episode tag after the season token (e.g. S01 → "S01 EP01-05").
    .replace(/\b(S\d{2})\b/gi, episodeTag ? `$1 ${episodeTag}` : "$1")
    // Protect audio channel dots (5.1, 7.1 etc.) from the global dot→space step.
    .replace(/(5\.1|2\.0|7\.1|8\.1|2\.1)/g, (m) => m.replace(".", "_DOT_"))
    .replace(/\./g, " ")
    .replace(/_DOT_/g, ".")
    // Strip anything that isn't alphanumeric, a hyphen, or a dot.
    .replace(/[^a-zA-Z0-9\-\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Remove trailing hyphens or dots.
    .replace(/[\-\.]+$/, "")
    // Title-case each word.
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return cleanName + ext;
}

/**
 * Intercept every download and suggest a cleaned filename.
 * Falls back to the browser's default name if cleaning throws.
 */
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  try {
    suggest({ filename: cleanFilename(downloadItem.filename) });
  } catch (err) {
    console.error("[DM] Error cleaning filename:", err);
    suggest(); // Let the browser use its default name.
  }
});
