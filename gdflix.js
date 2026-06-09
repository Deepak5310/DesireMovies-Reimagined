// DesireMovies Reimagined — gdflix.dev Auto-Click
// Auto-clicks the "Instant DL [10GBPS]" download button

(function () {
  "use strict";

  let done = false;

  function tryClickInstantDL() {
    if (done) return true;
    // Match any anchor whose text contains "Instant DL"
    const anchors = document.querySelectorAll("a");
    for (const a of anchors) {
      if (/instant\s*dl/i.test(a.textContent)) {
        done = true;
        a.click();
        return true;
      }
    }
    return false;
  }

  function observe() {
    // Try immediately — button may already be in DOM
    if (tryClickInstantDL()) return;

    const observer = new MutationObserver(() => {
      if (tryClickInstantDL()) observer.disconnect();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety timeout
    setTimeout(() => observer.disconnect(), 30_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe);
  } else {
    observe();
  }
})();
