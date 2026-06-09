// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Auto-click "Click Here To Open Links"
// Step 2: Auto-click the gdflix link that appears

(function () {
  "use strict";

  let openBtnClicked = false;
  let done = false;

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
        /click\s*here|open\s*link/i.test(btn.textContent)
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
      a.click();
      // Close this gyanigurus tab after gdflix opens (reduced delay for performance)
      setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 200);
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
      if (tryClickGdflix()) {
        observer.disconnect();
        return;
      }
      if (!openBtnClicked) {
        tryClickOpenButton();
      }
    }, 150);

    const observer = new MutationObserver(debouncedCallback);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety timeout to prevent resource leak
    setTimeout(() => observer.disconnect(), 15_000);
  }

  run();
})();
