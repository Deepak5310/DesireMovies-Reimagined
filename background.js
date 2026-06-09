/**
 * background.js — Background Service Worker
 * DesireMovies Reimagined Chrome Extension
 *
 * Proxies cross-origin requests to bypass CORS limitations.
 */

"use strict";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetch") {
    (async () => {
      try {
        const response = await fetch(request.url, request.options);
        const text = await response.text();
        sendResponse({ success: true, data: { status: response.status, statusText: response.statusText, text } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep the message channel open for async response
  }

  if (request.action === "close_tab" && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id);
  }
});
