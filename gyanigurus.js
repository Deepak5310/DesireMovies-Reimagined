// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Auto-click "Click Here To Open Links"
// Step 2: Auto-click the gdflix link that appears

(function () {
  "use strict";

  const BUTTON_TEXT_RE = /click\s*here|open\s*link/i;

  let openBtnClicked = false;
  let done = false;
  let safetyTimeoutId = null;
  let observer = null;

  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function tryClickOpenButton() {
    if (openBtnClicked) return true;
    for (const btn of document.querySelectorAll("button")) {
      if (
        (btn.getAttribute("onclick") || "").includes("show_content_v") ||
        BUTTON_TEXT_RE.test(btn.textContent)
      ) {
        btn.click();
        openBtnClicked = true;
        return true;
      }
    }
    return false;
  }

  function tryClickGdflix() {
    if (done) return true;
    const a = document.querySelector('a[href*="gdflix"]');
    if (a) {
      done = true;
      a.target = "_self"; // Force same tab navigation
      a.click();
      
      // Cleanup observer and timeout immediately to prevent memory leak
      if (observer) {
        observer.disconnect();
      }
      if (safetyTimeoutId) {
        clearTimeout(safetyTimeoutId);
      }
      
      // 10s fallback close if same-tab navigation fails to unload
      setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 10000);
      return true;
    }
    return false;
  }

  function run() {
    // 1. Check if gdflix is already there (unlikely, but safe check)
    if (tryClickGdflix()) return;

    // 2. Click the open button
    tryClickOpenButton();

    // 3. Check again immediately because click handler changes are often synchronous
    if (tryClickGdflix()) return;

    // 4. Fallback to MutationObserver if changes are asynchronous (debounced to save CPU)
    const debouncedCallback = debounce(() => {
      if (tryClickGdflix()) return;
      if (!openBtnClicked) {
        tryClickOpenButton();
      }
    }, 150);

    observer = new MutationObserver(debouncedCallback);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety timeout to prevent resource leak
    safetyTimeoutId = setTimeout(() => {
      if (observer) {
        observer.disconnect();
      }
    }, 15_000);
  }

  run();
})();
