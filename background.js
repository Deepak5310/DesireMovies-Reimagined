/**
 * background.js — Background Service Worker
 * DesireMovies Automation
 *
 * Handles file renaming during downloads and background tasks like closing tabs
 * and headless bypass proxying.
 */

"use strict";

// Concurrent bypass deduplication map (url -> Promise)
const activeBypasses = new Map();

// Session bypass cache copies
const bypassCache = new Map();
const failureCounters = new Map(); // domain -> count
const fallbackDomains = new Set(); // domains flagged for foreground fallback

let isInitialized = false;
const initPromise = (async () => {
  try {
    const data = await chrome.storage.session.get(["bypassCache", "failureCounters", "fallbackDomains"]);
    if (data.bypassCache) {
      for (const [k, v] of Object.entries(data.bypassCache)) {
        bypassCache.set(k, v);
      }
    }
    if (data.failureCounters) {
      for (const [k, v] of Object.entries(data.failureCounters)) {
        failureCounters.set(k, parseInt(v) || 0);
      }
    }
    if (data.fallbackDomains) {
      for (const d of data.fallbackDomains) {
        fallbackDomains.add(d);
      }
    }
  } catch (err) {
    console.warn("[DM Automation] Failed to load session storage:", err);
  }
  isInitialized = true;
})();

async function ensureInitialized() {
  if (!isInitialized) {
    await initPromise;
  }
}

async function updateSessionStorage() {
  try {
    await chrome.storage.session.set({
      bypassCache: Object.fromEntries(bypassCache),
      failureCounters: Object.fromEntries(failureCounters),
      fallbackDomains: Array.from(fallbackDomains)
    });
  } catch (err) {
    console.warn("[DM Automation] Failed to update session storage:", err);
  }
}

/**
 * Helper to fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * URL Security Validation Helpers
 */
function isValidHttpUrl(string) {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function isAllowedBypassUrl(urlStr) {
  if (!isValidHttpUrl(urlStr)) return false;
  const url = new URL(urlStr);
  const host = url.hostname;
  return (
    host === "gyanigurus.xyz" ||
    host.endsWith(".gyanigurus.xyz") ||
    host.includes("gdflix")
  );
}

/**
 * Robust Attribute Parser for HTML Tags
 */
function parseAttributes(tagString) {
  const attrs = {};
  const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = attrRegex.exec(tagString)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] || match[3] || match[4] || "";
    attrs[key] = value;
  }
  return attrs;
}

/**
 * Atomic function to perform gyanigurus bypass.
 */
