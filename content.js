(function () {
  "use strict";

  if (window.__desiremoviesInjected) return;
  window.__desiremoviesInjected = true;

  const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|gdflix|goflix|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i;
  const CACHE_KEY = "dm_playback_cache";
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const activeAnchors = new Map();

  function sendBg(action, payload = {}) {
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action, payload }, (r) => {
        chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r);
      });
    });
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const t = Math.floor(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function getPlaybackKey(bypassUrl, streamUrl, title) {
    try { if (bypassUrl) return new URL(bypassUrl, location.href).pathname; } catch {}
    try { if (streamUrl) return new URL(streamUrl, location.href).pathname.split("/").pop(); } catch {}
    return title ? title.trim().toLowerCase() : null;
  }

  let memoryStore = null;
  let flushTimer = null;

  function loadStore() {
    if (memoryStore) return Promise.resolve(memoryStore);
    return new Promise((resolve) => {
      const finish = (data) => {
        const now = Date.now(), clean = {};
        for (const [k, v] of Object.entries(data || {})) {
          if (v?.time && now - (v.updatedAt || 0) < TTL_MS) clean[k] = v;
        }
        memoryStore = clean;
        resolve(memoryStore);
      };
      if (chrome?.storage?.local) chrome.storage.local.get([CACHE_KEY], (res) => finish(res?.[CACHE_KEY]));
      else {
        try { finish(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")); } catch { finish({}); }
      }
    });
  }

  function saveStore() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (!memoryStore) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(memoryStore)); } catch {}
      if (chrome?.storage?.local) chrome.storage.local.set({ [CACHE_KEY]: memoryStore }).catch(() => {});
    }, 1500);
  }

  async function getSavedPos(key) {
    return key ? (await loadStore())[key]?.time || null : null;
  }

  async function updateSavedPos(key, time, duration) {
    if (!key || !Number.isFinite(time) || time < 5) return;
    const store = await loadStore();
    if (duration && time >= duration - 15) delete store[key];
    else store[key] = { time: Math.round(time), duration: Math.round(duration || 0), updatedAt: Date.now() };
    saveStore();
  }

  async function clearSavedPos(key) {
    if (!key) return;
    const store = await loadStore();
    delete store[key];
    saveStore();
  }

  // Progress message handler from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== "bypass_progress") return;
    const { url, statusText } = msg;
    const packBtn = document.getElementById("btn-dl-all-episodes");
    if (packBtn?.disabled && (/\/pack\//i.test(url) || url === location.href)) packBtn.innerHTML = statusText;

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
    play: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.4-.5h.3v4.1zm3.8-2.1c0 .8-.1 1.4-.4 1.7-.3.3-.7.5-1.2.5s-.9-.2-1.2-.5c-.3-.3-.4-.9-.4-1.7v-.9c0-.8.1-1.4.4-1.7.3-.3.7-.5 1.2-.5s.9.2 1.2.5c.3.3.4.9.4 1.7v.9zm-.8-.9c0-.5 0-.9-.1-1.1-.1-.3-.3-.4-.6-.4s-.5.1-.6.4c-.1.2-.1.6-.1 1.1v.9c0 .5 0 .9.1 1.1.1.3.3.4.6.4s.5-.1.6-.4c.1-.2.1-.6.1-1.1v-.9z"/></svg>`,
    forward: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.4-.5h.3v4.1zm3.8-2.1c0 .8-.1 1.4-.4 1.7-.3.3-.7.5-1.2.5s-.9-.2-1.2-.5c-.3-.3-.4-.9-.4-1.7v-.9c0-.8.1-1.4.4-1.7.3-.3.7-.5 1.2-.5s.9.2 1.2.5c.3.3.4.9.4 1.7v.9zm-.8-.9c0-.5 0-.9-.1-1.1-.1-.3-.3-.4-.6-.4s-.5.1-.6.4c-.1.2-.1.6-.1 1.1v.9c0 .5 0 .9.1 1.1.1.3.3.4.6.4s.5-.1.6-.4c.1-.2.1-.6.1-1.1v-.9z"/></svg>`,
    volHigh: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    volLow: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`,
    volMute: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    fs: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
    fsExit: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`,
    pip: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    dl: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    kb: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 4H5v-2h2v2zm0-3H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 7h-2v-2h2v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>`
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

  function openPlayer(streamUrl, bypassUrl, titleText, openerBtn) {
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
          <video class="dm-video-el" src="${streamUrl}" playsinline preload="auto"></video>
          <div class="dm-center-pulse"></div>
          <div class="dm-hud-popup">
            <svg class="dm-hud-ring-svg" viewBox="0 0 82 82">
              <circle class="dm-hud-ring-bg" cx="41" cy="41" r="36"></circle>
              <circle class="dm-hud-ring-bar" cx="41" cy="41" r="36"></circle>
            </svg>
            <div class="dm-hud-content"><span class="dm-hud-icon"></span><span class="dm-hud-text"></span></div>
          </div>
          <div class="dm-buffering-spinner"></div>

          <div class="dm-floating-top">
            <div class="dm-title-box">
              <span class="dm-badge">DESIREMOVIES • WATCH ONLINE</span>
              <span class="dm-title-text">${titleText || "Video Stream"}</span>
            </div>
            <div class="dm-top-actions">
              <button class="dm-btn-action" id="dm-btn-sound">🔊 No Sound?</button>
              <button class="dm-btn-action" id="dm-btn-copy">${ICONS.copy} Copy Link</button>
              <button class="dm-btn-action" id="dm-btn-dl">${ICONS.dl} Download</button>
              <button class="dm-btn-action dm-btn-close" id="dm-btn-close">${ICONS.close}</button>
            </div>
          </div>

          <div class="dm-floating-bottom">
            <div class="dm-progress-track">
              <div class="dm-buffer-bar"></div>
              <div class="dm-played-bar"><div class="dm-scrubber-thumb"></div></div>
              <div class="dm-time-tooltip"></div>
            </div>
            <div class="dm-controls-row">
              <div class="dm-controls-left">
                <button class="dm-ctrl-btn" id="dm-play">${ICONS.play}</button>
                <button class="dm-ctrl-btn" id="dm-rw">${ICONS.rewind}</button>
                <button class="dm-ctrl-btn" id="dm-ff">${ICONS.forward}</button>
                <div class="dm-volume-box">
                  <button class="dm-ctrl-btn" id="dm-vol-btn">${ICONS.volHigh}</button>
                  <div class="dm-vol-slider"><div class="dm-vol-fill"></div></div>
                </div>
                <span class="dm-time-display">0:00 / 0:00</span>
              </div>
              <div class="dm-controls-right">
                <button class="dm-speed-pill" id="dm-speed">1x</button>
                <button class="dm-ctrl-btn" id="dm-pip">${ICONS.pip}</button>
                <button class="dm-ctrl-btn" id="dm-fs">${ICONS.fs}</button>
                <button class="dm-ctrl-btn" id="dm-help">${ICONS.kb}</button>
              </div>
            </div>
          </div>

          <div class="dm-modal-backdrop" id="dm-modal">
            <div class="dm-modal-card">
              <div class="dm-modal-title" id="dm-modal-title"></div>
              <div class="dm-modal-desc" id="dm-modal-desc"></div>
              <div class="dm-modal-actions" id="dm-modal-actions"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const stage = overlay.querySelector(".dm-video-stage");
    const container = overlay.querySelector(".dm-player-container");
    const video = overlay.querySelector(".dm-video-el");
    const playBtn = overlay.querySelector("#dm-play");
    const topBar = overlay.querySelector(".dm-floating-top");
    const bottomBar = overlay.querySelector(".dm-floating-bottom");
    const track = overlay.querySelector(".dm-progress-track");
    const playedBar = overlay.querySelector(".dm-played-bar");
    const bufferBar = overlay.querySelector(".dm-buffer-bar");
    const tooltip = overlay.querySelector(".dm-time-tooltip");
    const timeDisplay = overlay.querySelector(".dm-time-display");
    const volBtn = overlay.querySelector("#dm-vol-btn");
    const volSlider = overlay.querySelector(".dm-vol-slider");
    const volFill = overlay.querySelector(".dm-vol-fill");
    const speedBtn = overlay.querySelector("#dm-speed");
    const fsBtn = overlay.querySelector("#dm-fs");
    const pipBtn = overlay.querySelector("#dm-pip");
    const pulse = overlay.querySelector(".dm-center-pulse");
    const spinner = overlay.querySelector(".dm-buffering-spinner");
    const hud = overlay.querySelector(".dm-hud-popup");
    const hudRing = overlay.querySelector(".dm-hud-ring-bar");
    const hudIcon = overlay.querySelector(".dm-hud-icon");
    const hudText = overlay.querySelector(".dm-hud-text");
    const modal = overlay.querySelector("#dm-modal");

    // Modal Helper
    function showDialog(title, desc, buttons) {
      overlay.querySelector("#dm-modal-title").textContent = title;
      overlay.querySelector("#dm-modal-desc").innerHTML = desc;
      const actions = overlay.querySelector("#dm-modal-actions");
      actions.innerHTML = "";
      buttons.forEach((b) => {
        const btn = document.createElement("button");
        btn.className = `dm-btn-action ${b.primary ? "dm-btn-primary" : ""}`;
        btn.innerHTML = b.label;
        btn.onclick = () => { b.onClick?.(btn); if (b.close !== false) modal.style.display = "none"; };
        actions.appendChild(btn);
      });
      modal.style.display = "flex";
    }
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

    // Initial Volume Restoration
    let lastVol = parseFloat(localStorage.getItem("dm_player_volume")) || 0.5;
    video.volume = Math.max(0, Math.min(1, lastVol));
    video.muted = localStorage.getItem("dm_player_muted") === "true";

    function syncVolUI() {
      const v = video.muted ? 0 : video.volume;
      volFill.style.width = `${Math.round(v * 100)}%`;
      volBtn.innerHTML = v === 0 || video.muted ? ICONS.volMute : (v < 0.5 ? ICONS.volLow : ICONS.volHigh);
    }
    syncVolUI();

    let hudTimer = null;
    function showHud(icon, text, progress = null) {
      hudIcon.innerHTML = icon;
      hudText.textContent = text;
      hudRing.style.strokeDashoffset = progress !== null ? String(226.2 * (1 - Math.max(0, Math.min(1, progress)))) : "0";
      hud.classList.add("show");
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => hud.classList.remove("show"), 750);
    }

    function triggerPulse(icon) {
      pulse.innerHTML = icon;
      pulse.classList.remove("show");
      void pulse.offsetWidth;
      pulse.classList.add("show");
    }

    function setVol(lvl) {
      const clamped = Math.max(0, Math.min(1, lvl));
      video.volume = clamped;
      video.muted = clamped === 0;
      if (clamped > 0) lastVol = clamped;
      localStorage.setItem("dm_player_volume", String(lastVol));
      localStorage.setItem("dm_player_muted", String(video.muted));
      syncVolUI();
      showHud(video.muted ? ICONS.volMute : ICONS.volHigh, `${Math.round(clamped * 100)}%`, video.muted ? 0 : clamped);
    }

    // Play/Pause & Duration
    const getDur = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : 0));
    let showRemaining = false;

    function updateProgress() {
      const dur = getDur(), cur = video.currentTime;
      playedBar.style.width = dur > 0 ? `${(cur / dur) * 100}%` : "0%";
      const curStr = showRemaining && dur > 0 ? `-${fmtTime(dur - cur)}` : fmtTime(cur);
      timeDisplay.textContent = `${curStr} / ${fmtTime(dur)}`;
    }

    function togglePlay() {
      if (video.paused) { video.play().catch(() => {}); playBtn.innerHTML = ICONS.pause; triggerPulse(ICONS.play); }
      else { video.pause(); playBtn.innerHTML = ICONS.play; triggerPulse(ICONS.pause); }
    }

    function seekRelative(delta) {
      const dur = getDur();
      video.currentTime = Math.max(0, Math.min(dur || Infinity, video.currentTime + delta));
      triggerPulse(delta > 0 ? ICONS.forward : ICONS.rewind);
    }

    // Resume position
    const videoKey = getPlaybackKey(bypassUrl, streamUrl, titleText);
    getSavedPos(videoKey).then((saved) => {
      if (!saved || saved < 5 || !document.contains(overlay)) return;
      const banner = document.createElement("div");
      banner.className = "dm-resume-banner";
      banner.innerHTML = `
        <span>⏱️ Resume from <b>${fmtTime(saved)}</b>?</span>
        <button class="dm-resume-btn dm-resume-btn-primary" id="dm-res-yes">▶ Resume</button>
        <button class="dm-resume-btn dm-resume-btn-secondary" id="dm-res-no">↺ Restart</button>
        <button class="dm-resume-close">✕</button>
      `;
      stage.appendChild(banner);
      const rm = () => { banner.classList.add("dm-hidden"); setTimeout(() => banner.remove(), 250); };
      banner.querySelector("#dm-res-yes").onclick = () => { video.currentTime = saved; video.play().catch(() => {}); rm(); };
      banner.querySelector("#dm-res-no").onclick = () => { video.currentTime = 0; clearSavedPos(videoKey); rm(); };
      banner.querySelector(".dm-resume-close").onclick = rm;
      setTimeout(rm, 10000);
    });

    // Control bar autohide
    let hideTimer = null;
    function pokeControls() {
      topBar.classList.remove("dm-controls-hidden");
      bottomBar.classList.remove("dm-controls-hidden");
      clearTimeout(hideTimer);
      if (!video.paused) hideTimer = setTimeout(() => {
        topBar.classList.add("dm-controls-hidden");
        bottomBar.classList.add("dm-controls-hidden");
      }, 2500);
    }
    stage.addEventListener("mousemove", pokeControls);

    // Timeline Scrubbing
    let isScrubbing = false;
    function scrubTrack(e) {
      const r = track.getBoundingClientRect(), dur = getDur();
      const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (dur > 0) video.currentTime = pct * dur;
    }
    track.onmousedown = (e) => { isScrubbing = true; track.classList.add("is-dragging"); scrubTrack(e); };
    track.onmousemove = (e) => {
      const r = track.getBoundingClientRect(), dur = getDur();
      const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (dur > 0) {
        tooltip.textContent = fmtTime(pct * dur);
        tooltip.style.left = `${e.clientX - r.left}px`;
        tooltip.style.opacity = "1";
      }
    };
    track.onmouseleave = () => { if (!isScrubbing) tooltip.style.opacity = "0"; };

    // Volume Scrubbing
    let isVolScrubbing = false;
    function scrubVol(e) {
      const r = volSlider.getBoundingClientRect();
      setVol((e.clientX - r.left) / r.width);
    }
    volSlider.onmousedown = (e) => { isVolScrubbing = true; scrubVol(e); };

    window.addEventListener("mousemove", (e) => {
      if (isScrubbing) scrubTrack(e);
      if (isVolScrubbing) scrubVol(e);
    });
    window.addEventListener("mouseup", () => {
      if (isScrubbing) { isScrubbing = false; track.classList.remove("is-dragging"); tooltip.style.opacity = "0"; }
      isVolScrubbing = false;
    });

    // Video Events
    video.ontimeupdate = () => {
      updateProgress();
      if (getDur()) updateSavedPos(videoKey, video.currentTime, getDur());
    };
    video.onprogress = () => {
      const dur = getDur();
      if (dur && video.buffered.length) bufferBar.style.width = `${(video.buffered.end(video.buffered.length - 1) / dur) * 100}%`;
    };
    video.onplay = () => { playBtn.innerHTML = ICONS.pause; pokeControls(); };
    video.onpause = () => { playBtn.innerHTML = ICONS.play; pokeControls(); };
    video.onseeking = () => { spinner.style.display = "block"; };
    video.onseeked = () => { spinner.style.display = "none"; };
    video.onwaiting = () => { spinner.style.display = "block"; };
    video.onplaying = () => { spinner.style.display = "none"; };
    video.onerror = () => {
      spinner.style.display = "none";
      showDialog("Browser Codec Notice", "This video container or audio codec (e.g. MKV, Dolby EAC3/DTS) cannot be natively decoded in Chrome. Download directly or copy the MPV command to stream smoothly.", [
        { label: `${ICONS.dl} Download`, primary: true, onClick: () => overlay.querySelector("#dm-btn-dl").click() },
        { label: "▶ Copy MPV", onClick: (b) => copyText(b, `mpv "${streamUrl}"`, "✓ Copied MPV!"), close: false },
        { label: "Copy Link", onClick: (b) => copyText(b, streamUrl) }
      ]);
    };

    // Button Actions
    playBtn.onclick = togglePlay;
    overlay.querySelector("#dm-rw").onclick = () => seekRelative(-10);
    overlay.querySelector("#dm-ff").onclick = () => seekRelative(10);
    timeDisplay.onclick = () => { showRemaining = !showRemaining; updateProgress(); };
    volBtn.onclick = () => setVol(video.muted || video.volume === 0 ? (lastVol || 0.5) : 0);

    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let spdIdx = 2;
    speedBtn.onclick = () => {
      spdIdx = (spdIdx + 1) % SPEEDS.length;
      video.playbackRate = SPEEDS[spdIdx];
      speedBtn.textContent = `${SPEEDS[spdIdx]}x`;
      showHud("⚡", `${SPEEDS[spdIdx]}x`, SPEEDS[spdIdx] / 2);
    };

    const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const toggleFs = () => {
      if (!isFs()) (container.requestFullscreen || container.webkitRequestFullscreen)?.call(container).catch(() => {});
      else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
    };
    fsBtn.onclick = toggleFs;
    document.onfullscreenchange = () => {
      container.classList.toggle("is-fullscreen", isFs());
      fsBtn.innerHTML = isFs() ? ICONS.fsExit : ICONS.fs;
    };

    if (document.pictureInPictureEnabled) {
      pipBtn.onclick = async () => {
        try { document.pictureInPictureElement ? await document.exitPictureInPicture() : await video.requestPictureInPicture(); } catch {}
      };
    } else pipBtn.style.display = "none";

    overlay.querySelector("#dm-btn-copy").onclick = function () { copyText(this, streamUrl); };
    overlay.querySelector("#dm-btn-dl").onclick = async function () {
      this.innerHTML = "⏳ Starting…";
      const res = await sendBg("full_bypass", { url: bypassUrl }).catch(() => null);
      flash(this, res?.success ? "✅ Started" : "❌ Failed", 2500, `${ICONS.dl} Download`);
    };

    overlay.querySelector("#dm-btn-sound").onclick = () => {
      showDialog("No Audio in Browser?", "Web browsers cannot decode multi-channel <b>Dolby Digital (AC3/E-AC3)</b> or <b>DTS</b> audio tracks. Copy the MPV command to play with full surround sound or download the video.", [
        { label: "▶ Copy MPV Command", primary: true, onClick: (b) => copyText(b, `mpv "${streamUrl}"`, "✓ Copied MPV!"), close: false },
        { label: "Copy Link", onClick: (b) => copyText(b, streamUrl) },
        { label: "Close" }
      ]);
    };

    overlay.querySelector("#dm-help").onclick = () => {
      showDialog("⌨️ Keyboard Shortcuts", `
        <div class="dm-shortcuts-grid">
          <div class="dm-shortcut-row"><span>Play / Pause</span><span class="dm-shortcut-key">Space / K</span></div>
          <div class="dm-shortcut-row"><span>Seek ±10s</span><span class="dm-shortcut-key">← / → or J / L</span></div>
          <div class="dm-shortcut-row"><span>Volume ±5%</span><span class="dm-shortcut-key">↑ / ↓ or Wheel</span></div>
          <div class="dm-shortcut-row"><span>Mute</span><span class="dm-shortcut-key">M</span></div>
          <div class="dm-shortcut-row"><span>Fullscreen</span><span class="dm-shortcut-key">F</span></div>
          <div class="dm-shortcut-row"><span>Close</span><span class="dm-shortcut-key">Esc</span></div>
        </div>
      `, [{ label: "Close" }]);
    };

    function close() {
      if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
      openerBtn?.focus();
    }

    overlay.querySelector("#dm-btn-close").onclick = close;
    stage.ondblclick = (e) => { if (e.target === video || e.target === stage) toggleFs(); };
    stage.onclick = (e) => { if (e.target === video) togglePlay(); };
    stage.onwheel = (e) => { e.preventDefault(); setVol(video.volume + (e.deltaY < 0 ? 0.05 : -0.05)); };

    const KEY_MAP = {
      " ": togglePlay, "k": togglePlay,
      "arrowleft": () => seekRelative(-10), "j": () => seekRelative(-10),
      "arrowright": () => seekRelative(10), "l": () => seekRelative(10),
      "arrowup": () => setVol(video.volume + 0.05),
      "arrowdown": () => setVol(video.volume - 0.05),
      "m": () => setVol(video.muted ? (lastVol || 0.5) : 0),
      "f": toggleFs, "p": () => pipBtn.click(),
      "escape": () => { modal.style.display === "flex" ? (modal.style.display = "none") : (isFs() ? toggleFs() : close()); }
    };

    function onKey(e) {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k >= "0" && k <= "9" && getDur() > 0) {
        e.preventDefault(); e.stopPropagation(); video.currentTime = (Number(k) / 10) * getDur(); return;
      }
      if (KEY_MAP[k]) { e.preventDefault(); e.stopPropagation(); KEY_MAP[k](); }
    }
    window.addEventListener("keydown", onKey, true);

    video.play().catch(() => {});
  }

  function isSameDomain(url) {
    try { return new URL(url, location.href).hostname === location.hostname; } catch { return false; }
  }

  // Inject "Watch Online" buttons
  function injectWatchButtons() {
    const anchors = document.querySelectorAll(`a[href]:not([data-dm-processed])`);
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href || !RE_BYPASS.test(href) || /\/pack\//i.test(href) || isSameDomain(href)) continue;
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
          if (res?.success && res.streamUrl) openPlayer(res.streamUrl, href, title, btn);
          else throw new Error(res?.error || "Stream unavailable");
        } catch (err) {
          btn.innerHTML = `❌ ${err.message || "Failed"}`;
          setTimeout(() => { btn.innerHTML = "▶ Watch Online"; btn.disabled = false; }, 3000);
        }
      };
      a.insertAdjacentElement("afterend", btn);
    }
  }

  // Episode Pack Downloader
  if (/\/pack\//i.test(location.pathname) || /\/pack\//i.test(location.href)) {
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
    if (!href || a.dataset.bypassing || !RE_BYPASS.test(href) || /\/pack\//i.test(href) || isSameDomain(href)) return;

    e.preventDefault(); e.stopPropagation();
    const restore = showStatus(a, "⏳ Connecting…", href);
    try {
      const res = await sendBg("full_bypass", { url: href });
      showStatus(a, res?.success ? "✅ Download started" : "❌ Failed", href);
      if (!res?.success) window.open(href, "_blank");
    } catch {
      showStatus(a, "❌ Error", href);
      window.open(href, "_blank");
    } finally {
      setTimeout(restore, 2500);
    }
  });

  injectWatchButtons();
  new MutationObserver(injectWatchButtons).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
