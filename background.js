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
    host === "new.gdflix.io" ||
    host.endsWith(".gdflix.io")
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
    if (cached?.rating && cached?.id) {
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
        const queryTitleNormalized = normalizeString(trimmedTitle);
        const targetYear = year ? parseInt(year) : null;
        
        // A. Match exactly (normalized) and within 1 year
        let best = suggestData.d.find(
          (item) =>
            item.id &&
            item.id.startsWith("tt") &&
            item.l &&
            normalizeString(item.l) === queryTitleNormalized &&
            (!targetYear || !item.y || Math.abs(item.y - targetYear) <= 1)
        );
        
        // B. Match exactly (normalized) regardless of year
        if (!best) {
          best = suggestData.d.find(
            (item) =>
              item.id &&
              item.id.startsWith("tt") &&
              item.l &&
              normalizeString(item.l) === queryTitleNormalized
          );
        }
        
        // C. Fallback: match by title contains and is a film/tv show
        if (!best) {
          best = suggestData.d.find(
            (item) =>
              item.id &&
              item.id.startsWith("tt") &&
              (item.qid === "movie" ||
                item.qid === "tvSeries" ||
                item.qid === "tvMiniSeries")
          );
        }
        
        if (best) imdbId = best.id;
      }
    }
  } catch (err) {
    console.warn("[DM Reimagined] Suggestion fetch failed:", err);
  }

  // 3. Fetch IMDb Details Page and Parse Rating
  let imdbRating = null;
  if (imdbId) {
    try {
      const ratingsUrl = `https://www.imdb.com/title/${imdbId}/`;
      const ratingsRes = await fetchWithTimeout(ratingsUrl);
      const html = await ratingsRes.text();
      
      if (html) {
        // Method A: JSON-LD script blocks
        const ldMatches = [...html.matchAll(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi)];
        for (const match of ldMatches) {
          try {
            const parsed = JSON.parse(match[1]);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              const subItems = item["@graph"] ? item["@graph"] : [item];
              for (const sub of subItems) {
                if (sub.aggregateRating?.ratingValue) {
                  imdbRating = `${parseFloat(sub.aggregateRating.ratingValue).toFixed(1)}/10`;
                  break;
                }
              }
              if (imdbRating) break;
            }
          } catch (e) {}
          if (imdbRating) break;
        }

        // Fallback B: Aggregated rating test-id regex (avoids DOMParser in service worker!)
        if (!imdbRating) {
          const scoreMatch = html.match(/data-testid="hero-rating-bar__aggregate-rating__score"[^>]*>\s*<span[^>]*>\s*([\d.]+)\s*<\/span>/i);
          if (scoreMatch) {
            imdbRating = `${parseFloat(scoreMatch[1]).toFixed(1)}/10`;
          }
        }

        // Fallback C: Raw regex ratingValue match
        if (!imdbRating) {
          const ratingMatch = html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/);
          if (ratingMatch) {
            imdbRating = `${parseFloat(ratingMatch[1]).toFixed(1)}/10`;
          }
        }
      }
    } catch (err) {
      console.warn("[DM Reimagined] Detail page fetch/parse failed:", err);
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
          chrome.tabs.remove(tabId).catch(() => {});
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
          const result = await getImdbRating(payload.title, payload.year);
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

// Helper to get the base second-level domain (e.g. desiremovies.casa) with security checks to prevent subdomain hijacking
function getBaseDesireMoviesDomain(hostname) {
  const parts = hostname.split(".");
  if (parts.length < 2) return hostname;
  
  // Verify second-to-last part to ensure desiremovies is the SLD (or SLD on multi-part TLD)
  const sld = parts[parts.length - 2];
  if (sld.includes("desiremovies")) {
    return parts.slice(-2).join(".");
  }
  
  if (parts.length >= 3) {
    const sld2 = parts[parts.length - 3];
    if (sld2.includes("desiremovies")) {
      return parts.slice(-3).join(".");
    }
  }
  return null;
}

// Function to dynamically register content script matches for a new base domain
async function registerMirrorDomain(hostname) {
  try {
    const baseDomain = getBaseDesireMoviesDomain(hostname);
    if (!baseDomain) return;

    if (registeredMirrors.has(baseDomain)) return;

    const scriptId = "dm-dynamic-script";
    const pattern = `*://*.${baseDomain}/*`;
    
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const existing = registered.find(s => s.id === scriptId);
    
    if (existing) {
      if (existing.matches.includes(pattern)) {
        registeredMirrors.add(baseDomain);
        return;
      }
      
      const newMatches = [...existing.matches, pattern];
      await chrome.scripting.updateContentScripts([{
        id: scriptId,
        matches: newMatches
      }]);
    } else {
      await chrome.scripting.registerContentScripts([{
        id: scriptId,
        matches: [pattern],
        js: ["content.js"],
        css: ["redesign.css"],
        runAt: "document_start",
        allFrames: false
      }]);
    }
    registeredMirrors.add(baseDomain);
  } catch (err) {
    console.error("[DM Reimagined] Failed to register dynamic script:", err);
  }
}

// Dynamic injection and registration of content.js/redesign.css on DesireMovies domains.
// The filter prevents this from running on non-matching domains.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0 && details.url) {
    try {
      const url = new URL(details.url);
      const baseDomain = getBaseDesireMoviesDomain(url.hostname);
      if (!baseDomain) return;

      if (registeredMirrors.has(baseDomain)) return;
      
      const pattern = `*://*.${baseDomain}/*`;
      
      // Get registered scripts to check if this hostname is already registered
      const registered = await chrome.scripting.getRegisteredContentScripts();
      const existing = registered.find(s => s.id === "dm-dynamic-script");
      const isRegistered = existing && existing.matches.includes(pattern);
      
      if (isRegistered) {
        registeredMirrors.add(baseDomain);
      } else {
        // Register so subsequent page loads run at document_start natively
        await registerMirrorDomain(url.hostname);
        
        // Inject now for the very first load to cover this current page
        chrome.scripting.insertCSS({
          target: { tabId: details.tabId },
          files: ["redesign.css"]
        }).catch(() => {});

        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ["content.js"]
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
}, {
  url: [{ hostContains: "desiremovies" }]
});

/**
 * Clean and normalize downloaded filenames (mimics rename.ps1 logic)
 */
function cleanFilename(filename) {
  const lastDotIdx = filename.lastIndexOf(".");
  if (lastDotIdx === -1) return filename;
  
  let baseName = filename.slice(0, lastDotIdx);
  const ext = filename.slice(lastDotIdx);
  
  // Strip browser-added duplicate suffix (e.g. " (1)")
  baseName = baseName.replace(/\s*\(\d+\)$/, "");
  
  let ep = "";
  
  // 1. Parse TV show episode numbers/ranges (e.g. EP.1.5. or EP.01.)
  const epMatch = baseName.match(/^EP((\.\d+)+)\./i);
  if (epMatch) {
    const numbers = epMatch[1].split(".").filter(Boolean).map(Number);
    if (numbers.length > 0) {
      const first = numbers[0];
      const last = numbers[numbers.length - 1];
      const pad = (num) => String(num).padStart(2, "0");
      
      if (first === last) {
        ep = `EP${pad(first)}`;
      } else {
        ep = `EP${pad(first)}-${pad(last)}`;
      }
    }
    baseName = baseName.replace(/^EP(\.\d+)+\./i, "");
  }
  
  // 2. Remove tags and DesireMovies branding (including any mirror domain suffix) safely using word boundaries
  baseName = baseName
    .replace(/\bdesiremovies(?:[\.\- ]+[a-z0-9\-]+)*\b/gi, "")
    .replace(/\b10bits?\b/gi, "")
    .replace(/\b(hevc|hq|hd)\b/gi, "");
    
  // 3. Capitalize WEB-DL
  baseName = baseName.replace(/\bwebdl\b/gi, "WEB-DL");
  
  // 4. Inject EP information after Sxx if present
  if (ep) {
    baseName = baseName.replace(/\b(S\d{2})\b/gi, `$1 ${ep}`);
  }
  
  // 5. Clean up multiple spaces, convert dots to spaces, and capitalize the first letter of each word to Title Case
  const cleanName = baseName
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
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
