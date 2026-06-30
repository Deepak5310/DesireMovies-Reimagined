/**
 * content.js — Content Script (document_idle)
 *
 * Injected only into DesireMovies pages.
 * Intercepts clicks on Gyanigurus download links and sends them to the
 * background service worker for fully headless resolution:
 *
 *   Primary:  full_bypass → resolves entire chain → download starts directly
 */

(function () {
  "use strict";

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

  /** Show a status indicator on the link. Returns a restore function. */
  function showStatus(anchor, text) {
    const saved = {
      html: anchor.innerHTML,
      pointerEvents: anchor.style.pointerEvents,
      cursor: anchor.style.cursor,
    };
    anchor.innerHTML = `<span style="opacity:0.8">${text}</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";

    anchor.dataset.bypassing = "true";

    return () => {
      anchor.innerHTML = saved.html;
      anchor.style.pointerEvents = saved.pointerEvents;
      anchor.style.cursor = saved.cursor;
      delete anchor.dataset.bypassing;
    };
  }

  // ─── Click Interception ────────────────────────────────────────────────────

  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    const isGyanigurus = href.includes("gyanigurus");

    if (!isGyanigurus) return;

    if (anchor.dataset.bypassing) return;
    e.preventDefault();
    e.stopPropagation();

    const restore = showStatus(anchor, "⏳ Bypassing…");

    try {
      // Primary path: fully headless — no tabs at all.
      const res = await sendBg("full_bypass", { url: href });

      if (res?.success) {
        // Download started directly by the service worker.
        showStatus(anchor, "✅ Download started");
        setTimeout(restore, 3000);
        return;
      }

      // full_bypass failed — let user proceed manually
      console.warn("[DM] Full bypass failed:", res?.error);
      showStatus(anchor, "❌ Failed");
      window.open(href, '_blank');
    } catch (err) {
      console.warn("[DM] Request failed:", err.message);
      showStatus(anchor, "❌ Error");
      window.open(href, '_blank');
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();
