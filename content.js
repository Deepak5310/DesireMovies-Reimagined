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

  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || anchor.dataset.bypassing) return;

    const isBypassUrl = /^https?:\/\/[^/]*(gyanigurus|kmhd)/i.test(href);
    if (!isBypassUrl) return;

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
      window.open(href, '_blank');
    } catch (err) {
      showStatus(anchor, "❌ Error");
      window.open(href, '_blank');
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();
