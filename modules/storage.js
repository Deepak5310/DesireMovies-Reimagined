/**
 * storage.js — chrome.storage.local wrapper
 * Provides get/set with defaults for all extension preferences.
 */

window.DMStorage = (() => {
  const DEFAULTS = {
    gridColumns:   4,       // 2 | 3 | 4 | 5
    showBadges:    true,    // show quality badge pills on cards
    compactMode:   false,   // reduce card size
    hideAds:       true,    // suppress ad elements
    theme:         'dark',  // 'dark' | 'darker'
  };

  async function get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(key in result ? result[key] : DEFAULTS[key]);
      });
    });
  }

  async function getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(Object.keys(DEFAULTS), (result) => {
        resolve({ ...DEFAULTS, ...result });
      });
    });
  }

  async function set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  async function reset() {
    return new Promise((resolve) => {
      chrome.storage.local.set(DEFAULTS, resolve);
    });
  }

  return { get, getAll, set, reset, DEFAULTS };
})();
