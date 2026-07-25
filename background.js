"use strict";
const activeBypasses = new Map();
const bypassCache = new Map();

// Matching Patterns
const GDFLIX_HREF_RE = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i;
const INSTANT_DL_RE = /href=["'](https?:\/\/[^"'\s]*(?:busycdn|foxcloud|fastcdn|workers\.dev|instant\.)[^"'\s]+)['"]/i;
const RE_GYANIGURUS = /^https?:\/\/[^/]*gyanigurus/i;
const RE_DESIREMOVIES = /^https?:\/\/[^/]*desiremovies/i;
const RE_KATMOVIEHD = /^https?:\/\/[^/]*katmoviehd/i;
const RE_KMHD = /^https?:\/\/[^/]*kmhd/i;
const RE_MOVIESBABA = /^https?:\/\/[^/]*moviesbaba/i;
const RE_GDFLIX = /^https?:\/\/[^/]*(gdflix|gd\.kmhd)/i;

// Cache Persistence
const ready = (async () => {
  try {
    const sessionData = await chrome.storage.session.get(["bypassCache"]);
    if (sessionData.bypassCache) {
      for (const [k, v] of Object.entries(sessionData.bypassCache)) bypassCache.set(k, v);
    }
  } catch (e) {}
})();

function persistState() {
  chrome.storage.session.set({ bypassCache: Object.fromEntries(bypassCache) }).catch(() => {});
}

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally { clearTimeout(id); }
}

