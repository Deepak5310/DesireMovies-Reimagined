"use strict";

const activeBypasses = new Map();
const bypassCache = new Map();

// Domain Configuration
const DOMAINS = {
  GYANIGURUS: { re: /^https?:\/\/[^/]*gyanigurus/i, name: "gyanigurus" },
  DESIREMOVIES: { re: /^https?:\/\/[^/]*desiremovies/i, name: "desiremovies" },
  KATMOVIEHD: { re: /^https?:\/\/[^/]*(katmoviehd|katdrama)/i, name: "katmoviehd" },
  KMHD: { re: /^https?:\/\/[^/]*kmhd/i, name: "kmhd" },
  MOVIESBABA: { re: /^https?:\/\/[^/]*moviesbaba/i, name: "moviesbaba" },
  GDFLIX: { re: /^https?:\/\/[^/]*(gdflix|gd\.kmhd)/i, name: "gdflix" }
};

const PATTERNS = {
  GDFLIX_HREF: /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i,
  DIRECT_STREAM: /href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers|cloudflarestorage)[^"']+)["']/i,
  CLOUD_LINK: /href=["']([^"']*\/(?:cloud)\/\d+\/[a-zA-Z0-9_-]+)["']/i,
  SPORTVERSE: /href=["'](https?:\/\/[^"'\s]*sportverse\.[^"'\s]+)["']/i,
  FILE_LINK: /href=["']([^"']*\/(?:file)\/[a-zA-Z0-9_-]+)["']/gi,
  FILE_ID: /\/file\/([a-zA-Z0-9_-]+)/,
  PACK_ID: /\/pack\/([a-zA-Z0-9_-]+)/,
  HIDDEN_INPUT: /<input[^>]+type=["']?hidden["']?[^>]*>/gi,
  INPUT_NAME: /name=["']([^"']+)["']/i,
  INPUT_VALUE: /value=["']([^"']*)["']/i
};

const FILENAME_PATTERNS = {
  TRAILING_DUP: /\s*\(\d+\)$/,
  BRACKETS: /[\[\]\(\)\{\}]/g,
  EP_PREFIX: /^EP((\.\d+)+)\./i,
  BRANDING: /[-\s]*\b(desiremovies|katmoviehd|katdrama|kmhd|moviesbaba)[\w\-.]*\b|[-\s]*\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|msubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|kor|x264|x265)\b/gi,
  SEASON: /\b(S\d{2})\b/gi,
  AUDIO_DOTS: /(5\.1|2\.0|7\.1|8\.1|2\.1)/g,
  ALL_DOTS: /\./g,
  DOT_PLACEHOLDER: /_DOT_/g,
  NON_ALNUM: /[^a-zA-Z0-9\-.]/g,
  MULTI_SPACE: /\s+/g,
  TRAILING_PUNCT: /[-.]+$/
};

const WORD_MAP = {
  "4k": "4K",
  "web-dl": "WEB-DL",
  "webdl": "WEB-DL",
  "web-hdrip": "WEB-HDRip",
  "webhdrip": "WEB-HDRip",
  "bluray": "BluRay",
  "webrip": "WEB-Rip"
};

// State Persistence
const ready = (async () => {
  try {
    const { bypassCache: cached } = await chrome.storage.session.get("bypassCache");
    if (cached) Object.entries(cached).forEach(([k, v]) => bypassCache.set(k, v));
  } catch (e) {}
})();

const persistState = () => {
  chrome.storage.session.set({ bypassCache: Object.fromEntries(bypassCache) }).catch(() => {});
};

// Utilities
const fetchWithTimeout = async (url, options = {}, ms = 8000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
};