async function performBypass(url) {
  await ensureInitialized();

  // Check session cache first
  if (bypassCache.has(url)) {
    return { success: true, gdflixUrl: bypassCache.get(url) };
  }

  const domain = new URL(url).hostname;

  // Check if domain is flagged for foreground fallback
  if (fallbackDomains.has(domain)) {
    throw new Error("Domain flagged for foreground fallback");
  }

  // Step 1: Fetch the first landing page
  const response1 = await fetchWithTimeout(url);
  if (!response1.ok) {
    throw new Error(`HTTP error ${response1.status} fetching landing page`);
  }
  const html1 = await response1.text();

  // Check if gdflix URL is already present in the HTML (fallback)
  let gdflixMatch = html1.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i);
  if (gdflixMatch) {
    bypassCache.set(url, gdflixMatch[1]);
    failureCounters.set(domain, 0); // reset failures on success
    await updateSessionStorage();
    return { success: true, gdflixUrl: gdflixMatch[1] };
  }

  // Step 2: Extract hidden inputs from form using robust attribute parser
  const inputRegex = /<input[^>]*>/gi;
  const tags = html1.match(inputRegex) || [];
  const formData = new URLSearchParams();

  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    if (attrs.type === "hidden" && attrs.name) {
      formData.append(attrs.name, attrs.value || "");
    }
  }

  // Step 3: Perform POST request to the same URL to unlock links
  const response2 = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData.toString()
  });
  if (!response2.ok) {
    throw new Error(`HTTP error ${response2.status} submitting bypass form`);
  }
  const html2 = await response2.text();

  // Step 4: Extract gdflix URL from the POST response
  gdflixMatch = html2.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i);
  if (gdflixMatch) {
    bypassCache.set(url, gdflixMatch[1]);
    failureCounters.set(domain, 0); // reset failures on success
    await updateSessionStorage();
    return { success: true, gdflixUrl: gdflixMatch[1] };
  }

  throw new Error("gdflix link not found in POST response");
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || !message.action) {
    sendResponse({ success: false, error: "Invalid message format" });
    return false;
  }

  const { action, payload = {} } = message;

  switch (action) {
    case "close_tab":
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          chrome.tabs.remove(tabId).catch(() => { });
        });
      }
      return false;

    case "open_background_tab":
      if (payload.url) {
        chrome.tabs.create({ url: payload.url, active: false });
      }
      sendResponse({ success: true });
      return false;

    case "bypass_gyanigurus":
      (async () => {
        const url = payload.url;
        if (!url) {
          sendResponse({ success: false, error: "Missing URL payload" });
          return;
        }

        if (!isAllowedBypassUrl(url)) {
          sendResponse({ success: false, error: "Target bypass URL is not allowed or is invalid" });
          return;
        }

        await ensureInitialized();
        const domain = new URL(url).hostname;

        // Check if domain is flagged for fallback to foreground
        if (fallbackDomains.has(domain)) {
          sendResponse({ success: false, fallback: true, error: "Foreground fallback active" });
          return;
        }

        // Deduplicate concurrent bypasses for same URL
        let bypassPromise = activeBypasses.get(url);
        if (!bypassPromise) {
          bypassPromise = performBypass(url);
          activeBypasses.set(url, bypassPromise);

          // Clean up map once resolved/rejected
          bypassPromise.finally(() => {
            activeBypasses.delete(url);
          });
        }

        try {
          const result = await bypassPromise;
          sendResponse(result);
        } catch (err) {
          // Fallback intelligence tracking
          const currentFailures = (failureCounters.get(domain) || 0) + 1;
          failureCounters.set(domain, currentFailures);

          if (currentFailures >= 2) {
            fallbackDomains.add(domain);
          }
          await updateSessionStorage();

          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep channel open

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
  }
});

/**
 * Clean and normalize downloaded filenames (mimics rename.ps1 logic)
 */
function cleanFilename(filename) {
  const lastDotIdx = filename.lastIndexOf(".");
  if (lastDotIdx === -1) return filename;

  const ext = filename.slice(lastDotIdx);
  let baseName = filename.slice(0, lastDotIdx);

  let ep = "";

  // 1. Strip duplicate suffixes, brackets, and extract EP prefix
  baseName = baseName
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\[\]\(\)\{\}]/g, " ")
    .replace(/^EP((\.\d+)+)\./i, (_, group) => {
      const nums = group.split(".").filter(Boolean).map(Number);
      const pad = (n) => String(n).padStart(2, "0");
      ep = nums[0] === nums[nums.length - 1] 
        ? `EP${pad(nums[0])}` 
        : `EP${pad(nums[0])}-${pad(nums[nums.length - 1])}`;
      return "";
    });

  // 2. Pro Pipeline: Clean, Normalize, and Format
  const cleanName = baseName
    .replace(/[\-\s]*\bdesiremovies[\w\-\.]*\b|\b(10bits?|hevc|hq|hd)\b/gi, "")
    .replace(/\bwebdl\b/gi, "WEB-DL")
    .replace(/\b(S\d{2})\b/gi, ep ? `$1 ${ep}` : "$1")
    .replace(/(5\.1|2\.0|7\.1|8\.1|2\.1)/g, m => m.replace(".", "_DOT_"))
    .replace(/\./g, " ")
    .replace(/_DOT_/g, ".")
    .replace(/[^a-zA-Z0-9\-\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\-\.]+$/, "")
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return cleanName + ext;
}

// Intercept downloads and apply cleaning rules to filenames before they are saved
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  try {
    const cleanName = cleanFilename(downloadItem.filename);
    suggest({ filename: cleanName });
  } catch (err) {
    console.error("[DM Automation] Error during filename suggestion:", err);
    suggest(); // Fallback to default name if error occurs
  }
});
