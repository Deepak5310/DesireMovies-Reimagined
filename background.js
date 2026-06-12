/**
 * background.js — Background Service Worker
 * DesireMovies Reimagined Chrome Extension
 *
 * Proxies cross-origin requests to bypass CORS limitations.
 */

"use strict";

// Concurrent bypass deduplication map (url -> Promise)
const activeBypasses = new Map();

// Session bypass cache (url -> gdflixUrl)
const bypassCache = new Map();

// Fallback intelligence counters
const failureCounters = new Map(); // domain -> count
const fallbackDomains = new Set(); // domains flagged for foreground fallback

// Alarm registration for periodic cache cleanup
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("cleanup_cache", { periodInMinutes: 24 * 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup_cache") {
    cleanExpiredCache();
  }
});

/**
 * Clean up expired IMDb ratings from chrome.storage.local (older than 1 day)
 */
function cleanExpiredCache() {
  chrome.storage.local.get(null, (items) => {
    if (chrome.runtime.lastError) return;
    const keysToRemove = [];
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    
    for (const [key, val] of Object.entries(items)) {
      if (key.startsWith("imdb_") && val && typeof val === "object") {
        if (!val.timestamp || now - val.timestamp > ONE_DAY) {
          keysToRemove.push(key);
        }
      }
    }
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove);
    }
  });
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
 * Atomic function to perform gyanigurus bypass.
 */
async function performBypass(url) {
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
  const html1 = await response1.text();

  // Check if gdflix URL is already present in the HTML (fallback)
  let gdflixMatch = html1.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i);
  if (gdflixMatch) {
    bypassCache.set(url, gdflixMatch[1]);
    failureCounters.set(domain, 0); // reset failures on success
    return { success: true, gdflixUrl: gdflixMatch[1] };
  }

  // Step 2: Extract hidden inputs from form
  const inputRegex = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const nameRegex = /name=["']([^"']*)["']/i;
  const valueRegex = /value=["']([^"']*)["']/i;
  
  const inputs = html1.match(inputRegex) || [];
  const formData = new URLSearchParams();
  
  for (const input of inputs) {
    const nameM = input.match(nameRegex);
    const valueM = input.match(valueRegex);
    if (nameM) {
      formData.append(nameM[1], valueM ? valueM[1] : "");
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
  const html2 = await response2.text();

  // Step 4: Extract gdflix URL from the POST response
  gdflixMatch = html2.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i);
  if (gdflixMatch) {
    bypassCache.set(url, gdflixMatch[1]);
    failureCounters.set(domain, 0); // reset failures on success
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
    case "fetch":
      (async () => {
        try {
          const response = await fetchWithTimeout(payload.url, payload.options);
          const text = await response.text();
          sendResponse({
            success: true,
            data: { status: response.status, statusText: response.statusText, text }
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep channel open

    case "close_tab":
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          chrome.tabs.remove(tabId, () => {
            // Ignore potential runtime errors if closed concurrently
            if (chrome.runtime.lastError) {}
          });
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
          
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep channel open

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
  }
});

// Function to dynamically register content script matches for a new hostname
async function registerMirrorDomain(hostname) {
  try {
    const scriptId = "dm-dynamic-script";
    const pattern = `*://*.${hostname}/*`;
    
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const existing = registered.find(s => s.id === scriptId);
    
    if (existing) {
      if (existing.matches.includes(pattern)) return;
      
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
  } catch (err) {
    console.error("Failed to register dynamic script:", err);
  }
}

// Dynamic injection and registration of content.js/redesign.css on DesireMovies domains
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0 && details.url) {
    try {
      const url = new URL(details.url);
      if (url.hostname.includes("desiremovies")) {
        const hostname = url.hostname;
        const pattern = `*://*.${hostname}/*`;
        
        // Get registered scripts to check if this hostname is already registered
        const registered = await chrome.scripting.getRegisteredContentScripts();
        const existing = registered.find(s => s.id === "dm-dynamic-script");
        const isRegistered = existing && existing.matches.includes(pattern);
        
        if (!isRegistered) {
          // Register so subsequent page loads run at document_start natively
          await registerMirrorDomain(hostname);
          
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
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
});
