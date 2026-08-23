(function () {
  "use strict";
  if (window.__desiremoviesBypassInjected) return;
  window.__desiremoviesBypassInjected = true;

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

  const activeAnchors = new Map();
  const activeWatchButtons = new Map();
  const WATCH_BUTTON_ATTR = "data-desiremovies-watch";
  const BYPASS_LINK_RE =
    /^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba|gdflix|katdrama)/i;
  const isDesireMoviesPage = /(?:^|\.)\d*desiremovies(?:[.-]|$)/i.test(
    window.location.hostname,
  );

  function findAnchorForUrl(url) {
    if (activeAnchors.has(url)) return activeAnchors.get(url);
    try {
      return document.querySelector(`a[href="${CSS.escape(url)}"]`);
    } catch (e) {
      return null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "bypass_progress") {
      const { url, statusText } = msg;

      const packBtn = document.getElementById("btn-dl-all-episodes");
      if (
        packBtn &&
        packBtn.disabled &&
        (/\/pack\//i.test(url) || url === window.location.href)
      ) {
        packBtn.innerHTML = statusText;
      }

      const anchor = findAnchorForUrl(url);
      if (anchor && anchor.dataset.bypassing) {
        anchor.innerHTML = `<span style="opacity:0.9">${statusText}</span>`;
      }

      const watchButton = activeWatchButtons.get(url);
      if (watchButton?.dataset.resolving === "true") {
        watchButton.textContent = statusText;
      }
    }
  });

  function showStatus(anchor, text, url) {
    const saved = {
      html: anchor.innerHTML,
      pointerEvents: anchor.style.pointerEvents,
      cursor: anchor.style.cursor,
    };
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

  function setWatchButtonState(button, label, resolving) {
    button.textContent = label;
    button.disabled = resolving;
    button.dataset.resolving = String(resolving);
    button.style.opacity = resolving ? "0.72" : "1";
    button.style.cursor = resolving ? "wait" : "pointer";
  }

  function adjustVolume(video, amount) {
    video.volume = Math.max(
      0,
      Math.min(1, Math.round((video.volume + amount) * 100) / 100),
    );
  }

  function openPlayer(streamUrl, opener) {
    const existingOverlay = document.getElementById(
      "desiremovies-watch-overlay",
    );
    if (existingOverlay) {
      const existingVideo = existingOverlay.querySelector("video");
      existingVideo?.pause();
      existingVideo?.removeAttribute("src");
      existingVideo?.load();
      existingOverlay.remove();
    }

    const overlay = document.createElement("div");
    overlay.id = "desiremovies-watch-overlay";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Online video player");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:clamp(12px,3vw,36px);box-sizing:border-box;background:radial-gradient(circle at 50% 18%,#202a3d 0,#0d111a 42%,#050608 100%);backdrop-filter:blur(18px);color:#f8fafc;";

    const player = document.createElement("div");
    player.style.cssText =
      "width:min(1280px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:18px;background:#0d1118;box-shadow:0 28px 90px rgba(0,0,0,.6);";

    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;background:linear-gradient(135deg,#151d2b,#0d1118);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    const heading = document.createElement("div");
    heading.style.cssText =
      "min-width:0;display:flex;flex-direction:column;gap:2px;";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "DESIREMOVIES  •  ONLINE WATCH";
    eyebrow.style.cssText =
      "color:#8aa0c7;font-size:10px;font-weight:800;letter-spacing:.13em;";
    const title = document.createElement("span");
    title.textContent = "Online Watch";
    title.style.cssText =
      "overflow:hidden;color:#fff;font-size:16px;font-weight:750;line-height:1.3;text-overflow:ellipsis;white-space:nowrap;";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex:0 0 auto;gap:8px;";

    const fullscreen = document.createElement("button");
    fullscreen.type = "button";
    fullscreen.textContent = "⛶ Fullscreen";
    fullscreen.title = "Enter fullscreen";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close ×";
    close.title = "Close player";
    fullscreen.style.cssText =
      "border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px 11px;background:rgba(255,255,255,.07);color:#f8fafc;font:700 13px system-ui,sans-serif;cursor:pointer;";
    close.style.cssText =
      "border:1px solid rgba(255,112,112,.35);border-radius:8px;padding:8px 11px;background:rgba(229,9,20,.12);color:#ffb4b8;font:700 13px system-ui,sans-serif;cursor:pointer;";
    heading.append(eyebrow, title);
    actions.append(fullscreen, close);
    toolbar.append(heading, actions);

    const stage = document.createElement("div");
    stage.style.cssText =
      "position:relative;width:100%;aspect-ratio:16 / 9;max-height:calc(100vh - 190px);background:#000;";

    const video = document.createElement("video");
    video.src = streamUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", "Online video player");
    video.style.cssText =
      "display:block;width:100%;height:100%;background:#000;object-fit:contain;outline:none;";
    stage.appendChild(video);

    const hints = document.createElement("div");
    hints.textContent = "← → 10s seek   •   ↑ ↓ volume   •   Mouse wheel volume";
    hints.style.cssText =
      "padding:10px 18px;background:#0d1118;color:#8b97aa;font:600 12px/1.3 system-ui,sans-serif;text-align:center;";
    player.append(toolbar, stage, hints);
    overlay.appendChild(player);
    document.documentElement.appendChild(overlay);

    const closePlayer = () => {
      if (document.fullscreenElement === overlay)
        document.exitFullscreen?.().catch(() => {});
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
      opener?.focus();
    };

    const onKeydown = (event) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        event.preventDefault();
        closePlayer();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        adjustVolume(video, 0.05);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        adjustVolume(video, -0.05);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + 10,
        );
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 10);
      }
    };
    const onWheel = (event) => {
      event.preventDefault();
      adjustVolume(video, event.deltaY < 0 ? 0.05 : -0.05);
    };
    overlay.addEventListener("keydown", onKeydown);
    overlay.addEventListener("wheel", onWheel, { passive: false });
    close.addEventListener("click", closePlayer);
    fullscreen.addEventListener("click", () => {
      if (document.fullscreenElement)
        document.exitFullscreen?.().catch(() => {});
      else overlay.requestFullscreen?.().catch(() => {});
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePlayer();
    });
    video.addEventListener("error", () => {
      title.textContent = "This source cannot be played online";
      hints.textContent = "Try the Download button instead.";
    });
    overlay.focus();
    video.play().catch(() => {});
  }

  async function watchOnline(url, button) {
    setWatchButtonState(button, "⏳ Resolving stream…", true);
    activeWatchButtons.set(url, button);
    try {
      const res = await sendBg("resolve_stream", { url });
      if (!res?.success || !res.streamUrl)
        throw new Error(res?.error || "Could not resolve a stream");
      openPlayer(res.streamUrl, button);
    } catch (error) {
      setWatchButtonState(button, "❌ Stream unavailable", false);
      setTimeout(
        () => setWatchButtonState(button, "▶ Watch Online", false),
        3000,
      );
    } finally {
      activeWatchButtons.delete(url);
      if (button.isConnected && button.dataset.resolving === "true")
        setWatchButtonState(button, "▶ Watch Online", false);
    }
  }

  function addWatchButtons() {
    if (!isDesireMoviesPage) return;
    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");
      if (
        !href ||
        !BYPASS_LINK_RE.test(href) ||
        /\/pack\//i.test(href) ||
        anchor.nextElementSibling?.hasAttribute(WATCH_BUTTON_ATTR)
      )
        continue;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(WATCH_BUTTON_ATTR, "");
      button.textContent = "▶ Watch Online";
      button.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;margin:5px 0 5px 10px;padding:8px 12px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:linear-gradient(135deg,#ef233c,#b70920);box-shadow:0 5px 14px rgba(229,9,20,.24);color:#fff;font:750 12px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.01em;cursor:pointer;vertical-align:middle;";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        watchOnline(href, button);
      });
      anchor.insertAdjacentElement("afterend", button);
    }
  }

  if (isDesireMoviesPage) {
    addWatchButtons();
    const observer = new MutationObserver(addWatchButtons);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Inject Download All Episodes button on pack pages
  if (
    /\/pack\//i.test(window.location.pathname) ||
    /\/pack\//i.test(window.location.href)
  ) {
    const initPackBtn = () => {
      if (document.getElementById("btn-dl-all-episodes")) return;
      const btn = document.createElement("button");
      btn.id = "btn-dl-all-episodes";
      btn.innerHTML = "⚡ Download All Episodes";
      btn.style.cssText =
        "position:fixed;bottom:25px;right:25px;z-index:2147483647;padding:14px 24px;background:#e50914;color:#ffffff;font-weight:bold;font-size:16px;font-family:sans-serif;border:none;border-radius:50px;box-shadow:0 6px 25px rgba(229,9,20,0.6);cursor:pointer;transition:all 0.2s ease;";
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
        btn.innerHTML = "⏳ Resolving All Episodes...";
        try {
          const domLinks = [...document.querySelectorAll('a[href*="/file/"]')]
            .map((a) => a.href)
            .filter(Boolean);
          const res = await sendBg("bypass_pack", {
            url: window.location.href,
            fileUrls: domLinks,
          });
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

    if (!BYPASS_LINK_RE.test(href)) return;
    if (/\/pack\//i.test(href)) return;

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
