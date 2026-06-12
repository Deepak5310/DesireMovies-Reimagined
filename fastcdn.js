// DesireMovies Reimagined — fastcdn-dl.pages.dev Auto-Click & Auto-Close
// Auto-clicks the "Download Here" button and closes the tab after download starts.

(function () {
  "use strict";

  let done = false;
  let safetyTimeoutId = null;
  let observer = null;

  function tryClickDownload() {
    if (done) return true;

    const anchor = document.querySelector("#vd");
    const btn = document.querySelector("#downloadbtn");
    
    if (anchor && btn) {
      const href = anchor.getAttribute("href");
      // The page initially sets href="#" and updates it to the real URL after 3 seconds.
      // We only click once the real download URL has been populated.
      if (href && href !== "#" && (href.startsWith("http://") || href.startsWith("https://"))) {
        done = true;
        btn.click();
        
        // Cleanup observer and timeout immediately to prevent memory leak
        if (observer) {
          observer.disconnect();
        }
        if (safetyTimeoutId) {
          clearTimeout(safetyTimeoutId);
        }

        // Close this tab after 5 seconds to ensure browser registers the download
        setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 5000);
        return true;
      }
    }
    return false;
  }

  function run() {
    // 1. Try immediately (in case the page was already loaded / cached)
    if (tryClickDownload()) return;

    // 2. Set up MutationObserver to watch for class and href updates
    observer = new MutationObserver(() => {
      if (tryClickDownload()) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "class"]
    });

    // Safety timeout (15 seconds) to disconnect if button never gets populated
    safetyTimeoutId = setTimeout(() => {
      if (observer) {
        observer.disconnect();
      }
    }, 15_000);
  }

  run();
})();
