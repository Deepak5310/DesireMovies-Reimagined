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

  if (request.action === "bypass_gyanigurus") {
    (async () => {
      try {
        const url = request.url;
        // Step 1: Fetch the first landing page
        const response1 = await fetch(url);
        const html1 = await response1.text();

        // Check if gdflix URL is already present in the HTML (fallback)
        let gdflixMatch = html1.match(/href=["'](https?:\/\/[^"']*gdflix[^"']*)["']/i);
        if (gdflixMatch) {
          sendResponse({ success: true, gdflixUrl: gdflixMatch[1] });
          return;
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
        const response2 = await fetch(url, {
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
          sendResponse({ success: true, gdflixUrl: gdflixMatch[1] });
        } else {
          sendResponse({ success: false, error: "gdflix link not found in POST response" });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }
});
