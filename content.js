// content.js — DesireMovies Automation
// Injected into DesireMovies and KatMovieHD pages.
//
// Intercepts clicks on Gyanigurus bypass links and performs a headless bypass
// (GET + POST via background service worker) to extract the GDFlix URL directly,
// avoiding a visible redirect through the Gyanigurus page.
//
// GDFlix links are intentionally NOT intercepted here — they are handled
// by automation.js once the GDFlix tab is open.

(function () {
  "use strict";

  const host = window.location.hostname;
  if (!host.includes("desiremovies") && !host.includes("katmoviehd")) return;

  // ─── Messaging ─────────────────────────────────────────────────────────────

  /**
   * Send a message to the background service worker and return a Promise.
   *
   * @param {string} action
   * @param {object} [payload]
   * @returns {Promise<object>}
   */
  function sendBgMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, payload }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── UI State Helpers ──────────────────────────────────────────────────────

  /**
   * Show a "bypassing" spinner on the clicked link and return a reset function.
   *
   * @param {HTMLAnchorElement} anchor
   * @returns {() => void} Call this to restore the original link state.
   */
  function showBypassingState(anchor) {
    const originalHTML = anchor.innerHTML;
    const originalPointerEvents = anchor.style.pointerEvents;
    const originalCursor = anchor.style.cursor;

    anchor.innerHTML = `<span style="opacity:0.8">⏳ Bypassing…</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";

    return () => {
      anchor.innerHTML = originalHTML;
      anchor.style.pointerEvents = originalPointerEvents;
      anchor.style.cursor = originalCursor;
    };
  }

  // ─── Click Interception ────────────────────────────────────────────────────

  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");

    // Only intercept Gyanigurus links. GDFlix links open directly through
    // automation.js in the new tab — no headless bypass needed here.
    if (!href || !href.includes("gyanigurus")) return;

    e.preventDefault();
    e.stopPropagation();

    const restoreLink = showBypassingState(anchor);

    try {
      const response = await sendBgMessage("bypass_gyanigurus", { url: href });
      const targetUrl = (response?.success && response.gdflixUrl) ? response.gdflixUrl : href;

      if (!response?.success) {
        console.warn("[DM] Headless bypass failed, falling back to direct open:", response?.error);
      }

      await sendBgMessage("open_background_tab", { url: targetUrl });
    } catch (err) {
      console.warn("[DM] Bypass error, falling back to direct open:", err.message);
      await sendBgMessage("open_background_tab", { url: href });
    } finally {
      // Restore link after a short delay (user may still be on this page).
      setTimeout(restoreLink, 2000);
    }
  });

})();
