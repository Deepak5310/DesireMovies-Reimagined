// DesireMovies Automation — Consolidated Automation Script
// Handles bypass, auto-clicks, and fallback logic based on the domain.

(function () {
  "use strict";

  const host = window.location.hostname;
  
  // Quick exit if not a target domain
  if (!host.includes("gyanigurus.xyz") && !host.includes("gdflix") && !host.includes("fastcdn-dl.pages.dev") && !host.includes("kmhd")) {
    return;
  }

  let done = false;
  let safetyTimeoutId = null;
  let observer = null;

  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function cleanup() {
    if (observer) observer.disconnect();
    if (safetyTimeoutId) clearTimeout(safetyTimeoutId);
  }

  function closeFallback() {
    setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 10000);
  }

  // --- Gyanigurus Logic ---
  if (host.includes("gyanigurus.xyz")) {
    const BUTTON_TEXT_RE = /click\s*here|open\s*link/i;
    let openBtnClicked = false;

    function tryClickOpenButton() {
      if (openBtnClicked) return true;
      for (const btn of document.querySelectorAll("button")) {
        if ((btn.getAttribute("onclick") || "").includes("show_content_v") || BUTTON_TEXT_RE.test(btn.textContent)) {
          btn.click();
          openBtnClicked = true;
          return true;
        }
      }
      return false;
    }

    function tryClickGdflix() {
      if (done) return true;
      const a = document.querySelector('a[href*="gdflix"]');
      if (a) {
        done = true;
        a.target = "_self";
        a.click();
        cleanup();
        closeFallback();
        return true;
      }
      return false;
    }

    function runGyanigurus() {
      if (tryClickGdflix()) return;
      tryClickOpenButton();
      if (tryClickGdflix()) return;

      const debouncedCallback = debounce(() => {
        if (tryClickGdflix()) return;
        if (!openBtnClicked) tryClickOpenButton();
      }, 150);

      observer = new MutationObserver(debouncedCallback);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      safetyTimeoutId = setTimeout(cleanup, 15000);
    }

    runGyanigurus();
  }

  // --- Gdflix Logic ---
  else if (host.includes("gdflix")) {
    const INSTANT_DL_RE = /instant\s*dl/i;
    let cachedButton = null;

    function tryClickInstantDL() {
      if (done) return true;
      if (cachedButton) {
        done = true;
        cachedButton.target = "_self";
        cachedButton.click();
        cleanup();
        closeFallback();
        return true;
      }
      const anchors = document.querySelectorAll("a");
      for (const a of anchors) {
        const b = a.querySelector("b");
        if ((b && INSTANT_DL_RE.test(b.textContent)) || INSTANT_DL_RE.test(a.textContent)) {
          cachedButton = a;
          done = true;
          a.target = "_self";
          a.click();
          cleanup();
          closeFallback();
          return true;
        }
      }
      return false;
    }

    function runGdflix() {
      if (tryClickInstantDL()) return;
      observer = new MutationObserver(() => {
        if (tryClickInstantDL()) cleanup();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      safetyTimeoutId = setTimeout(cleanup, 15000);
    }

    runGdflix();
  }

  // --- FastCDN Logic ---
  else if (host.includes("fastcdn-dl.pages.dev")) {
    function tryClickDownload() {
      if (done) return true;
      const anchor = document.querySelector("#vd");
      const btn = document.querySelector("#downloadbtn");
      if (anchor && btn) {
        const href = anchor.getAttribute("href");
        if (href && href !== "#" && href.startsWith("http")) {
          done = true;
          btn.click();
          cleanup();
          setTimeout(() => chrome.runtime.sendMessage({ action: "close_tab" }), 5000);
          return true;
        }
      }
      return false;
    }

    function runFastCDN() {
      if (tryClickDownload()) return;
      observer = new MutationObserver(() => {
        if (tryClickDownload()) cleanup();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "class"] });
      safetyTimeoutId = setTimeout(cleanup, 15000);
    }

    runFastCDN();
  }

  // --- KMHD Logic ---
  else if (host.includes("kmhd")) {
    const BUTTON_TEXT_RE = /unlock\s*links|click\s*to\s*unlock/i;

    let clickedUnlock = false;
    let clickedGdflix = false;

    function tryClickUnlockOrGdflix() {
      if (clickedGdflix) return true;

      // 1. If we are on the page with links, find the gdflix link/button and click it
      const gdflixLink = document.querySelector('a[href*="gdflix"]');
      const gdflixImgBtn = document.querySelector('img[alt*="gdflix"]')?.closest('button');
      const targetElement = gdflixLink || gdflixImgBtn;
      
      if (targetElement) {
        clickedGdflix = true;
        if (targetElement.tagName === 'A') {
          targetElement.target = "_self";
        }
        targetElement.click();
        cleanup();
        
        // Wait for the new tab to open (this tab becomes hidden) before closing
        let closed = false;
        const doClose = () => {
          if (closed) return;
          closed = true;
          chrome.runtime.sendMessage({ action: "close_tab" });
        };
        
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === 'hidden') {
            doClose();
          }
        });
        
        // Fallback timeout just in case
        setTimeout(doClose, 4000);
        return true;
      }

      // 2. If we are on the initial page, click the unlock button
      if (!clickedUnlock) {
        for (const btn of document.querySelectorAll("button")) {
          if (BUTTON_TEXT_RE.test(btn.textContent)) {
            clickedUnlock = true;
            // Wait 1.5 seconds for SvelteKit to hydrate before clicking
            setTimeout(() => {
              btn.click();
            }, 1500);
            break;
          }
        }
      }
      return false;
    }

    function runKmhd() {
      if (tryClickUnlockOrGdflix()) return;
      
      const debouncedCallback = debounce(() => {
        if (tryClickUnlockOrGdflix()) return;
      }, 150);

      observer = new MutationObserver(debouncedCallback);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      safetyTimeoutId = setTimeout(cleanup, 15000);
    }

    runKmhd();
  }

})();
