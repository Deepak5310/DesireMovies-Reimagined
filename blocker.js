/**
 * blocker.js — Popup Blocker
 * Injected into the MAIN world to intercept and block popup/redirect attempts from page scripts.
 */
(function () {
  "use strict";

  // Override window.open
  window.open = function () {
    console.log("[DM Reimagined] Popup blocked!");
    return null;
  };
})();
