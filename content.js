(function () {
  "use strict";

  if (window.__desiremoviesInjected) return;
  window.__desiremoviesInjected = true;

  const SKIP_TAGS = new Set(["INPUT", "TEXTAREA"]);

  // Web Player frame helper (mouse wheel volume, HUD toast, and keyboard control)
  if (location.hostname.includes("hbplay.pages.dev")) {
    let toastTimer = null;
    function showToast(text) {
      let badge = document.getElementById("dm-hud-toast");
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "dm-hud-toast";
        badge.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 24px;border-radius:10px;background:rgba(8,12,22,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:17px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;pointer-events:none;z-index:2147483647;transition:opacity 0.18s ease, transform 0.18s ease;opacity:0;";
        (document.body || document.documentElement).appendChild(badge);
      }
      badge.textContent = text;
      badge.style.opacity = "1";
      badge.style.transform = "translate(-50%,-50%) scale(1)";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        badge.style.opacity = "0";
        badge.style.transform = "translate(-50%,-50%) scale(0.92)";
      }, 700);
    }

    const getVid = () => {
      const v = document.querySelector("video") || document.getElementById("videoPlayer");
      if (v && !v.__dmInit) {
        v.__dmInit = true;
        v.addEventListener("volumechange", () => {
          showToast(v.muted || v.volume === 0 ? "🔇 Muted" : `🔊 ${Math.round(v.volume * 100)}%`);
        });
      }
      return v;
    };

    function adjustVol(delta) {
      const v = getVid();
      if (!v) return;
      const cur = v.muted ? 0 : v.volume;
      const next = Math.max(0, Math.min(1, Math.round((cur + delta) * 100) / 100));
      v.volume = next;
      v.muted = next === 0;
    }

    function seekRel(sec) {
      const v = getVid();
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + sec));
    }

    function togglePlay() {
      const v = getVid();
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }

    let lastVol = 0.5;
    function toggleMute() {
      const v = getVid();
      if (!v) return;
      if (v.muted || v.volume === 0) {
        v.muted = false;
        v.volume = lastVol || 0.5;
      } else {
        lastVol = v.volume;
        v.muted = true;
      }
    }

    // Unified key dispatch — single source of truth for both keydown and postMessage
    function dispatch(key) {
      const k = key.toLowerCase();
      if (k === " " || k === "k") togglePlay();
      else if (k === "arrowleft" || k === "j") seekRel(-10);
      else if (k === "arrowright" || k === "l") seekRel(10);
      else if (k === "arrowup") adjustVol(0.05);
      else if (k === "arrowdown") adjustVol(-0.05);
      else if (k === "m") toggleMute();
      else if (k === "p") {
        const v = getVid();
        if (v && document.pictureInPictureEnabled)
          document.pictureInPictureElement ? document.exitPictureInPicture?.().catch(() => {}) : v.requestPictureInPicture?.().catch(() => {});
      } else if (k >= "0" && k <= "9") {
        const v = getVid();
        if (v?.duration) v.currentTime = (Number(k) / 10) * v.duration;
      } else return false;
      return true;
    }

    window.addEventListener("wheel", (e) => {
      e.preventDefault();
      adjustVol(e.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (SKIP_TAGS.has(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else window.parent?.postMessage({ action: "dm_close" }, "*");
      } else if (k === "f") {
        e.preventDefault();
        window.parent?.postMessage({ action: "dm_toggle_fs" }, "*");
      } else if (dispatch(e.key)) {
        e.preventDefault();
      }
    }, true);

    window.addEventListener("message", (e) => {
      if (e.source !== window.parent) return;
      const act = e.data?.action;
      if (act === "dm_wheel") adjustVol(e.data.deltaY < 0 ? 0.05 : -0.05);
      else if (act === "dm_key") dispatch(e.data.key || "");
    });

    return;
  }

  if (window !== window.top) return;

  const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse|multicloudlinks)/i;
  const activeAnchors = new Map();

  function sendBg(action, payload = {}) {
    if (!chrome.runtime?.id) return Promise.reject(new Error("Extension context invalidated"));
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action, payload }, (r) => {
        chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r);
      });
    });
  }

  function showToast(text, duration = 6000) {
    document.getElementById("dm-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "dm-toast";
    toast.className = "dm-toast";
    toast.innerHTML = `<span class="dm-toast-icon">⚡</span><span></span>`;
    toast.lastElementChild.textContent = text;
    (document.body || document.documentElement).appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  // Progress and toast message handler from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "dm_toast") {
      showToast(msg.message);
      return;
    }
    if (msg.action !== "bypass_progress") return;
    const { url, statusText } = msg;
    const packBtn = document.getElementById("btn-dl-all-episodes");
    if (packBtn?.disabled && (/\/pack\//i.test(url) || url === location.href)) packBtn.textContent = statusText;

    const anchor = activeAnchors.get(url) || document.querySelector(`a[href="${CSS.escape(url)}"]`);
    if (anchor?.dataset.bypassing) anchor.innerHTML = `<span style="opacity:0.9">${statusText}</span>`;
  });

  function showStatus(anchor, text, url) {
    const savedHtml = anchor.innerHTML;
    anchor.innerHTML = `<span style="opacity:0.8">${text}</span>`;
    anchor.style.pointerEvents = "none";
    anchor.dataset.bypassing = "true";
    if (url) activeAnchors.set(url, anchor);

    return () => {
      anchor.innerHTML = savedHtml;
      anchor.style.pointerEvents = "";
      delete anchor.dataset.bypassing;
      if (url) activeAnchors.delete(url);
    };
  }

  const ICONS = {
    copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
  };

  function flash(btn, text, delay = 2000, fallback = btn.innerHTML) {
    btn.innerHTML = text;
    setTimeout(() => { btn.innerHTML = fallback; }, delay);
  }

  function copyText(btn, str, successLabel = "✓ Copied!") {
    navigator.clipboard.writeText(str)
      .then(() => flash(btn, successLabel))
      .catch(() => flash(btn, "❌ Failed"));
  }

  function makeWebUrl(streamUrl, hbplayUrl, title = "") {
    if (hbplayUrl) return hbplayUrl;
    if (!streamUrl) return "";
    try {
      const u = btoa(unescape(encodeURIComponent(streamUrl)));
      const t = title ? btoa(unescape(encodeURIComponent(title))) : "";
      return `https://hbplay.pages.dev/?u=${encodeURIComponent(u)}${t ? `&t=${encodeURIComponent(t)}` : ""}`;
    } catch {
      return streamUrl;
    }
  }

  function openPlayer(webUrl, streamUrl, titleText, openerBtn) {
    document.getElementById("desiremovies-watch-overlay")?.remove();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const overlay = document.createElement("div");
    overlay.id = "desiremovies-watch-overlay";
    overlay.className = "dm-overlay-root";
    overlay.tabIndex = -1;

    overlay.innerHTML = `
      <div class="dm-player-container" tabindex="-1">
        <div class="dm-video-stage">
          <iframe class="dm-web-frame dm-video-el" src="${webUrl}" style="border:none;width:100%;height:100%;background:#000;position:absolute;inset:0;z-index:2;" allow="autoplay; fullscreen; picture-in-picture"></iframe>
          <div class="dm-floating-top">
            <div class="dm-title-box">
              <span class="dm-badge">DESIREMOVIES • WATCH ONLINE</span>
              <span class="dm-title-text"></span>
            </div>
            <div class="dm-top-actions">
              <button class="dm-btn-action" id="dm-btn-tab">↗ New Tab</button>
              <button class="dm-btn-action" id="dm-btn-copy">${ICONS.copy} Copy Link</button>
              <button class="dm-btn-action dm-btn-close" id="dm-btn-close">${ICONS.close}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    overlay.querySelector(".dm-title-text").textContent = titleText || "Video Stream";

    const container = overlay.querySelector(".dm-player-container");
    const iframe = overlay.querySelector(".dm-web-frame");

    const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const toggleFs = () => {
      if (!isFs()) (container.requestFullscreen || container.webkitRequestFullscreen)?.call(container).catch(() => {});
      else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
    };

    function onMessage(e) {
      if (e.source !== iframe?.contentWindow) return;
      if (e.data?.action === "dm_close") close();
      else if (e.data?.action === "dm_toggle_fs") toggleFs();
    }
    window.addEventListener("message", onMessage);

    const onFsChange = () => container.classList.toggle("is-fullscreen", isFs());
    document.addEventListener("fullscreenchange", onFsChange);

    function close() {
      if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.body.style.overflow = prevOverflow;
      iframe?.remove();
      overlay.remove();
      openerBtn?.focus();
    }

    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    overlay.querySelector("#dm-btn-close").onclick = close;
    overlay.querySelector("#dm-btn-copy").onclick = function () { copyText(this, streamUrl || webUrl); };
    overlay.querySelector("#dm-btn-tab").onclick = () => window.open(webUrl, "_blank");

    overlay.onwheel = (e) => {
      e.preventDefault();
      iframe?.contentWindow?.postMessage({ action: "dm_wheel", deltaY: e.deltaY }, "*");
    };

    setTimeout(() => { try { iframe.focus(); } catch {} }, 150);
    iframe.onload = () => { try { iframe.focus(); } catch {} };

    function onKey(e) {
      if (SKIP_TAGS.has(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "f") {
        e.preventDefault(); e.stopPropagation();
        toggleFs();
      } else if (k === "escape") {
        e.preventDefault(); e.stopPropagation();
        if (isFs()) toggleFs();
        else close();
      } else if (/^[ 0-9jklmp]$|^arrow/i.test(k)) {
        e.preventDefault(); e.stopPropagation();
        iframe?.contentWindow?.postMessage({ action: "dm_key", key: e.key }, "*");
      }
    }
    window.addEventListener("keydown", onKey, true);
  }

  // Inject "Watch Online" buttons
  function injectWatchButtons() {
    const anchors = document.querySelectorAll(`a[href]:not([data-dm-processed])`);
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href || !RE_BYPASS.test(href) || /\/pack\//i.test(href)) continue;
      a.dataset.dmProcessed = "true";

      const btn = document.createElement("button");
      btn.className = "dm-btn-watch";
      btn.innerHTML = "▶ Watch Online";
      btn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = "⏳ Resolving…";
        const title = document.querySelector("h1.entry-title, h1")?.textContent?.trim() || document.title.replace(/[-|].*$/, "").trim();
        try {
          const res = await sendBg("resolve_stream", { url: href });
          btn.innerHTML = "▶ Watch Online";
          btn.disabled = false;
          if (res?.success && (res.streamUrl || res.hbplayUrl)) {
            const webUrl = makeWebUrl(res.streamUrl, res.hbplayUrl, title);
            openPlayer(webUrl, res.streamUrl, title, btn);
          } else throw new Error(res?.error || "Stream unavailable");
        } catch (err) {
          btn.innerHTML = `❌ ${err.message || "Failed"}`;
          setTimeout(() => { btn.innerHTML = "▶ Watch Online"; btn.disabled = false; }, 3000);
        }
      };
      a.insertAdjacentElement("afterend", btn);
    }
  }

  // Episode Pack Downloader
  if (/\/pack\//i.test(location.pathname)) {
    const injectPack = () => {
      if (document.getElementById("btn-dl-all-episodes")) return;
      const btn = document.createElement("button");
      btn.id = "btn-dl-all-episodes";
      btn.className = "dm-btn-pack";
      btn.innerHTML = "⚡ Download All Episodes";
      btn.onclick = async () => {
        btn.disabled = true;
        btn.innerHTML = "⏳ Resolving Pack...";
        try {
          const links = [...document.querySelectorAll('a[href*="/file/"]')].map((el) => el.href).filter(Boolean);
          const res = await sendBg("bypass_pack", { url: location.href, fileUrls: links });
          btn.innerHTML = res?.success ? `✅ Started (${res.count})` : `❌ ${res?.error || "Failed"}`;
        } catch { btn.innerHTML = "❌ Error"; }
        setTimeout(() => { btn.disabled = false; btn.innerHTML = "⚡ Download All Episodes"; }, 5000);
      };
      document.body.appendChild(btn);
    };
    injectPack();
    setTimeout(injectPack, 1000);
  }

  // Intercept direct download links
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a");
    const href = a?.getAttribute("href");
    if (!href || a.dataset.bypassing || !RE_BYPASS.test(href) || /\/pack\//i.test(href)) return;

    e.preventDefault(); e.stopPropagation();
    const restore = showStatus(a, "⏳ Connecting…", href);
    try {
      const res = await sendBg("full_bypass", { url: href });
      a.innerHTML = `<span style="opacity:0.8">${res?.success ? "✅ Download started" : "❌ Failed"}</span>`;
      if (res?.is10Gbps) {
        showToast("10Gbps Server: Please do not pause download (resume not supported)");
      }
      if (!res?.success) window.open(href, "_blank");
    } catch {
      a.innerHTML = `<span style="opacity:0.8">❌ Error</span>`;
      window.open(href, "_blank");
    } finally {
      setTimeout(restore, 2500);
    }
  });

  injectWatchButtons();
  let moTimer = null;
  new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => { moTimer = null; injectWatchButtons(); }, 200);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
