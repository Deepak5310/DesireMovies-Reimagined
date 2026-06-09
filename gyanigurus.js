// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Auto-click "Click Here To Open Links"
// Step 2: Auto-click the gdflix link that appears

(function () {
  "use strict";

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
    const a = document.querySelector('a[href*="gdflix"]');
    if (a) { a.click(); return true; }
    return false;
  }

  function observe() {
    let phase = "open_btn";

    const observer = new MutationObserver(() => {
      if (phase === "open_btn" && tryClickOpenButton()) {
        phase = "gdflix";
      } else if (phase === "gdflix" && tryClickGdflix()) {
        observer.disconnect();
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
