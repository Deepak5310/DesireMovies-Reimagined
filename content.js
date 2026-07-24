(function(){
  "use strict";
  if (window.__desiremoviesBypassInjected) return;
  window.__desiremoviesBypassInjected = true;

  function sendBg(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, payload }, (res) => {
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function showStatus(anchor, text) {
    const saved = { html: anchor.innerHTML, pointerEvents: anchor.style.pointerEvents, cursor: anchor.style.cursor };
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

  // Inject Download All Episodes button on pack pages
  if (/\/pack\//i.test(window.location.pathname) || /\/pack\//i.test(window.location.href)) {
    const initPackBtn = () => {
      if (document.getElementById("btn-dl-all-episodes")) return;
      const btn = document.createElement("button");
      btn.id = "btn-dl-all-episodes";
      btn.innerHTML = "⚡ Download All Episodes";
      btn.style.cssText = "position:fixed;bottom:25px;right:25px;z-index:2147483647;padding:14px 24px;background:#e50914;color:#ffffff;font-weight:bold;font-size:16px;font-family:sans-serif;border:none;border-radius:50px;box-shadow:0 6px 25px rgba(229,9,20,0.6);cursor:pointer;transition:all 0.2s ease;";
      btn.onmouseover = () => { btn.style.transform = "scale(1.08)"; btn.style.boxShadow = "0 8px 30px rgba(229,9,20,0.8)"; };
      btn.onmouseout = () => { btn.style.transform = "scale(1)"; btn.style.boxShadow = "0 6px 25px rgba(229,9,20,0.6)"; };
      btn.onclick = async () => {
        btn.disabled = true;
        btn.innerHTML = "⏳ Resolving All Episodes...";
        try {
          const res = await sendBg("bypass_pack", { url: window.location.href });
          if (res?.success) {
            btn.innerHTML = `✅ All ${res.count} Downloads Started!`;
            btn.style.background = "#28a745";
          } else {
            btn.innerHTML = `❌ ${res?.error || "Failed"}`;
            btn.style.background = "#dc3545";
          }
        } catch (err) {
          btn.innerHTML = "❌ Error";
          btn.style.background = "#dc3545";
        }
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = "⚡ Download All Episodes";
          btn.style.background = "#e50914";
        }, 5000);
      };
      (document.body || document.documentElement).appendChild(btn);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initPackBtn);
    } else {
      initPackBtn();
    }
    setTimeout(initPackBtn, 800);
    setTimeout(initPackBtn, 2000);
  }

  // Intercept click on bypass links
  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || anchor.dataset.bypassing) return;

    if (!/^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba)/i.test(href)) return;
    if (/\/pack\//i.test(href)) return;

    e.preventDefault();
    e.stopPropagation();
    const restore = showStatus(anchor, "⏳ Bypassing…");
    try {
      const res = await sendBg("full_bypass", { url: href });
      if (res?.success) {
        showStatus(anchor, "✅ Download started");
        setTimeout(restore, 3000);
        return;
      }
      showStatus(anchor, "❌ Failed");
      window.open(href, "_blank");
    } catch (err) {
      showStatus(anchor, "❌ Error");
      window.open(href, "_blank");
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();
