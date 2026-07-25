const fs = require("fs");
const path = require("path");

const srcDir = __dirname;
const distFirefox = path.join(__dirname, "dist", "firefox");

// Ensure directory exists
if (!fs.existsSync(distFirefox)) fs.mkdirSync(distFirefox, { recursive: true });
const iconsDir = path.join(distFirefox, "icons");
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Copy icons
const icons = ["icon16.png", "icon32.png", "icon48.png", "icon128.png"];
icons.forEach((icon) => {
  const srcPath = path.join(srcDir, "icons", icon);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(distFirefox, "icons", icon));
  }
});

// Copy content.js
fs.copyFileSync(
  path.join(srcDir, "content.js"),
  path.join(distFirefox, "content.js"),
);

// Handle manifest.json
const manifestPath = path.join(srcDir, "manifest.json");
const manifestStr = fs.readFileSync(manifestPath, "utf8");
const firefoxManifest = JSON.parse(manifestStr);
firefoxManifest.background = {
  scripts: ["background.js"],
};
firefoxManifest.browser_specific_settings = {
  gecko: {
    id: "desiremovies-bypass@deepak.local"
  }
};
fs.writeFileSync(
  path.join(distFirefox, "manifest.json"),
  JSON.stringify(firefoxManifest, null, 2)
);

// Handle background.js
const bgPath = path.join(srcDir, "background.js");
let bgStr = fs.readFileSync(bgPath, "utf8");

// Patch resolveFullChain cache storage
bgStr = bgStr.replace(
  "bypassCache.set(url, finalUrl);",
  `const titleMatch = html2.match(/<title>([^<]+)<\\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1] : "";
  bypassCache.set(url, { url: finalUrl, title: pageTitle });`,
);

bgStr = bgStr.replace(
  "return { success: true, downloadUrl: finalUrl };",
  "return { success: true, downloadUrl: finalUrl, title: pageTitle };",
);

// Patch bypass cache retrieval
bgStr = bgStr.replace(
  "if (bypassCache.has(url)) return { success: true, downloadUrl: bypassCache.get(url) };",
  `if (bypassCache.has(url)) {
    const cached = bypassCache.get(url);
    if (typeof cached === "string") return { success: true, downloadUrl: cached, title: "" };
    return { success: true, downloadUrl: cached.url, title: cached.title };
  }`,
);

// Patch cleanFilename to handle missing extensions
bgStr = bgStr.replace(
  `  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;
  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx);`,
  `  let ext = "";
  let base = filename;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx > 0 && filename.length - dotIdx <= 5) {
    ext = filename.slice(dotIdx);
    base = filename.slice(0, dotIdx);
  } else {
    ext = ".mkv";
  }`,
);

// Remove onDeterminingFilename listener for Firefox
bgStr = bgStr.replace(
  /chrome\.downloads\.onDeterminingFilename\.addListener\([\s\S]+/,
  "",
);

// Patch full_bypass download handling for Firefox
const ffDownloadLogic = `promise.then((result) => {
      sendProgress(tabId, url, "✅ Download started");
      if (result.title) {
          const cleaned = cleanFilename(decodeURIComponent(result.title));
          chrome.downloads.download({ url: result.downloadUrl, filename: cleaned });
      } else {
          chrome.downloads.download({ url: result.downloadUrl });
      }
      sendResponse({ success: true });
    })`;

bgStr = bgStr.replace(
  /promise\.then\(\(result\) => \{[\s\S]*?sendResponse\(\{ success: true \}\);\s*\}\)/,
  ffDownloadLogic,
);

fs.writeFileSync(path.join(distFirefox, "background.js"), bgStr);
console.log(
  "Build completed successfully. Firefox extension is available in dist/firefox.",
);