const fetchHTML = async (url) => {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${new URL(url).hostname}`);
  return res.text();
};

const normalizeUrl = (url, baseUrl) => {
  if (url.startsWith("http")) return url;
  const base = new URL(baseUrl);
  return url.startsWith("/") ? `${base.origin}${url}` : `${base.origin}/${url}`;
};

const extractMatch = (html, pattern) => html.match(pattern);

const isAllowedBypassUrl = (url) => Object.values(DOMAINS).some(({ re }) => re.test(url));

const sendProgress = (tabId, url, status) => {
  if (tabId) chrome.tabs.sendMessage(tabId, { action: "bypass_progress", url, status }).catch(() => {});
};

// Stream Extraction
const findDirectStream = (html) => extractMatch(html, PATTERNS.DIRECT_STREAM);

const extractGDFlixDownload = async (html, pageUrl, onProgress) => {
  onProgress?.("⏳ Searching GDFlix stream…");
  let match = findDirectStream(html);

  if (!match || !/\.(?:mkv|mp4|avi|webm)|bytes=/i.test(match[1])) {
    onProgress?.("⏳ Checking Cloudflare Worker endpoint…");
    const cloudMatch = extractMatch(html, PATTERNS.CLOUD_LINK);
    if (cloudMatch) {
      const cloudUrl = normalizeUrl(cloudMatch[1], pageUrl);
      const cloudHtml = await fetchHTML(cloudUrl);
      const dlMatch = findDirectStream(cloudHtml);
      if (dlMatch) match = dlMatch;
    }
  }

  if (!match) throw new Error("Direct video download link not found on GDFlix page");

  onProgress?.("⏳ Preparing direct stream URL…");
  const rawUrl = match[1].replace(/&amp;/g, "&");
  const redirectRes = await fetchWithTimeout(rawUrl);
  const finalUrl = new URL(redirectRes.url).searchParams.get("url") || redirectRes.url;
  return encodeURI(finalUrl);
};

const extractGDFlixSeekable = async (html, pageUrl, onProgress) => {
  const cloudMatch = extractMatch(html, PATTERNS.CLOUD_LINK);
  if (cloudMatch) {
    onProgress?.("⏳ Preparing seekable stream…");
    const cloudUrl = normalizeUrl(cloudMatch[1], pageUrl);
    const cloudRes = await fetchWithTimeout(cloudUrl);
    const cloudHtml = await cloudRes.text();
    const streamMatch = findDirectStream(cloudHtml);
    if (streamMatch) return encodeURI(streamMatch[1].replace(/&amp;/g, "&"));
  }

  onProgress?.("⏳ Seekable stream unavailable; using direct source…");
  return extractGDFlixDownload(html, pageUrl, onProgress);
};

const extractGDFlixSource = (html, pageUrl, onProgress, preferSeekable) =>
  preferSeekable ? extractGDFlixSeekable(html, pageUrl, onProgress) : extractGDFlixDownload(html, pageUrl, onProgress);

// KMHD Chain Resolution
const resolveKMHDGDFlix = async (origin, fileId, onProgress) => {
  try {
    onProgress?.("⏳ Checking KMHD GDFlix response…");
    const res = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data?.linkId) {
        onProgress?.("⏳ Fetching GDFlix page…");
        const html = await fetchHTML(data.linkId);
        return extractGDFlixSource(html, data.linkId, onProgress, true);
      }
    }
  } catch (e) {}
  return null;
};

const resolveKMHDHubDrive = async (origin, fileId, onProgress) => {
  onProgress?.("⏳ Trying HubDrive fallback…");
  const res = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on KMHD HubDrive API`);

  const data = await res.json();
  if (!data?.linkId) throw new Error("Download link not found in KMHD API response");

  onProgress?.("⏳ Fetching Sportverse direct link…");
  const hubUrl = data.linkId.replace(/hubcloud\.[a-z0-9.]+/i, "hubcloud.club");
  const hubHtml = await fetchHTML(hubUrl);
  const sportMatch = extractMatch(hubHtml, PATTERNS.SPORTVERSE);

  if (sportMatch) {
    const sportHtml = await fetchHTML(sportMatch[1]);
    const dlMatch = sportHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|busycdn|fastcdn|pixeldrain)[^"'\s]+)["']/i);
    if (dlMatch) return dlMatch[1];
  }

  throw new Error("Could not resolve HubDrive stream");
};

