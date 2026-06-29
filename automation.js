/**
 * automation.js — Content Script (document_start)
 *
 * Injected only into bypass-chain pages: Gyanigurus, GDFlix, FastCDN, KMHD.
 * Auto-clicks through each step of the download flow and closes the tab when done.
 */

(function () {
  "use strict";

  const host = location.hostname;

  // ─── Shared Utilities ──────────────────────────────────────────────────────

  const OBSERVER_CONFIG = { childList: true, subtree: true };
  const SAFETY_TIMEOUT_MS = 15_000;

  let completed = false;
  let timeoutId = null;
  let observer = null;

  /** Disconnect the observer and cancel the safety timeout. */
  function cleanup() {
    observer?.disconnect();
    observer = null;
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  /** Send close_tab to the background worker after `ms` milliseconds. */
  function scheduleClose(ms) {
    cleanup();
    setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), ms);
  }

  /**
   * Schedule a close that fires immediately on visibility-hidden (e.g. new tab
   * opened by a click) or after `fallbackMs` as a safety net.
   */
  function scheduleCloseOnHidden(fallbackMs = 4000) {
    cleanup();
    let fired = false;
    const doClose = () => {
      if (fired) return;
      fired = true;
      chrome.runtime.sendMessage({ action: "close_tab" });
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") doClose();
    }, { once: true });
    setTimeout(doClose, fallbackMs);
  }

  /**
   * Click an anchor in-page (suppress target=_blank) and schedule tab close.
   *
   * @param {HTMLElement} el        - The element to click.
   * @param {number}      [ms=10000] - Delay before closing this tab.
   */
  function clickAndClose(el, ms = 10_000) {
    completed = true;
    if (el.tagName === "A") el.target = "_self";
    el.click();
    scheduleClose(ms);
  }

  /**
   * Observe the document for DOM mutations, calling `handler` on each batch
   * (debounced). Arms a safety timeout that cleans up if nothing is found.
   *
   * @param {Function} handler     - Mutation callback (called immediately too).
   * @param {object}   [config]    - MutationObserver config override.
   * @param {number}   [debounceMs=150]
   */
  function observe(handler, config = OBSERVER_CONFIG, debounceMs = 150) {
    let timer;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(handler, debounceMs);
    };
    observer = new MutationObserver(debounced);
    observer.observe(document.documentElement, config);
    timeoutId = setTimeout(cleanup, SAFETY_TIMEOUT_MS);
  }

  // ─── Gyanigurus ────────────────────────────────────────────────────────────
  // Click "Open Link" → wait for GDFlix anchor → navigate in-page.

  if (host.includes("gyanigurus")) {
    const OPEN_LINK_RE = /click\s*here|open\s*link/i;
    let unlocked = false;

    function tryUnlock() {
      if (unlocked) return;
      for (const btn of document.querySelectorAll("button")) {
        if ((btn.getAttribute("onclick") || "").includes("show_content_v") ||
            OPEN_LINK_RE.test(btn.textContent)) {
          btn.click();
          unlocked = true;
          return;
        }
      }
    }

    function tryGdflix() {
      if (completed) return true;
      const a = document.querySelector('a[href*="gdflix"]');
      if (!a) return false;
      clickAndClose(a);
      return true;
    }

    if (!tryGdflix()) {
      tryUnlock();
      if (!tryGdflix()) {
        observe(() => { if (!tryGdflix()) tryUnlock(); });
      }
    }
  }

  // ─── GDFlix ────────────────────────────────────────────────────────────────
  // Find "Instant DL" anchor → click in-page.

  else if (host.includes("gdflix")) {
    const INSTANT_DL_RE = /instant\s*dl/i;

    function tryInstantDL() {
      if (completed) return true;
      for (const a of document.querySelectorAll("a")) {
        const text = a.querySelector("b")?.textContent ?? a.textContent;
        if (INSTANT_DL_RE.test(text)) {
          clickAndClose(a);
          return true;
        }
      }
      return false;
    }

    if (!tryInstantDL()) {
      observe(() => tryInstantDL());
    }
  }

  // ─── FastCDN ───────────────────────────────────────────────────────────────
  // Wait for #vd href to resolve → click #downloadbtn → close after 5s.

  else if (host.includes("fastcdn-dl.pages.dev")) {
    function tryDownload() {
      if (completed) return true;
      const vd = document.querySelector("#vd");
      const btn = document.querySelector("#downloadbtn");
      if (!vd || !btn) return false;

      const href = vd.getAttribute("href");
      if (href && href !== "#" && href.startsWith("http")) {
        completed = true;
        btn.click();
        scheduleClose(5000);
        return true;
      }
      return false;
    }

    if (!tryDownload()) {
      observe(
        () => tryDownload(),
        { ...OBSERVER_CONFIG, attributes: true, attributeFilter: ["href", "class"] }
      );
    }
  }

  // ─── KMHD ─────────────────────────────────────────────────────────────────
  // Click "Unlock Links" (with SvelteKit hydration delay) → click GDFlix → close.

  else if (host.includes("kmhd")) {
    const UNLOCK_RE = /unlock\s*links|click\s*to\s*unlock/i;
    let unlocked = false;

    function tryGdflixOrUnlock() {
      if (completed) return true;

      // Priority: GDFlix link or image-button already in DOM.
      const target =
        document.querySelector('a[href*="gdflix"]') ||
        document.querySelector('img[alt*="gdflix"]')?.closest("button");

      if (target) {
        completed = true;
        if (target.tagName === "A") target.target = "_self";
        target.click();
        scheduleCloseOnHidden();
        return true;
      }

      // Otherwise try the unlock button (1.5s delay for SvelteKit hydration).
      if (!unlocked) {
        for (const btn of document.querySelectorAll("button")) {
          if (UNLOCK_RE.test(btn.textContent)) {
            unlocked = true;
            setTimeout(() => btn.click(), 1500);
            break;
          }
        }
      }
      return false;
    }

    if (!tryGdflixOrUnlock()) {
      observe(() => tryGdflixOrUnlock());
    }
  }
})();
