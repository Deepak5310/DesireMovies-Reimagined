(function () {
  "use strict";

  if (window.__desiremoviesBypassInjected) return;
  window.__desiremoviesBypassInjected = true;

  // Configuration
  const CONFIG = {
    WATCH_BUTTON_ATTR: "data-desiremovies-watch",
    BYPASS_LINK_RE: /^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba|gdflix|katdrama)/i,
    IS_DESIRE_MOVIES: /(?:^|\.)\d*desiremovies(?:[.-]|$)/i.test(window.location.hostname),
    IS_PACK_PAGE: /\/pack\//i.test(window.location.pathname)
  };

  const PLAYER_STYLES = `
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    padding: clamp(12px, 3vw, 36px); box-sizing: border-box;
    background: rgba(0, 0, 0, 0.95); backdrop-filter: blur(20px);
  `;

  const CONTAINER_STYLES = `
    width: min(1440px, 100%); max-height: 100%;
    display: flex; flex-direction: column; overflow: hidden;
    border-radius: 12px; background: #0f0f0f;
    box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
  `;

  const STAGE_STYLES = `
    position: relative; width: 100%; aspect-ratio: 16 / 9;
    max-height: calc(100vh - 120px); background: #000;
  `;

  const VIDEO_STYLES = `
    display: block; width: 100%; height: 100%;
    background: #000; object-fit: contain; outline: none;
  `;

  const CONTROLS_STYLES = `
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
    position: absolute; bottom: 0; left: 0; right: 0;
    transform: translateY(100%); opacity: 0;
    transition: transform 0.3s ease, opacity 0.3s ease;
  `;

  const PROGRESS_STYLES = `
    flex: 1; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px;
    cursor: pointer; position: relative;
  `;

  const PROGRESS_FILL_STYLES = `
    height: 100%; background: #E50914; border-radius: 2px; transition: width 0.1s linear;
  `;

  const BTN_STYLES = `
    padding: 6px 12px; border: none; border-radius: 4px;
    background: rgba(255,255,255,0.1); color: #fff;
    font: 600 12px system-ui, sans-serif; cursor: pointer;
    transition: background 0.2s ease; display: flex; align-items: center; gap: 6px;
  `;

  const BTN_HOVER = `rgba(255,255,255,0.2)`;

  // Utilities
  const sendBg = (action, payload = {}) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action, payload }, res => {
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });

  const findAnchorForUrl = url => {
    try {
      return document.querySelector(`a[href="${CSS.escape(url)}"]`);
    } catch (e) {
      return null;
    }
  };

  const formatTime = seconds => {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };

  // UI State Management
  const state = {
    activeAnchors: new Map(),
    activeWatchButtons: new Map()
  };

  // Progress Update Handler
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action !== "bypass_progress") return;
    const { url, status } = msg;

    const packBtn = document.getElementById("btn-dl-all-episodes");
    if (packBtn?.disabled && (/\/pack\//i.test(url) || url === window.location.href)) {
      packBtn.textContent = status;
    }

    const anchor = findAnchorForUrl(url);
    if (anchor?.dataset.bypassing === "true") {
      anchor.innerHTML = `<span style="opacity:0.85">${status}</span>`;
    }

    const btn = state.activeWatchButtons.get(url);
    if (btn?.dataset.resolving === "true") {
      btn.textContent = status;
    }
  });

  // DOM State Helpers
  const showStatus = (anchor, text, url) => {
    const saved = { html: anchor.innerHTML, pointerEvents: anchor.style.pointerEvents, cursor: anchor.style.cursor };
    anchor.innerHTML = `<span style="opacity:0.8">${text}</span>`;
    anchor.style.pointerEvents = "none";
    anchor.style.cursor = "wait";
    anchor.dataset.bypassing = "true";
    if (url) state.activeAnchors.set(url, anchor);
    return () => {
      anchor.innerHTML = saved.html;
      anchor.style.pointerEvents = saved.pointerEvents;
      anchor.style.cursor = saved.cursor;
      delete anchor.dataset.bypassing;
      if (url) state.activeAnchors.delete(url);
    };
  };

  const setWatchButtonState = (btn, label, resolving) => {
    btn.textContent = label;
    btn.disabled = resolving;
    btn.dataset.resolving = String(resolving);
    btn.style.opacity = resolving ? "0.6" : "1";
    btn.style.cursor = resolving ? "wait" : "pointer";
  };

  // Netflix-Style Player
  const createPlayer = (streamUrl, opener) => {
    const existing = document.getElementById("desiremovies-watch-overlay");
    if (existing) {
      const video = existing.querySelector("video");
      if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
      existing.remove();
    }

    const overlay = document.createElement("div");
    overlay.id = "desiremovies-watch-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Video player");
    overlay.style.cssText = PLAYER_STYLES;

    const container = document.createElement("div");
    container.style.cssText = CONTAINER_STYLES;

    const stage = document.createElement("div");
    stage.style.cssText = STAGE_STYLES;

    const video = document.createElement("video");
    video.src = streamUrl;
    video.controls = false;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", "Video player");
    video.style.cssText = VIDEO_STYLES;

    const controls = document.createElement("div");
    controls.style.cssText = CONTROLS_STYLES;

    // Progress bar
    const progressContainer = document.createElement("div");
    progressContainer.style.cssText = PROGRESS_STYLES;
    const progressFill = document.createElement("div");
    progressFill.style.cssText = PROGRESS_FILL_STYLES;
    progressContainer.appendChild(progressFill);

    // Buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = "display: flex; align-items: center; gap: 10px; flex: 0 0 auto;";

    const playBtn = document.createElement("button");
    playBtn.textContent = "⏸";
    playBtn.style.cssText = BTN_STYLES + "font-size: 16px;";
    playBtn.title = "Play / Pause";

    const timeDisplay = document.createElement("span");
    timeDisplay.style.cssText = "color: #fff; font: 600 12px system-ui, sans-serif; white-space: nowrap; min-width: 60px;";
    timeDisplay.textContent = "0:00 / 0:00";

    const volumeBtn = document.createElement("button");
    volumeBtn.textContent = "🔊";
    volumeBtn.style.cssText = BTN_STYLES;
    volumeBtn.title = "Mute / Unmute";

    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.min = "0";
    volumeSlider.max = "100";
    volumeSlider.value = "100";
    volumeSlider.style.cssText = "width: 80px; cursor: pointer;";
    volumeSlider.title = "Volume";

    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.textContent = "⛶";
    fullscreenBtn.style.cssText = BTN_STYLES;
    fullscreenBtn.title = "Fullscreen";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = BTN_STYLES + "color: #ff9999;";
    closeBtn.title = "Close player";

    buttonsContainer.append(playBtn, timeDisplay, volumeBtn, volumeSlider, fullscreenBtn, closeBtn);
    controls.appendChild(progressContainer);
    controls.appendChild(buttonsContainer);
    stage.append(video, controls);
    container.appendChild(stage);
    overlay.appendChild(container);
    document.documentElement.appendChild(overlay);

    // Event Handlers
    const updateProgress = () => {
      const percent = video.duration ? (video.currentTime / video.duration) * 100 : 0;
      progressFill.style.width = percent + "%";
      timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
    };

    const togglePlay = () => {
      video.paused ? video.play() : video.pause();
      playBtn.textContent = video.paused ? "▶" : "⏸";
    };

    const close = () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
      opener?.focus();
    };

    video.addEventListener("play", () => { playBtn.textContent = "⏸"; });
    video.addEventListener("pause", () => { playBtn.textContent = "▶"; });
    video.addEventListener("timeupdate", updateProgress);
    video.addEventListener("loadedmetadata", updateProgress);
    video.addEventListener("error", () => {
      const msg = document.createElement("div");
      msg.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #fff; font: 600 16px system-ui, sans-serif; text-align: center;";
      msg.textContent = "Playback unavailable.\nTry the Download button instead.";
      stage.appendChild(msg);
    });

    playBtn.addEventListener("click", togglePlay);
    volumeBtn.addEventListener("click", () => {
      video.volume = video.volume === 0 ? 1 : 0;
      volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
      volumeSlider.value = video.volume * 100;
    });
    volumeSlider.addEventListener("input", e => {
      video.volume = e.target.value / 100;
      volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
    });
    fullscreenBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        container.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
    closeBtn.addEventListener("click", close);

    progressContainer.addEventListener("click", e => {
      const rect = progressContainer.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      video.currentTime = percent * video.duration;
    });

    overlay.addEventListener("click", e => {
      if (e.target === overlay) close();
    });

    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        video.currentTime -= 10;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        video.currentTime += 10;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        video.currentTime += 10;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        video.currentTime -= 10;
      } else if (e.key === "<" || e.key === ",") {
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.05);
        volumeSlider.value = video.volume * 100;
        volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
      } else if (e.key === ">" || e.key === ".") {
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.05);
        volumeSlider.value = video.volume * 100;
        volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        video.volume = video.volume === 0 ? 1 : 0;
        volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
        volumeSlider.value = video.volume * 100;
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fullscreenBtn.click();
      }
    });

    stage.addEventListener("wheel", e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      video.volume = Math.max(0, Math.min(1, video.volume + delta));
      volumeSlider.value = video.volume * 100;
      volumeBtn.textContent = video.volume === 0 ? "🔇" : "🔊";
    }, { passive: false });

    const showControls = () => {
      controls.style.transform = "translateY(0)";
      controls.style.opacity = "1";
    };

    const hideControls = () => {
      if (!document.fullscreenElement) {
        controls.style.transform = "translateY(100%)";
        controls.style.opacity = "0";
      }
    };

    stage.addEventListener("mouseenter", showControls);
    stage.addEventListener("mouseleave", hideControls);
    stage.addEventListener("mousemove", () => {
      showControls();
      clearTimeout(stage._hideTimeout);
      stage._hideTimeout = setTimeout(hideControls, 3000);
    });
    stage.addEventListener("dblclick", () => fullscreenBtn.click());

    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement) {
        controls.style.display = "flex";
      }
    });

    overlay.focus();
    video.play().catch(() => {});
  };

  // Watch Online Handler
  const watchOnline = async (url, btn) => {
    setWatchButtonState(btn, "⏳ Resolving…", true);
    state.activeWatchButtons.set(url, btn);
    try {
      const res = await sendBg("resolve_stream", { url });
      if (!res?.success) throw new Error(res?.error || "Could not resolve stream");
      createPlayer(res.streamUrl, btn);
    } catch (error) {
      setWatchButtonState(btn, "❌ Unavailable", false);
      setTimeout(() => setWatchButtonState(btn, "▶ Watch Online", false), 3000);
    } finally {
      state.activeWatchButtons.delete(url);
    }
  };

  // Watch Buttons Injection
  const addWatchButtons = () => {
    if (!CONFIG.IS_DESIRE_MOVIES) return;
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!href || !CONFIG.BYPASS_LINK_RE.test(href) || /\/pack\//i.test(href) || a.nextElementSibling?.hasAttribute(CONFIG.WATCH_BUTTON_ATTR)) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute(CONFIG.WATCH_BUTTON_ATTR, "");
      btn.textContent = "▶ Watch Online";
      btn.style.cssText = `
        display: inline-flex; align-items: center; gap: 6px;
        margin: 5px 0 5px 10px; padding: 8px 12px;
        border: 1px solid rgba(255,255,255,.13); border-radius: 999px;
        background: linear-gradient(135deg, #E50914, #b70920);
        box-shadow: 0 5px 14px rgba(229,9,20,.24);
        color: #fff; font: 750 12px system-ui, sans-serif;
        letter-spacing: 0.01em; cursor: pointer;
        transition: all 0.2s ease;
      `;
      btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.05)"; });
      btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        watchOnline(href, btn);
      });
      a.insertAdjacentElement("afterend", btn);
    }
  };

  if (CONFIG.IS_DESIRE_MOVIES) {
    addWatchButtons();
    new MutationObserver(addWatchButtons).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Download All Episodes Button
  if (CONFIG.IS_PACK_PAGE) {
    const initPackBtn = () => {
      if (document.getElementById("btn-dl-all-episodes")) return;
      const btn = document.createElement("button");
      btn.id = "btn-dl-all-episodes";
      btn.innerHTML = "⚡ Download All";
      btn.style.cssText = `
        position: fixed; bottom: 25px; right: 25px; z-index: 2147483647;
        padding: 14px 24px; background: #E50914; color: #fff;
        font: 700 16px system-ui, sans-serif; border: none; border-radius: 50px;
        box-shadow: 0 6px 25px rgba(229,9,20,0.6);
        cursor: pointer; transition: all 0.2s ease;
      `;
      btn.onmouseover = () => {
        btn.style.transform = "scale(1.08)";
        btn.style.boxShadow = "0 8px 30px rgba(229,9,20,0.8)";
      };
      btn.onmouseout = () => {
        btn.style.transform = "scale(1)";
        btn.style.boxShadow = "0 6px 25px rgba(229,9,20,0.6)";
      };
      btn.onclick = async () => {
        btn.disabled = true;
        btn.innerHTML = "⏳ Resolving…";
        try {
          const links = [...document.querySelectorAll('a[href*="/file/"]')].map(a => a.href).filter(Boolean);
          const res = await sendBg("bypass_pack", { url: window.location.href, fileUrls: links });
          if (res?.success) {
            btn.innerHTML = `✅ ${res.count} Started`;
            btn.style.background = "#28a745";
          } else {
            btn.innerHTML = "❌ Failed";
            btn.style.background = "#dc3545";
          }
        } catch (err) {
          btn.innerHTML = "❌ Error";
          btn.style.background = "#dc3545";
        }
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = "⚡ Download All";
          btn.style.background = "#E50914";
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
  }

  // Link Click Interceptor
  document.addEventListener("click", async e => {
    const a = e.target.closest("a");
    if (!a?.href || a.dataset.bypassing || !CONFIG.BYPASS_LINK_RE.test(a.href) || /\/pack\//i.test(a.href)) return;

    e.preventDefault();
    e.stopPropagation();

    const restore = showStatus(a, "⏳ Connecting…", a.href);
    try {
      const res = await sendBg("full_bypass", { url: a.href });
      if (res?.success) {
        showStatus(a, "✅ Started", a.href);
        setTimeout(restore, 3000);
        return;
      }
      showStatus(a, "❌ Failed", a.href);
    } catch (err) {
      showStatus(a, "❌ Error", a.href);
    } finally {
      setTimeout(restore, 2000);
    }
  });
})();