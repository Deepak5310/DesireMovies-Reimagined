// Blocks window.open popups and tab redirects on gyanigurus.xyz
if (window.open && !window.open.isShielded) {
  window.open = function () {
    return null;
  };
  window.open.isShielded = true;
}