// Gyanigurus Form Submission
const submitGyanigurusForm = async (url, html) => {
  const body = new URLSearchParams();
  for (const m of html.matchAll(PATTERNS.HIDDEN_INPUT)) {
    const tag = m[0];
    const name = tag.match(PATTERNS.INPUT_NAME)?.[1];
    const value = tag.match(PATTERNS.INPUT_VALUE)?.[1] ?? "";
    if (name) body.append(name, value);
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on Gyanigurus POST`);
  return res.text();
};

// Main Chain Resolution
const resolveFullChain = async (url, onProgress, { preferSeekableStream = false } = {}) => {
  await ready;
  if (!preferSeekableStream && bypassCache.has(url)) {
    return { success: true, downloadUrl: bypassCache.get(url) };
  }

  let finalUrl = "";

  if (DOMAINS.KMHD.re.test(url)) {
    onProgress?.("⏳ Requesting KMHD API…");
    const fileId = url.match(PATTERNS.FILE_ID)?.[1];
    if (!fileId) throw new Error("Not a single file download link");
    const origin = new URL(url).origin;

    finalUrl = await resolveKMHDGDFlix(origin, fileId, onProgress) || await resolveKMHDHubDrive(origin, fileId, onProgress);
  } else if (DOMAINS.GDFLIX.re.test(url)) {
    onProgress?.("⏳ Connecting to GDFlix…");
    const html = await fetchHTML(url);
    finalUrl = await extractGDFlixSource(html, url, onProgress, preferSeekableStream);
  } else {
    onProgress?.("⏳ Connecting to Gyanigurus…");
    const html = await fetchHTML(url);
    let match = extractMatch(html, PATTERNS.GDFLIX_HREF);
    if (!match) {
      onProgress?.("⏳ Submitting Gyanigurus form…");
      const htmlPost = await submitGyanigurusForm(url, html);
      match = extractMatch(htmlPost, PATTERNS.GDFLIX_HREF);
    }
    if (!match) throw new Error("GDFlix link not found on Gyanigurus page");

    onProgress?.("⏳ Fetching GDFlix page…");
    const html2 = await fetchHTML(match[1]);
    finalUrl = await extractGDFlixSource(html2, match[1], onProgress, preferSeekableStream);
  }

  if (!finalUrl) throw new Error("Could not resolve final download URL");

  if (!preferSeekableStream) {
    bypassCache.set(url, finalUrl);
    persistState();
  }

  return { success: true, downloadUrl: finalUrl };
};

// Pack Resolution
const resolvePackChain = async (packUrl, providedFileUrls = [], onProgress) => {
  await ready;
  onProgress?.("⏳ Scanning episode links…");
  const origin = new URL(packUrl).origin;
  let fileUrls = Array.isArray(providedFileUrls) && providedFileUrls.length ? providedFileUrls : [];

  if (!fileUrls.length) {
    const packId = packUrl.match(PATTERNS.PACK_ID)?.[1];
    if (packId) {
      try {
        const res = await fetchWithTimeout(`https://api.dandndn.one/api/v1/pack/${packId}`);
        if (res.ok) {
          const data = await res.json();
          const ids = Object.keys(data?.info || {});
          if (ids.length) fileUrls = ids.map(id => `${origin}/file/${id}`);
        }
      } catch (e) {}
    }
  }

  if (!fileUrls.length) {
    try {
      const html = await fetchHTML(packUrl);
      const matches = [...html.matchAll(PATTERNS.FILE_LINK)];
      fileUrls = [...new Set(matches.map(m => normalizeUrl(m[1], packUrl)))];
    } catch (e) {}
  }

  if (!fileUrls.length) throw new Error("No episodes found in pack");

  let startedCount = 0;
  const total = fileUrls.length;
  for (let i = 0; i < total; i++) {
    onProgress?.(`⏳ Episode ${i + 1}/${total}: Resolving stream…`);
    try {
      const result = await resolveFullChain(fileUrls[i]);
      if (result?.downloadUrl) {
        chrome.downloads.download({ url: result.downloadUrl });
        startedCount++;
      }
    } catch (e) {}
  }

  return { success: startedCount > 0, count: startedCount, total };
};

