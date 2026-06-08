/**
 * background.js — Background Service Worker
 * DesireMovies Reimagined Chrome Extension
 *
 * Proxies cross-origin requests to bypass CORS limitations.
 */

"use strict";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetch") {
    fetch(request.url, request.options)
      .then((response) =>
        response.text().then((text) => ({
          status: response.status,
          statusText: response.statusText,
          text: text,
        }))
      )
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
});
