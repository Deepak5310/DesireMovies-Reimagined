// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Click "Click Here To Open Links" button
// Step 2: Find & click the gdflix link that appears after

(function () {
  "use strict";

  // Selector for the gdflix (or similar direct) link
  const DIRECT_LINK_RE = /gdflix|gdtot|hubcloud|driveleech|drivebot/i;

  /**
   * Try to find and click the primary "Click Here To Open Links" button.
   * Returns true if found and clicked.
   */
  function tryClickOpenButton() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const onclick = btn.getAttribute("onclick") || "";
      const text = btn.textContent.trim();
      if (
        onclick.includes("show_content_v") ||
        /open\s*link|click\s*here/i.test(text)
      ) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Try to find and click the best direct download link (gdflix / similar).
   * Returns true if found and clicked.
   */
  function tryClickDirectLink() {
    // Look for <a class="hover_a link"> with a matching href
    const anchors = document.querySelectorAll("a.hover_a.link, a.link");
    for (const a of anchors) {
      if (DIRECT_LINK_RE.test(a.href)) {
        a.click();
        return true;
      }
    }

    // Fallback: any anchor whose href matches the pattern
    const all = document.querySelectorAll("a[href]");
    for (const a of all) {
      if (DIRECT_LINK_RE.test(a.href)) {
        a.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Watch for DOM changes and trigger actions when relevant elements appear.
   */
  function observe() {
    let phase = "waiting_for_open_btn";

    const observer = new MutationObserver(() => {
      if (phase === "waiting_for_open_btn") {
        if (tryClickOpenButton()) {
          phase = "waiting_for_direct_link";
        }
      } else if (phase === "waiting_for_direct_link") {
        if (tryClickDirectLink()) {
          phase = "done";
          observer.disconnect();
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also try immediately in case DOM is already ready
    if (document.readyState !== "loading") {
      if (tryClickDirectLink()) return; // Direct link already present (page 2)
      tryClickOpenButton();             // Otherwise try step 1
    }

    // Safety timeout — disconnect after 30s to avoid memory leak
    setTimeout(() => observer.disconnect(), 30_000);
  }

  // Run as early as possible
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe);
  } else {
    observe();
  }
})();
