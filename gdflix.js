// DesireMovies Reimagined — new.gdflix.io Auto-Click
// Auto-clicks the "Instant DL [10GBPS]" button (dynamically rendered)

(function () {
  "use strict";

  let done = false;

  function tryClickInstantDL() {
    if (done) return true;

    // The button is an <a> containing a <b> with "Instant DL" text
    // Try both: direct textContent match and querying the inner <b>
    const anchors = document.querySelectorAll("a");
    for (const a of anchors) {
      // Check the <b> tag inside the anchor
      const b = a.querySelector("b");
      if (b && /instant\s*dl/i.test(b.textContent)) {
        done = true;
        a.click();
        setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 200);
        return true;
      }
      // Fallback: full anchor text
      if (/instant\s*dl/i.test(a.textContent)) {
        done = true;
        a.click();
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
    const observer = new MutationObserver(() => {
      if (tryClickInstantDL()) observer.disconnect();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety timeout
    setTimeout(() => observer.disconnect(), 15_000);
  }

  run();
})();
