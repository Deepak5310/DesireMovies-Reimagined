/**
 * content.js — Content Script (document_idle)
 *
 * Injected only into DesireMovies and KatMovieHD pages.
 * Intercepts clicks on Gyanigurus download links and sends them to the
 * background service worker for fully headless resolution:
 *
 *   Primary:  full_bypass → resolves entire chain → download starts directly
 *   Fallback: bypass_gyanigurus → opens GDFlix tab (automation.js handles the rest)
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
    if (!href) return;

    const isGyanigurus = href.includes("gyanigurus");
    const isKmhd = href.includes("links.kmhd.eu");

    if (!isGyanigurus && !isKmhd) return;

    e.preventDefault();
    e.stopPropagation();

    const restore = showStatus(anchor, "⏳ Bypassing…");

    try {
      if (isGyanigurus) {
        // Primary path: fully headless — no tabs at all.
        const res = await sendBg("full_bypass", { url: href });

        if (res?.success) {
          // Download started directly by the service worker.
          showStatus(anchor, "✅ Download started");
          setTimeout(restore, 3000);
          return;
        }

        // full_bypass failed — fall back to tab-based approach.
        console.warn("[DM] Full bypass failed, falling back to tab:", res?.error);

        const fallback = await sendBg("bypass_gyanigurus", { url: href });
        const targetUrl = fallback?.success && fallback.gdflixUrl
          ? fallback.gdflixUrl
          : href;

        await sendBg("open_background_tab", { url: targetUrl });
      } else if (isKmhd) {
        // KMHD has Cloudflare JS challenges, so headless fetch fails.
        // Instead, open it in a background tab so automation.js can handle it silently.
        await sendBg("open_background_tab", { url: href });
        showStatus(anchor, "✅ Bypassing in background");
      }
    } catch (err) {
      // Everything failed — open the original link directly.
      console.warn("[DM] All bypass paths failed:", err.message);
      await sendBg("open_background_tab", { url: href }).catch(() => {});
    } finally {
      // Keep the success message visible for a bit longer for KMHD since it takes time
      setTimeout(restore, isKmhd ? 4000 : 2000);
    }
  });
})();
