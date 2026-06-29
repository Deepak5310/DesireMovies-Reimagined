/**
 * content.js — Content Script (document_idle)
 *
 * Injected only into DesireMovies and KatMovieHD pages.
 * Intercepts clicks on Gyanigurus bypass links, performs a headless bypass
 * via the background service worker, and opens the resolved GDFlix URL
 * in a background tab — avoiding a visible redirect.
 *
 * GDFlix links are NOT intercepted here; they're handled by automation.js
 * once the GDFlix tab opens.
 */

(function () {
  "use strict";

  // Defense-in-depth: manifest already limits injection to target domains.
  const { hostname } = location;
  if (!hostname.includes("desiremovies") && !hostname.includes("katmoviehd")) return;

  // ─── Messaging ─────────────────────────────────────────────────────────────

  /** Send a message to the background service worker. */
  function sendBg(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, payload }, (res) => {
          chrome.runtime.lastError
            ? reject(new Error(chrome.runtime.lastError.message))
            : resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ─── UI Feedback ───────────────────────────────────────────────────────────

  /** Show a "bypassing" spinner and return a function to restore the link. */
  function showSpinner(anchor) {
    const saved = {
      html: anchor.innerHTML,
      pointerEvents: anchor.style.pointerEvents,
      cursor: anchor.style.cursor,
    };
    anchor.innerHTML = `<span style="opacity:0.8">⏳ Bypassing…</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";

    return () => {
      anchor.innerHTML = saved.html;
      anchor.style.pointerEvents = saved.pointerEvents;
      anchor.style.cursor = saved.cursor;
    };
  }

  // ─── Click Interception ────────────────────────────────────────────────────

  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href?.includes("gyanigurus")) return;

    e.preventDefault();
    e.stopPropagation();

    const restore = showSpinner(anchor);

    try {
      const res = await sendBg("bypass_gyanigurus", { url: href });
      const targetUrl = res?.success && res.gdflixUrl ? res.gdflixUrl : href;

      if (!res?.success) {
        console.warn("[DM] Headless bypass failed, opening directly:", res?.error);
      }

      await sendBg("open_background_tab", { url: targetUrl });
    } catch (err) {
      console.warn("[DM] Bypass error, opening directly:", err.message);
      await sendBg("open_background_tab", { url: href });
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();
