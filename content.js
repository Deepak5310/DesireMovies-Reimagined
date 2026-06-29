// content.js - DesireMovies Automation
// Injected on DesireMovies to intercept bypass links and trigger headless background bypass

(function() {
  "use strict";

  if (!window.location.hostname.includes("desiremovies")) {
    return;
  }

  // Helper to send messages to background script
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

  // Intercept clicks on the whole document
  document.addEventListener("click", async (e) => {
    // Check if clicked element or its parent is a link
    const a = e.target.closest("a");
    if (!a) return;

    const href = a.getAttribute("href");
    if (href && (href.includes("gyanigurus") || href.includes("gdflix"))) {
      e.preventDefault();
      e.stopPropagation();

      const originalHTML = a.innerHTML;
      const originalPointerEvents = a.style.pointerEvents;
      
      // Update UI to show bypassing state
      a.innerHTML = `<span style="opacity:0.8;">⏳ Bypassing...</span>`;
      a.style.pointerEvents = "none";
      a.style.cursor = "wait";

      try {
        const response = await sendBgMessage("bypass_gyanigurus", { url: href });

        if (response && response.success && response.gdflixUrl) {
          sendBgMessage("open_background_tab", { url: response.gdflixUrl });
        } else {
          // Fallback: open the original URL if background bypass failed
          sendBgMessage("open_background_tab", { url: href });
        }
      } catch (err) {
        console.warn("[DM Automation] Bypass failed, falling back to foreground:", err);
        sendBgMessage("open_background_tab", { url: href });
      } finally {
        // Restore original UI (just in case they stay on the page)
        setTimeout(() => {
            a.innerHTML = originalHTML;
            a.style.pointerEvents = originalPointerEvents;
            a.style.cursor = "";
        }, 2000);
      }
    }
  });

})();
