// Blocks window.open popups and tab redirects on gyanigurus.xyz
window.open = function () {
  console.log("Popup blocked!");
  return null;
};