async function fetchHTML(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${new URL(url).hostname}`);
  return res.text();
}

async function extractDownloadFromGDFlixHTML(html, pageUrl) {
  // First check for direct video stream link on the page (busycdn / fastcdn / cloud-dl / workers / cloudflarestorage)
  let instantMatch = html.match(/href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers|cloudflarestorage)[^"']+)["']/i);

  // If not found or matched an ad button, check for GDFlix /cloud/ endpoint page
  if (!instantMatch || !/\.(?:mkv|mp4|avi|webm)|bytes=/i.test(instantMatch[1])) {
    const cloudMatch = html.match(/href=["']([^"']*\/(?:cloud)\/\d+\/[a-zA-Z0-9_-]+)["']/i);
    if (cloudMatch) {
      const cloudUrl = cloudMatch[1].startsWith("http") ? cloudMatch[1] : `${new URL(pageUrl).origin}${cloudMatch[1]}`;
      const cloudHtml = await fetchHTML(cloudUrl);
      const dlMatch = cloudHtml.match(/href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers|cloudflarestorage)[^"']+)["']/i);
      if (dlMatch) instantMatch = dlMatch;
    }
  }

  if (!instantMatch) throw new Error("Direct video download link not found on GDFlix page");

  const rawUrl = instantMatch[1].replace(/&amp;/g, "&");
  const redirectRes = await fetchWithTimeout(rawUrl);
  const parsedUrl = new URL(redirectRes.url);
  const finalUrl = parsedUrl.searchParams.get("url") || redirectRes.url;
  return encodeURI(finalUrl);
}

function isAllowedBypassUrl(url) {
  return RE_GYANIGURUS.test(url) || RE_KMHD.test(url) || RE_GDFLIX.test(url);
}

// Inject content script on target site loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url && (RE_DESIREMOVIES.test(tab.url) || RE_KATMOVIEHD.test(tab.url) || RE_MOVIESBABA.test(tab.url) || RE_KMHD.test(tab.url) || RE_GDFLIX.test(tab.url))) {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  }
});

// Headless redirect chain resolver
async function resolveFullChain(url) {
  await ready;
  if (bypassCache.has(url)) return { success: true, downloadUrl: bypassCache.get(url) };

  let finalUrl = "";

  if (RE_KMHD.test(url)) {
    const fileId = url.match(/\/file\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!fileId) throw new Error("Not a single file download link");
    const origin = new URL(url).origin;

    // Try GDFlix first
    try {
      const touchRes = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST" });
      if (touchRes.ok) {
        const touchData = await touchRes.json();
        if (touchData?.linkId) {
          const html2 = await fetchHTML(touchData.linkId);
          finalUrl = await extractDownloadFromGDFlixHTML(html2, touchData.linkId);
        }
      }
    } catch (e) {}

    // Fallback to HubDrive if GDFlix was blocked by Cloudflare or failed
    if (!finalUrl) {
      const touchRes = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST" });
      if (!touchRes.ok) throw new Error(`HTTP ${touchRes.status} on KMHD HubDrive API`);
      const touchData = await touchRes.json();
      if (!touchData?.linkId) throw new Error("Download link not found in KMHD API response");

      const hubUrl = touchData.linkId.replace(/hubcloud\.[a-z0-9.]+/i, "hubcloud.club");
      const hubHtml = await fetchHTML(hubUrl);
      const sportMatch = hubHtml.match(/href=["'](https?:\/\/[^"'\s]*sportverse\.[^"'\s]+)["']/i);
      if (sportMatch) {
        const sportHtml = await fetchHTML(sportMatch[1]);
        const dlMatch = sportHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|busycdn|fastcdn|pixeldrain)[^"'\s]+)["']/i);
        if (dlMatch) finalUrl = dlMatch[1];
      }
    }
  } else if (RE_GDFLIX.test(url)) {
    // Direct GDFlix URL flow (e.g. gdflix.dev/file/...)
    const html = await fetchHTML(url);
    finalUrl = await extractDownloadFromGDFlixHTML(html, url);
  } else {
    // Gyanigurus flow (DesireMovies)
    const html1 = await fetchHTML(url);
    let match = html1.match(GDFLIX_HREF_RE);
    if (!match) {
      const body = new URLSearchParams();
      for (const m of html1.matchAll(/<input[^>]+>/gi)) {
        const tag = m[0];
        if (/type=["']?hidden["']?/i.test(tag)) {
          const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
          const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
          if (name) body.append(name, value);
        }
      }
      const res2 = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!res2.ok) throw new Error(`HTTP ${res2.status} on Gyanigurus POST`);
      match = (await res2.text()).match(GDFLIX_HREF_RE);
    }
    if (!match) throw new Error("GDFlix link not found on Gyanigurus page");

    const html2 = await fetchHTML(match[1]);
    finalUrl = await extractDownloadFromGDFlixHTML(html2, match[1]);
  }

  if (!finalUrl) throw new Error("Could not resolve final download URL");

  bypassCache.set(url, finalUrl);
  persistState();
  return { success: true, downloadUrl: finalUrl };
}

async function resolvePackChain(packUrl, providedFileUrls = []) {
  await ready;
  const origin = new URL(packUrl).origin;
  let fileUrls = Array.isArray(providedFileUrls) && providedFileUrls.length ? providedFileUrls : [];

  if (!fileUrls.length) {
    const packId = packUrl.match(/\/pack\/([a-zA-Z0-9_-]+)/)?.[1];
    if (packId) {
      try {
        const res = await fetchWithTimeout(`https://api.dandndn.one/api/v1/pack/${packId}`);
        if (res.ok) {
          const packData = await res.json();
          const fileIds = Object.keys(packData?.info || {});
          if (fileIds.length) fileUrls = fileIds.map(id => `${origin}/file/${id}`);
        }
      } catch (e) {}
    }
  }

  if (!fileUrls.length) {
    try {
      const html = await fetchHTML(packUrl);
      const matches = [...html.matchAll(/href=["']([^"']*\/(?:file)\/[a-zA-Z0-9_-]+)["']/gi)];
      fileUrls = [...new Set(matches.map(m => m[1].startsWith("http") ? m[1] : `${origin}${m[1]}`))];
    } catch (e) {}
  }

  if (!fileUrls.length) throw new Error("No episodes found in pack");

  let startedCount = 0;
  for (const fileUrl of fileUrls) {
    try {
      const result = await resolveFullChain(fileUrl);
      if (result?.downloadUrl) {
        chrome.downloads.download({ url: result.downloadUrl });
        startedCount++;
      }
    } catch (e) {}
  }

  return { success: startedCount > 0, count: startedCount, total: fileUrls.length };
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === "bypass_pack") {
    const url = req.payload?.url;
    const fileUrls = req.payload?.fileUrls;
    if (!url) { sendResponse({ success: false, error: "Missing URL" }); return false; }
    resolvePackChain(url, fileUrls)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (req.action === "full_bypass") {
    const url = req.payload?.url;
    if (!url) { sendResponse({ success: false, error: "Missing URL" }); return false; }
    if (!isAllowedBypassUrl(url)) { sendResponse({ success: false, error: "URL not in bypass allowlist" }); return false; }

    let promise = activeBypasses.get(url);
    if (!promise) {
      promise = ready.then(() => resolveFullChain(url));
      activeBypasses.set(url, promise);
      promise.finally(() => activeBypasses.delete(url));
    }
    promise.then((result) => {
      chrome.downloads.download({ url: result.downloadUrl });
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  sendResponse({ success: false, error: `Unknown action: ${req.action}` });
  return false;
});

// Filename Cleaning Logic
const RE_TRAILING_DUP = /\s*\(\d+\)$/;
const RE_BRACKETS = /[\[\]\(\)\{\}]/g;
const RE_EP_PREFIX = /^EP((\.\d+)+)\./i;
const RE_BRANDING = /[-\s]*\b(desiremovies|katmoviehd|kmhd|moviesbaba)[\w\-.]*\b|\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|x264|x265)\b/gi;
const RE_SEASON = /\b(S\d{2})\b/gi;
const RE_AUDIO_DOTS = /(5\.1|2\.0|7\.1|8\.1|2\.1)/g;
const RE_ALL_DOTS = /\./g;
const RE_DOT_PLACEHOLDER = /_DOT_/g;
const RE_NON_ALNUM = /[^a-zA-Z0-9\-.]/g;
const RE_MULTI_SPACE = /\s+/g;
const RE_TRAILING_PUNCT = /[-.]+$/;

function cleanFilename(filename) {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;
  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx);
  let epTag = "";

  base = base.replace(RE_TRAILING_DUP, "").replace(RE_BRACKETS, " ");
  base = base.replace(RE_EP_PREFIX, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    epTag = nums[0] === nums.at(-1) ? `EP${pad(nums[0])}` : `EP${pad(nums[0])}-${pad(nums.at(-1))}`;
    return "";
  });

  const clean = base
    .replace(RE_BRANDING, "")
    .replace(RE_SEASON, epTag ? `$1 ${epTag}` : "$1")
    .replace(RE_AUDIO_DOTS, (m) => m.replace(".", "_DOT_"))
    .replace(RE_ALL_DOTS, " ")
    .replace(RE_DOT_PLACEHOLDER, ".")
    .replace(RE_NON_ALNUM, " ")
    .replace(RE_MULTI_SPACE, " ")
    .trim()
    .replace(RE_TRAILING_PUNCT, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "4k") return "4K";
      if (lower === "web-dl" || lower === "webdl") return "WEB-DL";
      if (lower === "web-hdrip" || lower === "webhdrip") return "WEB-HDRip";
      if (lower === "bluray") return "BluRay";
      if (lower === "webrip") return "WEB-Rip";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  return clean + ext;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) { suggest(); return; }
  try {
    suggest({ filename: cleanFilename(item.filename) });
  } catch (e) {
    suggest();
  }
});
