// DesireMovies Reimagined — gyanigurus.xyz Auto-Redirect
// Step 1: Click "Click Here To Open Links" button
// Step 2: Find & click the gdflix link that appears after

(function () {
  "use strict";


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
   * Priority order for direct download hosts.
   * Index 0 = highest priority (clicked first).
   * Add or reorder entries here to change preference.
   */
  const HOST_PRIORITY = [
    "gdflix",       // 1st choice
    "gdtot",        // 2nd
    "driveleech",   // 3rd
    "drivebot",     // 4th
    "hubdrive",     // 5th
    "hubcloud",     // 6th
    "multicloud",   // 7th
  ];

  /** Returns the priority rank of a URL (lower = better). -1 means no match. */
  function getLinkPriority(href) {
    const lower = href.toLowerCase();
    for (let i = 0; i < HOST_PRIORITY.length; i++) {
      if (lower.includes(HOST_PRIORITY[i])) return i;
    }
    return -1;
  }

  /**
   * Collect all direct-download links on the page, pick the highest-priority
   * one, and click it. Returns true if a link was found and clicked.
   */
  function tryClickDirectLink() {
    const candidates = [];

    // Primary selector — the site's own link class
    document.querySelectorAll("a.hover_a.link, a.link, a[href]").forEach((a) => {
      const rank = getLinkPriority(a.href);
      if (rank !== -1) candidates.push({ el: a, rank });
    });

    if (candidates.length === 0) return false;

    // Sort by rank ascending (lowest index = best)
    candidates.sort((a, b) => a.rank - b.rank);
    candidates[0].el.click();
    return true;
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
