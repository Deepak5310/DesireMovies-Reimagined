// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Auto-click "Click Here To Open Links"
// Step 2: Auto-click the gdflix link that appears

(function () {
  "use strict";

  let done = false; // guard — ensure we only ever click gdflix once

  function tryClickOpenButton() {
    for (const btn of document.querySelectorAll("button")) {
      if (
        (btn.getAttribute("onclick") || "").includes("show_content_v") ||
        /click\s*here|open\s*link/i.test(btn.textContent)
      ) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function tryClickGdflix() {
    if (done) return true; // already clicked, ignore
    const a = document.querySelector('a[href*="gdflix"]');
    if (a) {
      done = true;
      a.click();
      return true;
    }
    return false;
  }

  function observe() {
    let openBtnClicked = false;

    const observer = new MutationObserver(() => {
      if (done) { observer.disconnect(); return; }
      if (!openBtnClicked) {
        openBtnClicked = tryClickOpenButton();
      } else {
        if (tryClickGdflix()) observer.disconnect();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Try immediately if DOM is already ready
    if (tryClickGdflix()) return;
    tryClickOpenButton();

    setTimeout(() => observer.disconnect(), 30_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe);
  } else {
    observe();
  }
})();
