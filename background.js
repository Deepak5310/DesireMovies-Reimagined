/**
 * background.js — Background Service Worker
 * DesireMovies Reimagined Chrome Extension
 *
 * Proxies cross-origin requests to bypass CORS limitations,
 * handles background link bypass logic, and registers dynamic content scripts.
 */

"use strict";

// Concurrent bypass deduplication map (url -> Promise)
const activeBypasses = new Map();
const activeImdbFetches = new Map();

// Session bypass cache copies
const bypassCache = new Map();
const failureCounters = new Map(); // domain -> count
const fallbackDomains = new Set(); // domains flagged for foreground fallback
const registeredMirrors = new Set(); // cached registered mirror domains

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
    console.warn("[DM Reimagined] Failed to load session storage:", err);
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
    console.warn("[DM Reimagined] Failed to update session storage:", err);
  }
}

// Alarm registration for periodic cache cleanup (every 2 hours)
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.clear("cleanup_cache");
  chrome.alarms.create("cleanup_cache", { periodInMinutes: 2 * 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup_cache") {
    cleanExpiredCache();
  }
});

/**
 * Clean up expired IMDb ratings from chrome.storage.local (older than 2 hours)
 */
async function cleanExpiredCache() {
  try {
    const items = await chrome.storage.local.get(null);
    const keysToRemove = [];
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    for (const [key, val] of Object.entries(items)) {
      if (key.startsWith("imdb_") && val && typeof val === "object") {
        if (!val.timestamp || now - val.timestamp > TWO_HOURS) {
          keysToRemove.push(key);
        }
      }
    }
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  } catch (err) {
    console.warn("[DM Reimagined] Error during local cache cleanup:", err);
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
 * Helper to normalize strings for robust comparison
 */
function normalizeString(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Service Worker side IMDb rating pipeline
 */
async function getImdbRating(title, year) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { rating: "N/A", id: null };

  const cacheKey = `imdb_${trimmedTitle.toLowerCase()}`;

  // 1. Check local cache first
  try {
    const result = await chrome.storage.local.get(cacheKey);
    const cached = result[cacheKey];
    if (cached?.rating && cached.rating !== "N/A" && cached?.id) {
      return { rating: cached.rating, id: cached.id };
    }
  } catch (err) {
    console.warn("[DM Reimagined] Error reading local cache:", err);
  }

  // 2. Fetch from IMDb Suggestions API
  let imdbId = null;
  try {
    const firstChar = trimmedTitle.charAt(0).toLowerCase();
    const suggestUrl = `https://sg.media-imdb.com/suggests/${firstChar}/${encodeURIComponent(trimmedTitle.toLowerCase())}.json`;
    const suggestRes = await fetchWithTimeout(suggestUrl);
    const jsonpText = await suggestRes.text();

    if (jsonpText) {
      let suggestData = null;
      const startIdx = jsonpText.indexOf("(");
      const endIdx = jsonpText.lastIndexOf(")");
      if (startIdx !== -1 && endIdx !== -1) {
        try {
          suggestData = JSON.parse(jsonpText.slice(startIdx + 1, endIdx));
        } catch (e) {
          console.warn("[DM Reimagined] JSONP parse failed:", e);
        }
      }

      if (suggestData?.d?.length > 0) {
        const queryNorm = normalizeString(trimmedTitle);
        const targetYear = year ? parseInt(year) : null;

        const isTT    = (i) => i.id?.startsWith("tt") && i.l;
        const normL   = (i) => normalizeString(i.l);
        const yearOk  = (i, d) => !targetYear || !i.y || Math.abs(i.y - targetYear) <= d;
        const isMedia = (i) => i.qid === "movie" || i.qid === "tvSeries" || i.qid === "tvMiniSeries";

        // Cascading strategies (most → least specific):
        // A. Exact title + year ±1
        // B. Exact title + year ±5  (guards against same-name films from different eras)
        // C. Title starts with query + media + year ±1  (e.g. "Dacoit: A Love Story" for "Dacoit")
        // D. Title starts with query + media + year ±5
        // E. Any media type + year ±1
        // F. Any media type (last resort)
        const strategies = [
          (i) => isTT(i) && normL(i) === queryNorm && yearOk(i, 1),
          (i) => isTT(i) && normL(i) === queryNorm && yearOk(i, 5),
          (i) => isTT(i) && normL(i).startsWith(queryNorm) && isMedia(i) && yearOk(i, 1),
          (i) => isTT(i) && normL(i).startsWith(queryNorm) && isMedia(i) && yearOk(i, 5),
          (i) => isTT(i) && isMedia(i) && yearOk(i, 1),
          (i) => isTT(i) && isMedia(i),
        ];

        let best = null;
        for (const strategy of strategies) {
          best = suggestData.d.find(strategy);
          if (best) break;
        }

        if (best) imdbId = best.id;
      }
    }
  } catch (err) {
    console.warn("[DM Reimagined] Suggestion fetch failed:", err);
  }

  // 3. Fetch IMDb Rating via GraphQL API (Bypasses AWS WAF)
  let imdbRating = null;
  if (imdbId) {
    try {
      const graphqlUrl = "https://caching.graphql.imdb.com/";
      const query = `query { title(id: "${imdbId}") { ratingsSummary { aggregateRating } } }`;
      
      const ratingsRes = await fetchWithTimeout(graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ query })
      });
      
      const json = await ratingsRes.json();
      if (json?.data?.title?.ratingsSummary?.aggregateRating) {
        imdbRating = `${json.data.title.ratingsSummary.aggregateRating.toFixed(1)}/10`;
      }
    } catch (err) {
      console.warn("[DM Reimagined] GraphQL rating fetch failed:", err);
    }
  }

  // 4. Cache and return the result
  if (imdbId && imdbRating) {
    try {
      await chrome.storage.local.set({
        [cacheKey]: { rating: imdbRating, id: imdbId, timestamp: Date.now() }
      });
    } catch (err) {
      console.warn("[DM Reimagined] Error saving local cache:", err);
    }
    return { rating: imdbRating, id: imdbId };
  }

  return { rating: "N/A", id: imdbId };
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
  // Validate standard message format: { action, payload }
  if (!message || typeof message !== "object" || !message.action) {
    sendResponse({ success: false, error: "Invalid message format" });
    return false;
  }

  const { action, payload = {} } = message;

  switch (action) {
    case "open_background_tab":
      if (payload.url) {
        chrome.tabs.create({ url: payload.url, active: false });
      }
      sendResponse({ success: true });
      return false;

    case "close_tab":
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          chrome.tabs.remove(tabId).catch(() => { });
        });
      }
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

    case "get_imdb_rating":
      (async () => {
        try {
          const cacheKey = `imdb_${payload.title.trim().toLowerCase()}`;
          let fetchPromise = activeImdbFetches.get(cacheKey);

          if (!fetchPromise) {
            fetchPromise = getImdbRating(payload.title, payload.year);
            activeImdbFetches.set(cacheKey, fetchPromise);
            fetchPromise.finally(() => {
              activeImdbFetches.delete(cacheKey);
            });
          }

          const result = await fetchPromise;
          sendResponse({ success: true, ...result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep channel open

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
  }
});

// Helper to get the base second-level domain (e.g. desiremovies.casa) with security checks
function getBaseDomain(hostname, keyword) {
  const parts = hostname.split(".");
  if (parts.length < 2) return hostname;

  // Verify second-to-last part to ensure keyword is the SLD (or SLD on multi-part TLD)
  const sld = parts[parts.length - 2];
  if (sld.includes(keyword)) {
    return parts.slice(-2).join(".");
  }

  if (parts.length >= 3) {
    const sld2 = parts[parts.length - 3];
    if (sld2.includes(keyword)) {
      return parts.slice(-3).join(".");
    }
  }
  
  // Fallback if keyword is somewhere else in the hostname
  if (hostname.includes(keyword)) {
    return hostname;
  }
  return null;
}

// Function to dynamically register content scripts for a new base domain
async function registerDynamicScript(baseDomain, scriptId, keyword) {
  try {
    const cacheKey = `${scriptId}_${baseDomain}`;
    if (registeredMirrors.has(cacheKey)) return;

    const pattern1 = `*://*.${baseDomain}/*`;
    const pattern2 = `*://${baseDomain}/*`;

    const registered = await chrome.scripting.getRegisteredContentScripts();
    const existing = registered.find(s => s.id === scriptId);

    if (existing) {
      const newMatches = new Set([...existing.matches, pattern1, pattern2]);
      await chrome.scripting.updateContentScripts([{
        id: scriptId,
        matches: Array.from(newMatches)
      }]);
    } else {
      const config = {
        id: scriptId,
        matches: [pattern1, pattern2],
        runAt: "document_start",
        allFrames: false
      };
      
      if (keyword === "desiremovies") {
        config.js = ["content.js"];
        config.css = ["redesign.css"];
      } else if (keyword === "gdflix") {
        config.js = ["automation.js"];
      }
      
      await chrome.scripting.registerContentScripts([config]);
    }
    registeredMirrors.add(cacheKey);
  } catch (err) {
    console.error(`[DM Reimagined] Failed to register dynamic script for ${keyword}:`, err);
  }
}

// Dynamic injection and registration of scripts on target domains
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0 && details.url) {
    try {
      const url = new URL(details.url);
      const isDesire = url.hostname.includes("desiremovies");
      const isGdflix = url.hostname.includes("gdflix");

      if (!isDesire && !isGdflix) return;

      const keyword = isDesire ? "desiremovies" : "gdflix";
      const baseDomain = getBaseDomain(url.hostname, keyword);
      if (!baseDomain) return;

      const scriptId = isDesire ? "dm-dynamic-script" : "gdflix-dynamic-script";
      const cacheKey = `${scriptId}_${baseDomain}`;

      if (registeredMirrors.has(cacheKey)) return;

      const pattern = `*://*.${baseDomain}/*`;

      // Get registered scripts to check if this hostname is already registered
      const registered = await chrome.scripting.getRegisteredContentScripts();
      const existing = registered.find(s => s.id === scriptId);
      const isRegistered = existing && existing.matches.includes(pattern);

      if (isRegistered) {
        registeredMirrors.add(cacheKey);
      } else {
        // Register so subsequent page loads run at document_start natively
        await registerDynamicScript(baseDomain, scriptId, keyword);

        // Inject now for the very first load to cover this current page
        if (isDesire) {
          chrome.scripting.insertCSS({ target: { tabId: details.tabId }, files: ["redesign.css"] }).catch(() => {});
          chrome.scripting.executeScript({ target: { tabId: details.tabId }, files: ["content.js"] }).catch(() => {});
        } else if (isGdflix) {
          chrome.scripting.executeScript({ target: { tabId: details.tabId }, files: ["automation.js"] }).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
}, {
  url: [{ hostContains: "desiremovies" }, { hostContains: "gdflix" }]
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
    console.error("[DM Reimagined] Error during filename suggestion:", err);
    suggest(); // Fallback to default name if error occurs
  }
});