// Content Script Injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url && Object.values(DOMAINS).some(({ re }) => re.test(tab.url))) {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  }
});

// Message Handler
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const { action, payload } = req;
  const { tab } = sender;
  const url = payload?.url;
  const tabId = tab?.id;

  if (!url && action !== "full_bypass" && action !== "resolve_stream" && action !== "bypass_pack") {
    sendResponse({ success: false, error: "Missing URL" });
    return false;
  }

  if ((action === "resolve_stream" || action === "full_bypass") && !isAllowedBypassUrl(url)) {
    sendResponse({ success: false, error: "URL not in bypass allowlist" });
    return false;
  }

  const getOrCreatePromise = (key, executor) => {
    let promise = activeBypasses.get(key);
    if (!promise) {
      promise = Promise.resolve().then(executor);
      activeBypasses.set(key, promise);
      promise.finally(() => activeBypasses.delete(key));
    }
    return promise;
  };

  if (action === "resolve_stream") {
    const bypassKey = `stream:${url}`;
    getOrCreatePromise(bypassKey, () => resolveFullChain(url, msg => sendProgress(tabId, url, msg), { preferSeekableStream: true }))
      .then(result => sendResponse({ success: true, streamUrl: result.downloadUrl }))
      .catch(err => {
        sendProgress(tabId, url, `❌ ${err.message}`);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (action === "bypass_pack") {
    resolvePackChain(url, payload?.fileUrls, msg => sendProgress(tabId, url, msg))
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === "full_bypass") {
    getOrCreatePromise(url, () => resolveFullChain(url, msg => sendProgress(tabId, url, msg)))
      .then(result => {
        sendProgress(tabId, url, "✅ Download started");
        chrome.downloads.download({ url: result.downloadUrl });
        sendResponse({ success: true });
      })
      .catch(err => {
        sendProgress(tabId, url, `❌ ${err.message}`);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  sendResponse({ success: false, error: `Unknown action: ${action}` });
  return false;
});

// Filename Cleaning
const cleanFilename = (filename) => {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;

  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx);
  let epTag = "";

  base = base.replace(FILENAME_PATTERNS.TRAILING_DUP, "").replace(FILENAME_PATTERNS.BRACKETS, " ");
  base = base.replace(FILENAME_PATTERNS.EP_PREFIX, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = n => String(n).padStart(2, "0");
    epTag = nums[0] === nums.at(-1) ? `EP${pad(nums[0])}` : `EP${pad(nums[0])}-${pad(nums.at(-1))}`;
    return "";
  });

  const clean = base
    .replace(FILENAME_PATTERNS.BRANDING, "")
    .replace(FILENAME_PATTERNS.SEASON, epTag ? `$1 ${epTag}` : "$1")
    .replace(FILENAME_PATTERNS.AUDIO_DOTS, m => m.replace(".", "_DOT_"))
    .replace(FILENAME_PATTERNS.ALL_DOTS, " ")
    .replace(FILENAME_PATTERNS.DOT_PLACEHOLDER, ".")
    .replace(FILENAME_PATTERNS.NON_ALNUM, " ")
    .replace(FILENAME_PATTERNS.MULTI_SPACE, " ")
    .trim()
    .replace(FILENAME_PATTERNS.TRAILING_PUNCT, "")
    .split(" ")
    .filter(Boolean)
    .map(w => WORD_MAP[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

  return clean + ext;
};

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }
  try {
    suggest({ filename: cleanFilename(item.filename) });
  } catch (e) {
    suggest();
  }
});