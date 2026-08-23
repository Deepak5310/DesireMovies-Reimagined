(function () {
  "use strict";

  if (window.__desiremoviesBypassInjected) return;
  window.__desiremoviesBypassInjected = true;

  const BYPASS_LINK_RE = /^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba|gdflix|katdrama)/i;
  const IS_PACK_PAGE = /\/pack\//i.test(window.location.pathname);

  const sendBg = (action, payload = {}) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action, payload }, res => {
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res);
      });
    } catch (e) { reject(e); }
  });

  const activeAnchors = new Map();

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action !== "bypass_progress") return;
    const { url, status } = msg;
    const packBtn = document.getElementById("btn-dl-all-episodes");
    if (packBtn?.disabled && (/\/pack\//i.test(url) || url === window.location.href))
      packBtn.textContent = status;
    const anchor = activeAnchors.get(url);
    if (anchor?.dataset.bypassing === "true")
      anchor.innerHTML = `<span style="opacity:0.85">${status}</span>`;
  });

  const showStatus = (anchor, text, url) => {
    const saved = { html: anchor.innerHTML, pe: anchor.style.pointerEvents, cur: anchor.style.cursor };
    anchor.innerHTML = `<span style="opacity:0.8">${text}</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";
    anchor.dataset.bypassing = "true";
    activeAnchors.set(url, anchor);
    return () => {
      anchor.innerHTML = saved.html;
      anchor.style.pointerEvents = saved.pe;
      anchor.style.cursor = saved.cur;
      delete anchor.dataset.bypassing;
      activeAnchors.delete(url);
    };
  };

  if (IS_PACK_PAGE) {
    const initPackBtn = () => {
      if (document.getElementById("btn-dl-all-episodes")) return;
      const btn = document.createElement("button");
      btn.id = "btn-dl-all-episodes";
      btn.textContent = "⚡ Download All";
      btn.style.cssText = "position:fixed;bottom:25px;right:25px;z-index:2147483647;padding:14px 24px;background:#E50914;color:#fff;font:700 16px system-ui,sans-serif;border:none;border-radius:50px;box-shadow:0 6px 25px rgba(229,9,20,0.6);cursor:pointer;transition:all 0.2s ease;";
      btn.onmouseover = () => { btn.style.transform = "scale(1.08)"; btn.style.boxShadow = "0 8px 30px rgba(229,9,20,0.8)"; };
      btn.onmouseout  = () => { btn.style.transform = "scale(1)";    btn.style.boxShadow = "0 6px 25px rgba(229,9,20,0.6)"; };
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "⏳ Working…";
        try {
          const links = [...document.querySelectorAll('a[href*="/file/"]')].map(a => a.href).filter(Boolean);
          const res = await sendBg("bypass_pack", { url: window.location.href, fileUrls: links });
          btn.textContent = res?.success ? `✅ ${res.count} Started` : "❌ Failed";
          btn.style.background = res?.success ? "#28a745" : "#dc3545";
        } catch {
          btn.textContent = "❌ Error";
          btn.style.background = "#dc3545";
        }
        setTimeout(() => { btn.disabled = false; btn.textContent = "⚡ Download All"; btn.style.background = "#E50914"; }, 5000);
      };
      (document.body || document.documentElement).appendChild(btn);
    };

    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", initPackBtn)
      : initPackBtn();
    setTimeout(initPackBtn, 800);
  }

  document.addEventListener("click", async e => {
    const a = e.target.closest("a");
    if (!a?.href || a.dataset.bypassing || !BYPASS_LINK_RE.test(a.href) || /\/pack\//i.test(a.href)) return;
    e.preventDefault();
    e.stopPropagation();

    const restore = showStatus(a, "⏳ Connecting…", a.href);
    let timer;
    try {
      const res = await sendBg("full_bypass", { url: a.href });
      showStatus(a, res?.success ? "✅ Started" : "❌ Failed", a.href);
      timer = setTimeout(restore, res?.success ? 3000 : 4000);
    } catch {
      showStatus(a, "❌ Error", a.href);
      timer = setTimeout(restore, 4000);
    }
  });
})();