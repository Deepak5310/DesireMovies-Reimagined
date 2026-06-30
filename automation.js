/**
 * automation.js — Content Script (document_start)
 *
 * Injected only into bypass-chain pages: Gyanigurus, GDFlix, FastCDN.
 * Auto-clicks through each step of the download flow and closes the tab when done.
 */

(function () {
  "use strict";

  const host = location.hostname;

  // ─── Shared Utilities ──────────────────────────────────────────────────────

  const OBSERVER_CONFIG = { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "class"] };
  const SAFETY_TIMEOUT_MS = 30_000;

  let completed = false;
  let timeoutId = null;
  let observer = null;

  function cleanup() {
    observer?.disconnect();
    observer = null;
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  function safetyClose() {
    console.warn("[DM] Safety timeout reached. Closing hanging tab.");
    cleanup();
    chrome.runtime.sendMessage({ action: "close_tab" });
  }

  function scheduleClose(ms) {
    cleanup();
    setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), ms);
  }

  function clickAndClose(el, ms = 10_000) {
    completed = true;
    if (el.tagName === "A") el.target = "_self";
    el.click();
    scheduleClose(ms);
  }

  function observe(handler, config = OBSERVER_CONFIG, debounceMs = 150) {
    let timer;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(handler, debounceMs);
    };
    observer = new MutationObserver(debounced);
    observer.observe(document.documentElement, config);
    timeoutId = setTimeout(safetyClose, SAFETY_TIMEOUT_MS);
  }

  // ─── Strategies ────────────────────────────────────────────────────────────

  const strategies = [
    {
      name: "Gyanigurus",
      matches: (h) => h.includes("gyanigurus"),
      init: () => {
        const OPEN_LINK_RE = /click\s*here|open\s*link/i;
        let unlocked = false;

        function tryUnlock() {
          if (unlocked) return;
          for (const btn of document.querySelectorAll("button")) {
            if ((btn.getAttribute("onclick") || "").includes("show_content_v") ||
                OPEN_LINK_RE.test(btn.textContent)) {
              btn.click();
              unlocked = true;
              return;
            }
          }
        }

        function tryGdflix() {
          if (completed) return true;
          const a = document.querySelector('a[href*="gdflix"]');
          if (!a) return false;
          clickAndClose(a);
          return true;
        }

        if (!tryGdflix()) {
          tryUnlock();
          if (!tryGdflix()) {
            observe(() => { if (!tryGdflix()) tryUnlock(); });
          }
        }
      }
    },
    {
      name: "GDFlix",
      matches: (h) => h.includes("gdflix"),
      init: () => {
        const INSTANT_DL_RE = /instant\s*dl/i;
        function tryInstantDL() {
          if (completed) return true;
          for (const a of document.querySelectorAll("a")) {
            const text = a.querySelector("b")?.textContent ?? a.textContent;
            if (INSTANT_DL_RE.test(text)) {
              clickAndClose(a);
              return true;
            }
          }
          return false;
        }
        if (!tryInstantDL()) observe(() => tryInstantDL());
      }
    },
    {
      name: "FastCDN/FoxCloud",
      matches: (h) => h.includes("fastcdn") || h.includes("foxcloud") || h.includes("busycdn"),
      init: () => {
        function tryDownload() {
          if (completed) return true;
          
          // FastCDN logic (#vd + #downloadbtn)
          const vd = document.querySelector("#vd");
          const btn = document.querySelector("#downloadbtn");
          if (vd && btn && vd.getAttribute("href")?.startsWith("http")) {
            completed = true;
            btn.click();
            scheduleClose(5000);
            return true;
          }
          
          // FoxCloud alternative logic (a.btn.btn-danger)
          const foxBtn = document.querySelector("a.btn-danger");
          if (foxBtn && foxBtn.getAttribute("href")?.startsWith("http")) {
            completed = true;
            foxBtn.click();
            scheduleClose(5000);
            return true;
          }
          return false;
        }
        if (!tryDownload()) observe(() => tryDownload());
      }
    }
  ];

  // ─── Boot ──────────────────────────────────────────────────────────────────

  for (const strategy of strategies) {
    if (strategy.matches(host)) {
      console.log(`[DM] Applying strategy: ${strategy.name}`);
      strategy.init();
      break;
    }
  }

})();
