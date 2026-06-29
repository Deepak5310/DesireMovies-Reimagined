// automation.js — DesireMovies Automation
// Injected into bypass-chain pages (Gyanigurus, GDFlix, FastCDN, KMHD).
// Handles DOM-based auto-clicking and tab-close signalling for each step
// of the download bypass flow.

(function () {
  "use strict";

  const host = window.location.hostname;

  // ─── Shared Utilities ──────────────────────────────────────────────────────

  /** Shared MutationObserver options used by every domain handler. */
  const OBSERVER_OPTIONS = { childList: true, subtree: true };

  /** Safety timeout before giving up and disconnecting the observer (ms). */
  const SAFETY_TIMEOUT_MS = 15000;

  let done = false;
  let safetyTimeoutId = null;
  let observer = null;

  /** Disconnect the MutationObserver and cancel the safety timeout. */
  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (safetyTimeoutId) {
      clearTimeout(safetyTimeoutId);
      safetyTimeoutId = null;
    }
  }

  /**
   * Returns a debounced version of `fn` that fires after `delay` ms of inactivity.
   * Used to batch rapid DOM mutations into a single handler call.
   */
  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Clicks a link anchor in-page (no new tab) and schedules a tab-close message.
   * Used as the final action once the target link is found.
   *
   * @param {HTMLAnchorElement} anchor - The link to click.
   * @param {number} [closeDelayMs=10000] - ms to wait before sending close_tab.
   */
  function clickAndScheduleClose(anchor, closeDelayMs = 10000) {
    done = true;
    anchor.target = "_self";
    anchor.click();
    cleanup();
    setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), closeDelayMs);
  }

  /**
   * Start observing the document for DOM changes, calling `handler` on each
   * mutation batch (debounced). Also arms the safety timeout.
   *
   * @param {Function} handler - Called on mutation (and optionally immediately).
   * @param {number} [debounceMs=150] - Debounce delay in ms.
   */
  function observeWithTimeout(handler, debounceMs = 150) {
    const debouncedHandler = debounce(handler, debounceMs);
    observer = new MutationObserver(debouncedHandler);
    observer.observe(document.documentElement, OBSERVER_OPTIONS);
    safetyTimeoutId = setTimeout(cleanup, SAFETY_TIMEOUT_MS);
  }

  // ─── Gyanigurus Handler ────────────────────────────────────────────────────
  // Flow: click "Open Link" button → wait for GDFlix anchor → click it in-page.

  if (host.includes("gyanigurus.xyz")) {
    const OPEN_LINK_RE = /click\s*here|open\s*link/i;
    let unlockClicked = false;

    /** Click the "Open Link" / "Click Here" unlock button if present. */
    function tryClickUnlock() {
      if (unlockClicked) return true;
      for (const btn of document.querySelectorAll("button")) {
        const onclick = btn.getAttribute("onclick") || "";
        if (onclick.includes("show_content_v") || OPEN_LINK_RE.test(btn.textContent)) {
          btn.click();
          unlockClicked = true;
          return true;
        }
      }
      return false;
    }

    /** Navigate to GDFlix in-page once its link appears in the DOM. */
    function tryClickGdflixLink() {
      if (done) return true;
      const anchor = document.querySelector('a[href*="gdflix"]');
      if (anchor) {
        clickAndScheduleClose(anchor);
        return true;
      }
      return false;
    }

    function runGyanigurus() {
      if (tryClickGdflixLink()) return;
      tryClickUnlock();
      if (tryClickGdflixLink()) return;

      observeWithTimeout(() => {
        if (tryClickGdflixLink()) return;
        if (!unlockClicked) tryClickUnlock();
      });
    }

    runGyanigurus();
  }

  // ─── GDFlix Handler ────────────────────────────────────────────────────────
  // Flow: find "Instant DL" anchor → click it in-page.

  else if (host.includes("gdflix")) {
    const INSTANT_DL_RE = /instant\s*dl/i;

    /** Find and click the Instant DL anchor if it exists in the DOM. */
    function tryClickInstantDL() {
      if (done) return true;
      for (const anchor of document.querySelectorAll("a")) {
        const labelEl = anchor.querySelector("b");
        const labelText = labelEl ? labelEl.textContent : anchor.textContent;
        if (INSTANT_DL_RE.test(labelText)) {
          clickAndScheduleClose(anchor);
          return true;
        }
      }
      return false;
    }

    function runGdflix() {
      if (tryClickInstantDL()) return;
      observer = new MutationObserver(() => {
        if (tryClickInstantDL()) cleanup();
      });
      observer.observe(document.documentElement, OBSERVER_OPTIONS);
      safetyTimeoutId = setTimeout(cleanup, SAFETY_TIMEOUT_MS);
    }

    runGdflix();
  }

  // ─── FastCDN Handler ───────────────────────────────────────────────────────
  // Flow: wait for #vd href to resolve (not "#") → click #downloadbtn → close tab after 5s.

  else if (host.includes("fastcdn-dl.pages.dev")) {
    /** Click download once the loader resolves (href becomes a real URL). */
    function tryClickDownload() {
      if (done) return true;
      const anchor = document.querySelector("#vd");
      const btn = document.querySelector("#downloadbtn");
      if (!anchor || !btn) return false;

      const href = anchor.getAttribute("href");
      if (href && href !== "#" && href.startsWith("http")) {
        done = true;
        btn.click();
        cleanup();
        // Close this tab 5s after triggering the download.
        setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 5000);
        return true;
      }
      return false;
    }

    function runFastCDN() {
      if (tryClickDownload()) return;
      observer = new MutationObserver(() => {
        if (tryClickDownload()) cleanup();
      });
      observer.observe(document.documentElement, {
        ...OBSERVER_OPTIONS,
        attributes: true,
        attributeFilter: ["href", "class"]
      });
      safetyTimeoutId = setTimeout(cleanup, SAFETY_TIMEOUT_MS);
    }

    runFastCDN();
  }

  // ─── KMHD Handler ─────────────────────────────────────────────────────────
  // Flow: click "Unlock Links" button (waits 1.5s for SvelteKit hydration) →
  //       watch for GDFlix link/button → click it → close this tab.

  else if (host.includes("kmhd")) {
    const UNLOCK_RE = /unlock\s*links|click\s*to\s*unlock/i;
    let unlockClicked = false;
    let gdflixClicked = false;

    /**
     * Schedule a one-time tab close.
     * Fires immediately on visibility-hidden (e.g. new tab opened) or after 4s fallback.
     */
    function scheduleTabClose() {
      let closed = false;
      const doClose = () => {
        if (closed) return;
        closed = true;
        chrome.runtime.sendMessage({ action: "close_tab" });
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") doClose();
      });
      setTimeout(doClose, 4000);
    }

    function tryClickGdflixOrUnlock() {
      if (gdflixClicked) return true;

      // Priority: if GDFlix link or image-button is already in DOM, click it.
      const gdflixAnchor = document.querySelector('a[href*="gdflix"]');
      const gdflixImgBtn = document.querySelector('img[alt*="gdflix"]')?.closest("button");
      const target = gdflixAnchor || gdflixImgBtn;

      if (target) {
        gdflixClicked = true;
        if (target.tagName === "A") target.target = "_self";
        target.click();
        cleanup();
        scheduleTabClose();
        return true;
      }

      // Otherwise try to click the unlock button.
      // Waits 1.5s after click to allow SvelteKit to hydrate the link list.
      if (!unlockClicked) {
        for (const btn of document.querySelectorAll("button")) {
          if (UNLOCK_RE.test(btn.textContent)) {
            unlockClicked = true;
            setTimeout(() => btn.click(), 1500);
            break;
          }
        }
      }
      return false;
    }

    function runKmhd() {
      if (tryClickGdflixOrUnlock()) return;
      observeWithTimeout(() => tryClickGdflixOrUnlock());
    }

    runKmhd();
  }

})();
