// DesireMovies Reimagined — new.gdflix.io Auto-Click
// Auto-clicks the "Instant DL [10GBPS]" button (dynamically rendered)

(function () {
  "use strict";

  const INSTANT_DL_RE = /instant\s*dl/i;

  let done = false;
  let cachedButton = null;
  let safetyTimeoutId = null;
  let observer = null;

  function tryClickInstantDL() {
    if (done) return true;

    if (cachedButton) {
      done = true;
      cachedButton.click();
      
      // Cleanup observer and timeout immediately to prevent memory leak
      if (observer) {
        observer.disconnect();
      }
      if (safetyTimeoutId) {
        clearTimeout(safetyTimeoutId);
      }

      setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 200);
      return true;
    }

    // The button is an <a> containing a <b> with "Instant DL" text
    // Try both: direct textContent match and querying the inner <b>
    const anchors = document.querySelectorAll("a");
    for (const a of anchors) {
      // Check the <b> tag inside the anchor
      const b = a.querySelector("b");
      if (b && INSTANT_DL_RE.test(b.textContent)) {
        cachedButton = a;
        done = true;
        a.click();
        
        if (observer) {
          observer.disconnect();
        }
        if (safetyTimeoutId) {
          clearTimeout(safetyTimeoutId);
        }

        setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 200);
        return true;
      }
      // Fallback: full anchor text
      if (INSTANT_DL_RE.test(a.textContent)) {
        cachedButton = a;
        done = true;
        a.click();
        
        if (observer) {
          observer.disconnect();
        }
        if (safetyTimeoutId) {
          clearTimeout(safetyTimeoutId);
        }

        setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 200);
        return true;
      }
    }
    return false;
  }

  function run() {
    // 1. Try immediately
    if (tryClickInstantDL()) return;

    // 2. Set up MutationObserver for JS-rendered button
    observer = new MutationObserver(() => {
      if (tryClickInstantDL()) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety timeout
    safetyTimeoutId = setTimeout(() => {
      if (observer) {
        observer.disconnect();
      }
    }, 15_000);
  }

  run();
})();
