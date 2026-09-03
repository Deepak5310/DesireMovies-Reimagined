(function () {
  "use strict";
  if (window.__desiremoviesBypassInjected) return;
  window.__desiremoviesBypassInjected = true;

  const WATCH_BTN_ATTR = "data-desiremovies-watch";
  const BYPASS_LINK_RE = /^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba|gdflix|goflix|katdrama|hubcloud|hubdrive)/i;
  const activeAnchors = new Map();

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

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function findAnchorForUrl(url) {
    return activeAnchors.get(url) || document.querySelector(`a[href="${CSS.escape(url)}"]`);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== "bypass_progress") return;
    const { url, statusText } = msg;

    const packBtn = document.getElementById("btn-dl-all-episodes");
    if (packBtn?.disabled && (/\/pack\//i.test(url) || url === window.location.href)) {
      packBtn.innerHTML = statusText;
    }

    const anchor = findAnchorForUrl(url);
    if (anchor?.dataset.bypassing) {
      anchor.innerHTML = `<span style="opacity:0.9">${statusText}</span>`;
    }
  });

  function showStatus(anchor, text, url) {
    const saved = { html: anchor.innerHTML, pointerEvents: anchor.style.pointerEvents, cursor: anchor.style.cursor };
    anchor.innerHTML = `<span style="opacity:0.8">${text}</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";
    anchor.dataset.bypassing = "true";
    if (url) activeAnchors.set(url, anchor);
    return () => {
      anchor.innerHTML = saved.html;
      anchor.style.pointerEvents = saved.pointerEvents;
      anchor.style.cursor = saved.cursor;
      delete anchor.dataset.bypassing;
      if (url) activeAnchors.delete(url);
    };
  }

  const ICONS = {
    play: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    replay10: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.4-.5h.3v4.1zm3.8-2.1c0 .8-.1 1.4-.4 1.7-.3.3-.7.5-1.2.5s-.9-.2-1.2-.5c-.3-.3-.4-.9-.4-1.7v-.9c0-.8.1-1.4.4-1.7.3-.3.7-.5 1.2-.5s.9.2 1.2.5c.3.3.4.9.4 1.7v.9zm-.8-.9c0-.5 0-.9-.1-1.1-.1-.3-.3-.4-.6-.4s-.5.1-.6.4c-.1.2-.1.6-.1 1.1v.9c0 .5 0 .9.1 1.1.1.3.3.4.6.4s.5-.1.6-.4c.1-.2.1-.6.1-1.1v-.9z"/></svg>`,
    forward10: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.4-.5h.3v4.1zm3.8-2.1c0 .8-.1 1.4-.4 1.7-.3.3-.7.5-1.2.5s-.9-.2-1.2-.5c-.3-.3-.4-.9-.4-1.7v-.9c0-.8.1-1.4.4-1.7.3-.3.7-.5 1.2-.5s.9.2 1.2.5c.3.3.4.9.4 1.7v.9zm-.8-.9c0-.5 0-.9-.1-1.1-.1-.3-.3-.4-.6-.4s-.5.1-.6.4c-.1.2-.1.6-.1 1.1v.9c0 .5 0 .9.1 1.1.1.3.3.4.6.4s.5-.1.6-.4c.1-.2.1-.6.1-1.1v-.9z"/></svg>`,
    volumeHigh: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    volumeLow: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`,
    volumeMute: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    pip: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/></svg>`,
    fullscreen: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
    fullscreenExit: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    keyboard: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 4H5v-2h2v2zm0-3H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 7h-2v-2h2v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>`
  };

  function openPlayer(streamUrl, bypassUrl, titleText, openerBtn) {
    const existing = document.getElementById("desiremovies-watch-overlay");
    if (existing) existing.remove();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (!document.getElementById("dm-player-injected-styles")) {
      const styleTag = document.createElement("style");
      styleTag.id = "dm-player-injected-styles";
      styleTag.textContent = `
        .dm-overlay-root {
          position: fixed; inset: 0; z-index: 2147483647;
          display: flex; align-items: center; justify-content: center;
          background: rgba(4, 7, 14, 0.94); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          user-select: none; -webkit-user-select: none;
        }
        .dm-player-container {
          position: relative; width: min(1360px, 95vw); height: min(765px, 92vh);
          background: #000; border-radius: 14px; overflow: hidden;
          box-shadow: 0 35px 120px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.12);
          display: flex; flex-direction: column; outline: none;
        }
        .dm-player-container.is-fullscreen,
        .dm-player-container:fullscreen,
        .dm-player-container:-webkit-full-screen {
          width: 100vw !important; height: 100vh !important;
          max-width: 100vw !important; max-height: 100vh !important;
          border-radius: 0 !important; border: none !important; box-shadow: none !important;
        }
        .dm-video-stage {
          position: relative; width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden;
        }
        .dm-video-el {
          width: 100%; height: 100%; object-fit: contain; background: #000; display: block; outline: none;
        }
        .dm-floating-top, .dm-floating-bottom {
          position: absolute; left: 0; right: 0; z-index: 25;
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        .dm-floating-top {
          top: 0; padding: 16px 22px;
          background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 65%, transparent 100%);
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
        }
        .dm-floating-bottom {
          bottom: 0; padding: 24px 20px 14px;
          background: linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 60%, transparent 100%);
          display: flex; flex-direction: column; gap: 8px;
        }
        .dm-controls-hidden { opacity: 0 !important; pointer-events: none !important; }
        .dm-floating-top.dm-controls-hidden { transform: translateY(-8px); }
        .dm-floating-bottom.dm-controls-hidden { transform: translateY(8px); }
        .dm-btn-action {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: 7px; font-size: 12px; font-weight: 700;
          border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.08);
          color: #f1f5f9; cursor: pointer; transition: all 0.15s ease; outline: none;
        }
        .dm-btn-action:hover { background: rgba(255, 255, 255, 0.18); border-color: rgba(255, 255, 255, 0.3); color: #fff; }
        .dm-btn-close { border-color: rgba(229, 9, 20, 0.4); background: rgba(229, 9, 20, 0.15); color: #ff99a0; }
        .dm-btn-close:hover { background: rgba(229, 9, 20, 0.35); border-color: #e50914; color: #fff; }
        .dm-ctrl-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 36px; height: 36px; border-radius: 50%;
          background: transparent; border: none; color: #f8fafc;
          cursor: pointer; transition: all 0.15s ease; outline: none;
        }
        .dm-ctrl-btn:hover { background: rgba(255, 255, 255, 0.14); color: #fff; transform: scale(1.08); }
        .dm-ctrl-btn:active { transform: scale(0.96); }
        .dm-progress-track {
          position: relative; width: 100%; height: 5px; background: rgba(255, 255, 255, 0.22);
          border-radius: 3px; cursor: pointer; transition: height 0.15s ease; display: flex; align-items: center;
        }
        .dm-progress-track:hover, .dm-progress-track.is-dragging { height: 8px; }
        .dm-buffer-bar, .dm-played-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; border-radius: 3px; pointer-events: none; }
        .dm-buffer-bar { background: rgba(255, 255, 255, 0.35); }
        .dm-played-bar { background: #e50914; }
        .dm-scrubber-thumb {
          position: absolute; top: 50%; right: 0; width: 14px; height: 14px; border-radius: 50%;
          background: #e50914; border: 2.5px solid #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
          transform: translate(50%, -50%) scale(0); transition: transform 0.12s ease; pointer-events: none;
        }
        .dm-progress-track:hover .dm-scrubber-thumb, .dm-progress-track.is-dragging .dm-scrubber-thumb { transform: translate(50%, -50%) scale(1); }
        .dm-time-tooltip {
          position: absolute; bottom: 18px; transform: translateX(-50%); padding: 4px 8px;
          background: rgba(12, 16, 26, 0.95); border: 1px solid rgba(255, 255, 255, 0.15);
          color: #fff; font-size: 11px; font-weight: 700; border-radius: 5px;
          pointer-events: none; opacity: 0; transition: opacity 0.1s ease; white-space: nowrap; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }
        .dm-volume-box { display: flex; align-items: center; gap: 8px; position: relative; }
        .dm-vol-slider {
          width: 68px; height: 4px; background: rgba(255, 255, 255, 0.25); border-radius: 2px; position: relative; cursor: pointer; transition: height 0.15s ease;
        }
        .dm-vol-slider:hover, .dm-vol-slider.is-dragging { height: 6px; }
        .dm-vol-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: #e50914; border-radius: 2px; pointer-events: none; }
        .dm-vol-thumb {
          position: absolute; top: 50%; right: 0; width: 10px; height: 10px; border-radius: 50%;
          background: #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.6); transform: translate(50%, -50%); pointer-events: none;
        }
        @keyframes dm-spin { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes dm-pulse-flash {
          0% { transform: translate(-50%, -50%) scale(0.55); opacity: 0; }
          35% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.45); opacity: 0; }
        }
        .dm-center-pulse {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.55);
          width: 72px; height: 72px; border-radius: 50%;
          background: rgba(8, 12, 22, 0.72); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          border: 2px solid rgba(255, 255, 255, 0.28);
          display: flex; align-items: center; justify-content: center; color: #ffffff; opacity: 0; pointer-events: none; z-index: 24;
        }
        .dm-center-pulse svg { width: 34px; height: 34px; }
        .dm-center-pulse.show { animation: dm-pulse-flash 0.5s ease-out forwards; }
        .dm-speed-pill {
          padding: 4px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.18); color: #fff; font-size: 12px; font-weight: 800;
          letter-spacing: 0.04em; cursor: pointer; transition: all 0.15s ease;
        }
        .dm-speed-pill:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.35); }
        .dm-hud-popup {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.85);
          width: 82px; height: 82px; border-radius: 50%; background: transparent; border: none; box-shadow: none;
          display: flex; align-items: center; justify-content: center; color: #ffffff; opacity: 0; pointer-events: none;
          transition: opacity 0.16s ease, transform 0.18s cubic-bezier(0.18, 0.89, 0.32, 1.28); z-index: 30;
        }
        .dm-hud-popup.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        .dm-hud-ring-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
        .dm-hud-ring-bg { fill: none; stroke: rgba(255, 255, 255, 0.18); stroke-width: 4; }
        .dm-hud-ring-bar {
          fill: none; stroke: #e50914; stroke-width: 4; stroke-linecap: round;
          stroke-dasharray: 226.2; stroke-dashoffset: 226.2; transform: rotate(-90deg); transform-origin: 50% 50%;
          filter: drop-shadow(0 0 8px #e50914) drop-shadow(0 0 16px rgba(229, 9, 20, 0.5));
          transition: stroke-dashoffset 0.08s ease-out;
        }
        .dm-hud-content {
          position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
          color: #ffffff; filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.95));
        }
        .dm-hud-icon { display: flex; align-items: center; justify-content: center; line-height: 1; color: #ffffff; }
        .dm-hud-icon svg { width: 24px; height: 24px; fill: currentColor; display: block; }
        .dm-hud-text {
          font-size: 13px; font-weight: 900; white-space: nowrap; max-width: 62px;
          overflow: hidden; text-overflow: ellipsis; text-align: center; color: #ffffff;
          letter-spacing: 0.6px; line-height: 1.1; font-variant-numeric: tabular-nums;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.95);
        }
        .dm-buffering-spinner {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 56px; height: 56px; border: 4px solid rgba(255, 255, 255, 0.18); border-top-color: #e50914;
          border-radius: 50%; animation: dm-spin 0.75s linear infinite; pointer-events: none; display: none; z-index: 28;
          box-shadow: 0 0 20px rgba(229, 9, 20, 0.4);
        }
      `;
      document.head.appendChild(styleTag);
    }

    const overlay = document.createElement("div");
    overlay.id = "desiremovies-watch-overlay";
    overlay.className = "dm-overlay-root";
    overlay.tabIndex = -1;

    const container = document.createElement("div");
    container.className = "dm-player-container";
    container.tabIndex = -1;

    const stage = document.createElement("div");
    stage.className = "dm-video-stage";

    const video = document.createElement("video");
    video.className = "dm-video-el";
    video.src = streamUrl;
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    video.volume = 0.2;
    stage.appendChild(video);

    const centerPulse = document.createElement("div");
    centerPulse.className = "dm-center-pulse";
    stage.appendChild(centerPulse);

    function triggerPulse(svgHtml) {
      centerPulse.innerHTML = svgHtml;
      centerPulse.classList.remove("show");
      void centerPulse.offsetWidth;
      centerPulse.classList.add("show");
    }
    centerPulse.addEventListener("animationend", () => centerPulse.classList.remove("show"));

    const HUD_RING_CIRCUMFERENCE = 226.2;
    const hud = document.createElement("div");
    hud.className = "dm-hud-popup";
    hud.innerHTML = `
      <svg class="dm-hud-ring-svg" viewBox="0 0 82 82">
        <circle class="dm-hud-ring-bg" cx="41" cy="41" r="36"></circle>
        <circle class="dm-hud-ring-bar" cx="41" cy="41" r="36"></circle>
      </svg>
      <div class="dm-hud-content">
        <span class="dm-hud-icon"></span>
        <span class="dm-hud-text"></span>
      </div>
    `;
    stage.appendChild(hud);

    const hudRingBar = hud.querySelector(".dm-hud-ring-bar");
    const hudIcon = hud.querySelector(".dm-hud-icon");
    const hudText = hud.querySelector(".dm-hud-text");

    let hudTimer = null;
    function showHud(icon, text, progress = null) {
      hudIcon.innerHTML = typeof icon === "string" && icon.trim().startsWith("<svg") ? icon : icon;
      hudText.textContent = typeof text === "string" ? text.replace(/^(Volume|Speed)\s+/i, "") : text;

      if (progress !== null && progress !== undefined) {
        const p = Math.max(0, Math.min(1, progress));
        hudRingBar.style.opacity = p <= 0.001 ? "0" : "1";
        hudRingBar.style.strokeDashoffset = String(HUD_RING_CIRCUMFERENCE * (1 - p));
      } else {
        hudRingBar.style.opacity = "1";
        hudRingBar.style.strokeDashoffset = "0";
      }

      hud.classList.add("show");
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => hud.classList.remove("show"), 800);
    }

    const spinner = document.createElement("div");
    spinner.className = "dm-buffering-spinner";
    stage.appendChild(spinner);

    let isZip = false;
    try {
      isZip = /\.(?:zip|rar|7z|tar|gz)$/i.test(new URL(streamUrl, window.location.href).pathname);
    } catch (e) {}

    const errorOverlay = document.createElement("div");
    errorOverlay.style.cssText = `
      position: absolute; inset: 0; background: rgba(6, 9, 18, 0.96);
      display: ${isZip ? "flex" : "none"}; align-items: center; justify-content: center;
      padding: 24px; box-sizing: border-box; z-index: 35; text-align: center;
    `;
    const errorBox = document.createElement("div");
    errorBox.style.cssText = "max-width: 500px; display: flex; flex-direction: column; align-items: center; gap: 14px;";
    errorBox.innerHTML = `
      <div style="font-size: 44px; line-height: 1;">${isZip ? "📦" : "⚠️"}</div>
      <div style="font-size: 17px; font-weight: 800; color: #ffffff;">${isZip ? "ZIP Archive Detected" : "Browser Codec Notice"}</div>
      <div style="font-size: 13px; color: #94a3b8; line-height: 1.6;">
        ${isZip
          ? "This movie release was uploaded inside a ZIP archive (.zip). Web browsers cannot stream compressed archives directly. Click Download to save and extract the video."
          : "This file format or audio track (e.g. MKV container, Dolby EAC3/DTS audio, 10-bit HEVC) cannot be natively decoded in Chrome. Download the file directly or copy the stream URL to play in VLC or MPV."}
      </div>
      <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
        <button id="dm-err-dl" class="dm-btn-action" style="background: #e50914; border-color: #e50914; color: #fff;">${ICONS.download} Download File</button>
        <button id="dm-err-copy" class="dm-btn-action">${ICONS.copy} Copy Stream URL</button>
        <button id="dm-err-open" class="dm-btn-action">🌐 Open in New Tab</button>
      </div>
    `;
    errorOverlay.appendChild(errorBox);
    stage.appendChild(errorOverlay);

    const topBar = document.createElement("div");
    topBar.className = "dm-floating-top";

    const titleBox = document.createElement("div");
    titleBox.style.cssText = "min-width: 0; display: flex; flex-direction: column; gap: 2px;";

    const badge = document.createElement("span");
    badge.textContent = "DESIREMOVIES  •  ONLINE WATCH";
    badge.style.cssText = "color: #e50914; font-size: 11px; font-weight: 800; letter-spacing: 0.12em;";

    const titleEl = document.createElement("span");
    titleEl.textContent = titleText || "Video Stream";
    titleEl.style.cssText = "color: #ffffff; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw;";
    titleBox.append(badge, titleEl);

    const topActions = document.createElement("div");
    topActions.style.cssText = "display: flex; align-items: center; gap: 8px; flex-shrink: 0;";

    function flashBtn(btn, html, delay = 2000, fallback = btn.innerHTML) {
      btn.innerHTML = html;
      setTimeout(() => { btn.innerHTML = fallback; }, delay);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "dm-btn-action";
    copyBtn.innerHTML = `${ICONS.copy} <span>Copy Link</span>`;
    copyBtn.title = "Copy direct video stream URL";
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(streamUrl);
        flashBtn(copyBtn, "✓ <span>Copied!</span>", 2000, `${ICONS.copy} <span>Copy Link</span>`);
      } catch (e) {
        flashBtn(copyBtn, "❌ <span>Failed</span>", 2000, `${ICONS.copy} <span>Copy Link</span>`);
      }
    };

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "dm-btn-action";
    downloadBtn.innerHTML = `${ICONS.download} <span>Download</span>`;
    downloadBtn.title = "Download video file directly";
    downloadBtn.onclick = async () => {
      downloadBtn.innerHTML = `⏳ <span>Starting…</span>`;
      try {
        const res = await sendBg("full_bypass", { url: bypassUrl });
        flashBtn(downloadBtn, res?.success ? "✅ <span>Started</span>" : "❌ <span>Failed</span>", 3000, `${ICONS.download} <span>Download</span>`);
      } catch (e) {
        flashBtn(downloadBtn, "❌ <span>Error</span>", 3000, `${ICONS.download} <span>Download</span>`);
      }
    };

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dm-btn-action dm-btn-close";
    closeBtn.innerHTML = `${ICONS.close} <span>Close</span>`;
    closeBtn.title = "Close player (Esc)";

    topActions.append(copyBtn, downloadBtn, closeBtn);
    topBar.append(titleBox, topActions);

    const bottomBar = document.createElement("div");
    bottomBar.className = "dm-floating-bottom";

    const progressTrack = document.createElement("div");
    progressTrack.className = "dm-progress-track";

    const bufferBar = document.createElement("div");
    bufferBar.className = "dm-buffer-bar";

    const playedBar = document.createElement("div");
    playedBar.className = "dm-played-bar";

    const thumb = document.createElement("div");
    thumb.className = "dm-scrubber-thumb";
    playedBar.appendChild(thumb);

    const tooltip = document.createElement("div");
    tooltip.className = "dm-time-tooltip";
    progressTrack.append(bufferBar, playedBar, tooltip);

    const controlsRow = document.createElement("div");
    controlsRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 12px;";

    const leftControls = document.createElement("div");
    leftControls.style.cssText = "display: flex; align-items: center; gap: 6px;";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "dm-ctrl-btn";
    playBtn.innerHTML = ICONS.play;
    playBtn.title = "Play / Pause (Space)";

    const rewindBtn = document.createElement("button");
    rewindBtn.type = "button";
    rewindBtn.className = "dm-ctrl-btn";
    rewindBtn.innerHTML = ICONS.replay10;
    rewindBtn.title = "Rewind 10s (Left Arrow)";

    const fwdBtn = document.createElement("button");
    fwdBtn.type = "button";
    fwdBtn.className = "dm-ctrl-btn";
    fwdBtn.innerHTML = ICONS.forward10;
    fwdBtn.title = "Forward 10s (Right Arrow)";

    const volumeBox = document.createElement("div");
    volumeBox.className = "dm-volume-box";

    const volumeBtn = document.createElement("button");
    volumeBtn.type = "button";
    volumeBtn.className = "dm-ctrl-btn";
    volumeBtn.innerHTML = ICONS.volumeHigh;
    volumeBtn.title = "Mute / Unmute (M)";

    const volSlider = document.createElement("div");
    volSlider.className = "dm-vol-slider";

    const volFill = document.createElement("div");
    volFill.className = "dm-vol-fill";

    const volThumb = document.createElement("div");
    volThumb.className = "dm-vol-thumb";
    volFill.appendChild(volThumb);
    volSlider.appendChild(volFill);
    volumeBox.append(volumeBtn, volSlider);

    const timeDisplay = document.createElement("span");
    timeDisplay.textContent = "0:00 / 0:00";
    timeDisplay.style.cssText = "color: #cbd5e1; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; margin-left: 10px; white-space: nowrap;";

    leftControls.append(playBtn, rewindBtn, fwdBtn, volumeBox, timeDisplay);

    const rightControls = document.createElement("div");
    rightControls.style.cssText = "display: flex; align-items: center; gap: 6px;";

    const speedBtn = document.createElement("button");
    speedBtn.type = "button";
    speedBtn.className = "dm-speed-pill";
    speedBtn.textContent = "1x";
    speedBtn.title = "Playback Speed";

    const pipBtn = document.createElement("button");
    pipBtn.type = "button";
    pipBtn.className = "dm-ctrl-btn";
    pipBtn.innerHTML = ICONS.pip;
    pipBtn.title = "Picture-in-Picture (P)";

    const fsBtn = document.createElement("button");
    fsBtn.type = "button";
    fsBtn.className = "dm-ctrl-btn";
    fsBtn.innerHTML = ICONS.fullscreen;
    fsBtn.title = "Toggle Fullscreen (F)";

    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "dm-ctrl-btn";
    helpBtn.innerHTML = ICONS.keyboard;
    helpBtn.title = "Keyboard Shortcuts";

    rightControls.append(speedBtn, pipBtn, fsBtn, helpBtn);
    controlsRow.append(leftControls, rightControls);

    bottomBar.append(progressTrack, controlsRow);
    stage.append(topBar, bottomBar);
    container.appendChild(stage);
    overlay.appendChild(container);
    document.documentElement.appendChild(overlay);

    const helpModal = document.createElement("div");
    helpModal.style.cssText = `
      position: absolute; inset: 0; background: rgba(5, 8, 15, 0.9);
      display: none; align-items: center; justify-content: center;
      padding: 24px; box-sizing: border-box; z-index: 40;
    `;
    const helpCard = document.createElement("div");
    helpCard.style.cssText = `
      width: min(440px, 90vw); background: #0c121e; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px; padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.8); color: #fff;
    `;
    helpCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
        <span style="font-size: 15px; font-weight: 800;">⌨️ Keyboard Shortcuts</span>
        <button id="dm-help-close" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer;">✕</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #cbd5e1;">
        <div style="display: flex; justify-content: space-between;"><span>Play / Pause</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">Space / K</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Seek ±10 seconds</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">← / → or J / L</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Volume ±5%</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">↑ / ↓ or Wheel</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Mute Toggle</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">M</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Toggle Fullscreen</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">F / Double-Click</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Picture in Picture</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">P</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Jump to 0% - 90%</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">0 - 9</kbd></div>
        <div style="display: flex; justify-content: space-between;"><span>Close / Exit FS</span><kbd style="background:#1e293b;padding:2px 6px;border-radius:4px;">Esc</kbd></div>
      </div>
    `;
    helpModal.appendChild(helpCard);
    stage.appendChild(helpModal);

    helpBtn.onclick = () => { helpModal.style.display = "flex"; };
    helpCard.querySelector("#dm-help-close").onclick = () => { helpModal.style.display = "none"; };
    helpModal.onclick = (e) => { if (e.target === helpModal) helpModal.style.display = "none"; };

    let seekTarget = null;
    let seekDebounce = null;

    function getValidDuration() {
      if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
      if (video.seekable && video.seekable.length > 0) return video.seekable.end(video.seekable.length - 1);
      return 0;
    }

    function updateProgress() {
      const dur = getValidDuration();
      const cur = seekTarget !== null ? seekTarget : video.currentTime;
      if (dur > 0) {
        playedBar.style.width = `${Math.min(100, Math.max(0, (cur / dur) * 100))}%`;
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      } else {
        timeDisplay.textContent = `${formatTime(cur)} / 0:00`;
      }
    }

    function updateBuffer() {
      const dur = getValidDuration();
      if (!dur || !video.buffered.length) return;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
          bufferBar.style.width = `${Math.min(100, (video.buffered.end(i) / dur) * 100)}%`;
          break;
        }
      }
    }

    function seekTo(targetTime) {
      const dur = getValidDuration();
      seekTarget = Math.max(0, Math.min(dur || Infinity, targetTime));
      updateProgress();

      clearTimeout(seekDebounce);
      seekDebounce = setTimeout(() => {
        try {
          if ("fastSeek" in video) video.fastSeek(seekTarget);
          else video.currentTime = seekTarget;
        } catch (e) {
          video.currentTime = seekTarget;
        }
      }, 40);
    }

    function seekRelative(deltaSeconds) {
      const current = seekTarget !== null ? seekTarget : video.currentTime;
      seekTo(current + deltaSeconds);
      triggerPulse(deltaSeconds > 0 ? ICONS.forward10 : ICONS.replay10);
    }

    function togglePlay() {
      if (video.paused) {
        video.play().catch(() => {});
        playBtn.innerHTML = ICONS.pause;
        triggerPulse(ICONS.play);
      } else {
        video.pause();
        playBtn.innerHTML = ICONS.play;
        triggerPulse(ICONS.pause);
      }
    }

    let prevVolume = 0.2;
    function syncVolumeUI() {
      const effectiveVol = video.muted ? 0 : video.volume;
      volFill.style.width = `${Math.round(effectiveVol * 100)}%`;
      volumeBtn.innerHTML = (video.muted || effectiveVol === 0) ? ICONS.volumeMute : (effectiveVol < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh);
    }

    function setVolume(level) {
      const clamped = Math.max(0, Math.min(1, Math.round(level * 100) / 100));
      video.volume = clamped;
      video.muted = clamped === 0;
      if (clamped > 0) prevVolume = clamped;
      syncVolumeUI();
      const effective = video.muted || clamped === 0 ? 0 : clamped;
      const icon = (video.muted || clamped === 0) ? ICONS.volumeMute : (clamped < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh);
      showHud(icon, `${Math.round(clamped * 100)}%`, effective);
    }

    function adjustVolume(delta) {
      setVolume((video.muted ? 0 : video.volume) + delta);
    }

    function toggleMute() {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        video.volume = prevVolume > 0 ? prevVolume : 0.2;
      } else {
        prevVolume = video.volume > 0 ? video.volume : 0.2;
        video.muted = true;
      }
      syncVolumeUI();
      const effective = video.muted ? 0 : video.volume;
      const icon = video.muted ? ICONS.volumeMute : (video.volume < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh);
      showHud(icon, video.muted ? "Muted" : `${Math.round(video.volume * 100)}%`, effective);
    }

    volumeBtn.onclick = toggleMute;

    let isDraggingVol = false;
    function handleVolScrub(e) {
      const rect = volSlider.getBoundingClientRect();
      setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    }

    volSlider.onmousedown = (e) => {
      isDraggingVol = true;
      volSlider.classList.add("is-dragging");
      handleVolScrub(e);
    };

    function isFullscreenActive() {
      return document.fullscreenElement === container || document.webkitFullscreenElement === container || container.classList.contains("is-fullscreen");
    }

    function toggleFullscreen() {
      if (!isFullscreenActive()) {
        (container.requestFullscreen?.() || container.webkitRequestFullscreen?.())?.catch?.(() => {});
      } else {
        (document.exitFullscreen?.() || document.webkitExitFullscreen?.())?.catch?.(() => {});
      }
    }

    fsBtn.onclick = toggleFullscreen;

    const onFullscreenChange = () => {
      const isFs = isFullscreenActive();
      container.classList.toggle("is-fullscreen", isFs);
      fsBtn.innerHTML = isFs ? ICONS.fullscreenExit : ICONS.fullscreen;
      fsBtn.title = isFs ? "Exit Fullscreen (F)" : "Toggle Fullscreen (F)";
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    video.addEventListener("play", () => { playBtn.innerHTML = ICONS.pause; });
    video.addEventListener("pause", () => { playBtn.innerHTML = ICONS.play; });
    video.addEventListener("timeupdate", () => { updateProgress(); updateBuffer(); });
    video.addEventListener("loadedmetadata", () => { updateProgress(); updateBuffer(); syncVolumeUI(); });
    video.addEventListener("progress", updateBuffer);

    const showSpinner = () => { spinner.style.display = "block"; };
    const hideSpinner = () => { spinner.style.display = "none"; };
    ["seeking", "waiting", "stalled"].forEach((ev) => video.addEventListener(ev, showSpinner));
    ["playing", "canplay"].forEach((ev) => video.addEventListener(ev, hideSpinner));
    video.addEventListener("seeked", () => { seekTarget = null; updateProgress(); });
    video.addEventListener("error", () => { hideSpinner(); errorOverlay.style.display = "flex"; });

    let isDraggingScrubber = false;
    function handleScrubberScrub(e) {
      const rect = progressTrack.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = getValidDuration();
      if (dur > 0) seekTo(fraction * dur);
    }

    progressTrack.addEventListener("mousedown", (e) => {
      isDraggingScrubber = true;
      progressTrack.classList.add("is-dragging");
      handleScrubberScrub(e);
    });

    progressTrack.addEventListener("mousemove", (e) => {
      const rect = progressTrack.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = getValidDuration();
      if (dur > 0) {
        tooltip.textContent = formatTime(fraction * dur);
        tooltip.style.left = `${e.clientX - rect.left}px`;
        tooltip.style.opacity = "1";
      }
    });
    progressTrack.addEventListener("mouseleave", () => {
      if (!isDraggingScrubber) tooltip.style.opacity = "0";
    });

    const onGlobalMouseMove = (e) => {
      if (isDraggingScrubber) handleScrubberScrub(e);
      if (isDraggingVol) handleVolScrub(e);
    };
    const onGlobalMouseUp = () => {
      if (isDraggingScrubber) {
        isDraggingScrubber = false;
        progressTrack.classList.remove("is-dragging");
        tooltip.style.opacity = "0";
      }
      if (isDraggingVol) {
        isDraggingVol = false;
        volSlider.classList.remove("is-dragging");
      }
    };
    window.addEventListener("mousemove", onGlobalMouseMove);
    window.addEventListener("mouseup", onGlobalMouseUp);

    playBtn.addEventListener("click", togglePlay);
    rewindBtn.addEventListener("click", () => seekRelative(-10));
    fwdBtn.addEventListener("click", () => seekRelative(10));

    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let speedIdx = 2;
    speedBtn.addEventListener("click", () => {
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      const spd = SPEEDS[speedIdx];
      video.playbackRate = spd;
      speedBtn.textContent = `${spd}x`;
      showHud("⚡", `${spd}x`, spd / 2);
    });

    if (document.pictureInPictureEnabled) {
      pipBtn.addEventListener("click", async () => {
        try {
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else await video.requestPictureInPicture();
        } catch (e) {}
      });
    } else {
      pipBtn.style.display = "none";
    }

    let controlsHideTimer = null;
    function showControls() {
      topBar.classList.remove("dm-controls-hidden");
      bottomBar.classList.remove("dm-controls-hidden");
      clearTimeout(controlsHideTimer);
      if (!video.paused) {
        controlsHideTimer = setTimeout(() => {
          topBar.classList.add("dm-controls-hidden");
          bottomBar.classList.add("dm-controls-hidden");
        }, 2500);
      }
    }

    ["mousemove", "mouseenter"].forEach((ev) => stage.addEventListener(ev, showControls));
    [topBar, bottomBar].forEach((el) =>
      el.addEventListener("mouseenter", () => {
        clearTimeout(controlsHideTimer);
        topBar.classList.remove("dm-controls-hidden");
        bottomBar.classList.remove("dm-controls-hidden");
      })
    );

    stage.addEventListener("click", (e) => {
      if (e.target === video || e.target === stage) togglePlay();
    });
    stage.addEventListener("dblclick", (e) => {
      if (e.target === video || e.target === stage) toggleFullscreen();
    });
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      adjustVolume(e.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });

    errorBox.querySelector("#dm-err-dl")?.addEventListener("click", () => downloadBtn.click());
    errorBox.querySelector("#dm-err-copy")?.addEventListener("click", () => copyBtn.click());
    errorBox.querySelector("#dm-err-open")?.addEventListener("click", () => window.open(streamUrl, "_blank"));

    function closePlayer() {
      if (isFullscreenActive()) {
        (document.exitFullscreen?.() || document.webkitExitFullscreen?.())?.catch?.(() => {});
      }
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("mousemove", onGlobalMouseMove);
      window.removeEventListener("mouseup", onGlobalMouseUp);
      clearTimeout(hudTimer);
      clearTimeout(seekDebounce);
      clearTimeout(controlsHideTimer);
      document.body.style.overflow = prevOverflow;
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
      openerBtn?.focus();
    }

    closeBtn.addEventListener("click", closePlayer);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePlayer();
    });

    const keyActions = {
      " ": togglePlay, "k": togglePlay,
      "arrowleft": () => seekRelative(-10), "j": () => seekRelative(-10),
      "arrowright": () => seekRelative(10), "l": () => seekRelative(10),
      "arrowup": () => adjustVolume(0.05),
      "arrowdown": () => adjustVolume(-0.05),
      "m": toggleMute,
      "f": toggleFullscreen,
      "p": () => pipBtn.click(),
      "?": () => { helpModal.style.display = helpModal.style.display === "flex" ? "none" : "flex"; },
      "escape": () => {
        if (helpModal.style.display === "flex") helpModal.style.display = "none";
        else if (isFullscreenActive()) toggleFullscreen();
        else closePlayer();
      }
    };

    function onKeydown(e) {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      const key = e.key.toLowerCase();
      if (key >= "0" && key <= "9") {
        e.preventDefault();
        e.stopPropagation();
        const dur = getValidDuration();
        if (dur > 0) seekTo((Number(key) / 10) * dur);
        return;
      }
      if (keyActions[key]) {
        e.preventDefault();
        e.stopPropagation();
        keyActions[key]();
      }
    }

    window.addEventListener("keydown", onKeydown, true);
    syncVolumeUI();
    overlay.focus();
    video.play().catch(() => {});
  }

  function addWatchButtons() {
    const anchors = document.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href || !BYPASS_LINK_RE.test(href) || /\/pack\//i.test(href)) continue;
      if (anchor.dataset.dmWatchProcessed === "true" || anchor.nextElementSibling?.hasAttribute(WATCH_BTN_ATTR)) continue;

      anchor.dataset.dmWatchProcessed = "true";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute(WATCH_BTN_ATTR, "true");
      btn.innerHTML = `<span>▶ Watch Online</span>`;
      btn.style.cssText = `
        display: inline-flex; align-items: center; gap: 6px;
        margin: 4px 0 4px 8px; padding: 6px 12px;
        background: linear-gradient(135deg, #e50914 0%, #b80710 100%);
        color: #ffffff; font-weight: 700; font-size: 12px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        border: none; border-radius: 6px; box-shadow: 0 3px 10px rgba(229, 9, 20, 0.35);
        cursor: pointer; vertical-align: middle; transition: all 0.15s ease; line-height: 1.2;
      `;
      btn.onmouseenter = () => { btn.style.transform = "translateY(-1px)"; btn.style.boxShadow = "0 5px 15px rgba(229, 9, 20, 0.5)"; };
      btn.onmouseleave = () => { btn.style.transform = "none"; btn.style.boxShadow = "0 3px 10px rgba(229, 9, 20, 0.35)"; };

      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.resolving === "true") return;
        btn.dataset.resolving = "true";
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span>⏳ Resolving stream…</span>`;
        btn.style.opacity = "0.8";
        btn.style.cursor = "wait";

        const pageTitle = document.querySelector("h1.entry-title, h1")?.textContent?.trim() || document.title.replace(/[-|].*$/, "").trim() || "Online Video Stream";

        try {
          const res = await sendBg("resolve_stream", { url: href });
          if (res?.success && res.streamUrl) {
            btn.innerHTML = `<span>▶ Watch Online</span>`;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
            delete btn.dataset.resolving;
            openPlayer(res.streamUrl, href, pageTitle, btn);
            return;
          }
          throw new Error(res?.error || "Stream unavailable");
        } catch (err) {
          btn.innerHTML = `<span>❌ ${err.message || "Failed"}</span>`;
          btn.style.background = "#dc3545";
          setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.background = "linear-gradient(135deg, #e50914 0%, #b80710 100%)";
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
            delete btn.dataset.resolving;
          }, 3000);
        }
      };

      anchor.insertAdjacentElement("afterend", btn);
    }
  }

  let observerTimer = null;
  const debouncedAddWatchButtons = () => {
    if (observerTimer) return;
    observerTimer = setTimeout(() => {
      observerTimer = null;
      addWatchButtons();
    }, 250);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addWatchButtons);
  } else {
    addWatchButtons();
  }

  new MutationObserver(debouncedAddWatchButtons).observe(document.body || document.documentElement, { childList: true, subtree: true });

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
          const domLinks = [...document.querySelectorAll('a[href*="/file/"]')].map((a) => a.href).filter(Boolean);
          const res = await sendBg("bypass_pack", { url: window.location.href, fileUrls: domLinks });
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

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPackBtn);
    else initPackBtn();
    setTimeout(initPackBtn, 800);
    setTimeout(initPackBtn, 2000);
  }

  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || anchor.dataset.bypassing || !BYPASS_LINK_RE.test(href) || /\/pack\//i.test(href)) return;

    e.preventDefault();
    e.stopPropagation();
    const restore = showStatus(anchor, "⏳ Connecting…", href);
    try {
      const res = await sendBg("full_bypass", { url: href });
      if (res?.success) {
        showStatus(anchor, "✅ Download started", href);
        setTimeout(restore, 3000);
        return;
      }
      showStatus(anchor, "❌ Failed", href);
      window.open(href, "_blank");
    } catch (err) {
      showStatus(anchor, "❌ Error", href);
      window.open(href, "_blank");
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();
