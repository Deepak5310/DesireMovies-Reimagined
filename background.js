"use strict";

const activeBypasses = new Map();
const bypassCache = new Map();

const GDFLIX_HREF_RE = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i;
const HUBCLOUD_HREF_RE = /href=["'](https?:\/\/[^"'\s]*(?:hubcloud|hubdrive)[^"'\s]*)['"]/i;
const RE_WORKER_STREAM = /href=["'](https?:\/\/[^"']*(?:cloud-dl|workers\.dev|cloudflarestorage|fastcdn)[^"']+)["']/i;
const RE_CLOUD_ENDPOINT = /href=["']([^"']*\/(?:cloud)\/[^"'\s]+)["']/i;
const RE_DIRECT_STREAM = /href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers|cloudflarestorage)[^"']+)["']/i;

const RE_KMHD = /^https?:\/\/[^/]*kmhd/i;
const RE_GDFLIX = /^https?:\/\/[^/]*(gdflix|goflix|gd\.kmhd)/i;
const RE_HUBCLOUD = /^https?:\/\/[^/]*(hubcloud|hubdrive|gamerxyt|sportverse)/i;
const RE_BYPASS_URL = /^https?:\/\/[^/]*(gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i;
const RE_INJECT_DOMAINS = /^https?:\/\/[^/]*(desiremovies|katmoviehd|katdrama|moviesbaba|kmhd|gdflix|goflix|hubcloud|hubdrive)/i;

const ready = (async () => {
  try {
    const { bypassCache: cached } = await chrome.storage.session.get(["bypassCache"]);
    if (cached) {
      for (const [k, v] of Object.entries(cached)) bypassCache.set(k, v);
    }
  } catch {}
})();

function persistState() {
  chrome.storage.session.set({ bypassCache: Object.fromEntries(bypassCache) }).catch(() => {});
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Request timed out (${ms / 1000}s) on ${new URL(url).hostname}`);
    throw err;
  } finally {
    clearTimeout(id);
  }
}

async function fetchHTML(url, options = {}, ms = 15000) {
  const res = await fetchWithTimeout(url, options, ms);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${new URL(url).hostname}`);
  return res.text();
}

function isDirectMediaUrl(url) {
  if (!url) return false;
  if (/workers\.dev|cloudflarestorage|googleusercontent\.com|pixeldrain\.com\/api\/file\//i.test(url)) return true;
  if (/[?&]bytes=\d+/i.test(url)) return true;
  return /\.(?:mkv|mp4|avi|webm|mov|m4v)(?:\?|$)/i.test(url) && !/(?:goflix|gdflix|mirror|view|drive)/i.test(new URL(url).pathname);
}

async function resolveIntermediateMediaUrl(targetUrl, onProgress, maxHops = 3) {
  let currentUrl = targetUrl;
  for (let hop = 0; hop < maxHops; hop++) {
    if (isDirectMediaUrl(currentUrl)) return currentUrl;
    if (/goflix\.|gdflix\.|(?:en\/)?mirror\/|\/file\/|\/view\//i.test(currentUrl)) {
      onProgress?.(`⏳ Resolving GoFlix mirror page (${new URL(currentUrl).hostname})…`);
      try {
        const pageHtml = await fetchHTML(currentUrl);
        let streamMatch = pageHtml.match(RE_WORKER_STREAM);
        if (!streamMatch) {
          const cloudMatch = pageHtml.match(RE_CLOUD_ENDPOINT);
          if (cloudMatch) {
            const cloudUrl = cloudMatch[1].startsWith("http") ? cloudMatch[1] : `${new URL(currentUrl).origin}${cloudMatch[1]}`;
            const cloudHtml = await fetchHTML(cloudUrl);
            streamMatch = cloudHtml.match(RE_WORKER_STREAM) || cloudHtml.match(RE_DIRECT_STREAM);
          }
        }
        if (!streamMatch) streamMatch = pageHtml.match(RE_DIRECT_STREAM);
        if (streamMatch) {
          const redirectRes = await fetchWithTimeout(streamMatch[1].replace(/&amp;/g, "&"));
          currentUrl = new URL(redirectRes.url).searchParams.get("url") || redirectRes.url;
          continue;
        }
      } catch {}
    }
    break;
  }
  return currentUrl;
}

async function extractDownloadFromGDFlixHTML(html, pageUrl, onProgress) {
  onProgress?.("⏳ Searching GDFlix stream…");
  let directUrl = "";
  const cloudMatch = html.match(RE_CLOUD_ENDPOINT);

  if (cloudMatch) {
    try {
      onProgress?.("⏳ Connecting to Cloudflare Worker endpoint…");
      const cloudUrl = cloudMatch[1].startsWith("http") ? cloudMatch[1] : `${new URL(pageUrl).origin}${cloudMatch[1]}`;
      const cloudHtml = await fetchHTML(cloudUrl);
      const workerMatch = cloudHtml.match(RE_WORKER_STREAM) || cloudHtml.match(RE_DIRECT_STREAM);
      if (workerMatch) directUrl = workerMatch[1];
    } catch {}
  }

  if (!directUrl) {
    const match = html.match(RE_WORKER_STREAM) || html.match(RE_DIRECT_STREAM);
    if (match) directUrl = match[1];
  }

  if (!directUrl) throw new Error("Direct video download link not found on GDFlix page");

  onProgress?.("⏳ Preparing direct stream URL…");
  const redirectRes = await fetchWithTimeout(directUrl.replace(/&amp;/g, "&"));
  let finalUrl = new URL(redirectRes.url).searchParams.get("url") || redirectRes.url;

  if (!isDirectMediaUrl(finalUrl)) {
    finalUrl = await resolveIntermediateMediaUrl(finalUrl, onProgress);
  }

  if (/googleusercontent\.com/i.test(finalUrl) && cloudMatch && !directUrl.includes("workers.dev")) {
    try {
      const cloudUrl = cloudMatch[1].startsWith("http") ? cloudMatch[1] : `${new URL(pageUrl).origin}${cloudMatch[1]}`;
      const cloudHtml = await fetchHTML(cloudUrl);
      const workerMatch = cloudHtml.match(RE_WORKER_STREAM) || cloudHtml.match(RE_DIRECT_STREAM);
      if (workerMatch) {
        const workerRes = await fetchWithTimeout(workerMatch[1].replace(/&amp;/g, "&"));
        finalUrl = new URL(workerRes.url).searchParams.get("url") || workerRes.url;
      }
    } catch {}
  }

  return encodeURI(finalUrl);
}

function sendProgress(tabId, targetUrl, statusText) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: "bypass_progress", url: targetUrl, statusText }).catch(() => {});
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url && RE_INJECT_DOMAINS.test(tab.url)) {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  }
});

async function submitGyanigurusForm(url, html1) {
  const body = new URLSearchParams();
  for (const m of html1.matchAll(/<input[^>]+>/gi)) {
    const tag = m[0];
    if (/type=["']?hidden["']?/i.test(tag)) {
      const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
      const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
      if (name) body.append(name, value);
    }
  }
  const res = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (!res.ok) throw new Error(`HTTP ${res.status} on Gyanigurus POST`);
  return res.text();
}

async function resolveHubCloudChain(hubUrl, onProgress) {
  onProgress?.("⏳ Connecting to HubCloud…");
  let currentUrl = hubUrl;
  if (/hubdrive\.[a-z0-9.]+/i.test(currentUrl)) {
    try {
      const driveHtml = await fetchHTML(currentUrl);
      const driveMatch = driveHtml.match(/href=["'](https?:\/\/[^"'\s]*hubcloud\.[^"'\s]*)['"]/i);
      if (driveMatch) currentUrl = driveMatch[1];
    } catch {}
  }

  const pageHtml = await fetchHTML(currentUrl);
  const directDl = pageHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|workers\.dev|pixeldrain)[^"'\s]+)["']/i);
  if (directDl) return directDl[1];

  const gatewayMatch = pageHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:gamerxyt|sportverse|hubcloud\.php)[^"'\s]*)['"]/i);
  if (gatewayMatch) {
    onProgress?.("⏳ Resolving gateway link…");
    const gatewayHtml = await fetchHTML(gatewayMatch[1]);
    const r2Match = gatewayHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|workers\.dev)[^"'\s]+)["']/i);
    if (r2Match) return r2Match[1];
    const fallbackMatch = gatewayHtml.match(/href=["'](https?:\/\/[^"'\s]*(?:pixeldrain|busycdn|fastcdn)[^"'\s]+)["']/i);
    if (fallbackMatch) return fallbackMatch[1];
  }
  return null;
}

const CACHE_TTL_MS = 3 * 3600 * 1000;

async function resolveFullChain(url, onProgress) {
  await ready;
  const cached = bypassCache.get(url);
  if (cached) {
    const dlUrl = typeof cached === "string" ? cached : cached.downloadUrl;
    const ts = typeof cached === "string" ? 0 : cached.ts;
    if (!ts || Date.now() - ts < CACHE_TTL_MS) return { success: true, downloadUrl: dlUrl };
    bypassCache.delete(url);
  }

  let finalUrl = "";
  if (RE_KMHD.test(url)) {
    onProgress?.("⏳ Requesting KMHD API…");
    const fileId = url.match(/\/file\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!fileId) throw new Error("Not a single file download link");
    const origin = new URL(url).origin;

    try {
      onProgress?.("⏳ Checking KMHD GDFlix response…");
      const touchRes = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST" });
      if (touchRes.ok) {
        const touchData = await touchRes.json();
        if (touchData?.linkId) {
          onProgress?.("⏳ Fetching GDFlix page…");
          const html2 = await fetchHTML(touchData.linkId);
          finalUrl = await extractDownloadFromGDFlixHTML(html2, touchData.linkId, onProgress);
        }
      }
    } catch {}

    if (!finalUrl) {
      onProgress?.("⏳ Trying HubDrive fallback…");
      const touchRes = await fetchWithTimeout(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST" });
      if (!touchRes.ok) throw new Error(`HTTP ${touchRes.status} on KMHD HubDrive API`);
      const touchData = await touchRes.json();
      if (!touchData?.linkId) throw new Error("Download link not found in KMHD API response");
      finalUrl = await resolveHubCloudChain(touchData.linkId, onProgress);
    }
  } else if (RE_HUBCLOUD.test(url)) {
    finalUrl = await resolveHubCloudChain(url, onProgress);
  } else if (RE_GDFLIX.test(url)) {
    onProgress?.("⏳ Connecting to GDFlix…");
    const html = await fetchHTML(url);
    finalUrl = await extractDownloadFromGDFlixHTML(html, url, onProgress);
  } else {
    onProgress?.("⏳ Connecting to Gyanigurus…");
    let html1 = await fetchHTML(url);
    if (html1.includes("<input")) {
      onProgress?.("⏳ Submitting Gyanigurus form…");
      html1 = await submitGyanigurusForm(url, html1);
    }

    const hubMatch = html1.match(HUBCLOUD_HREF_RE);
    if (hubMatch) {
      try { finalUrl = await resolveHubCloudChain(hubMatch[1], onProgress); } catch {}
    }
    if (!finalUrl) {
      const gdMatch = html1.match(GDFLIX_HREF_RE);
      if (gdMatch) {
        onProgress?.("⏳ Fetching GDFlix page…");
        const html2 = await fetchHTML(gdMatch[1]);
        finalUrl = await extractDownloadFromGDFlixHTML(html2, gdMatch[1], onProgress);
      }
    }
    if (!finalUrl && !hubMatch) throw new Error("Download mirrors not found on Gyanigurus page");
  }

  if (!finalUrl) throw new Error("Could not resolve final download URL");
  bypassCache.set(url, { downloadUrl: finalUrl, ts: Date.now() });
  persistState();
  return { success: true, downloadUrl: finalUrl };
}

async function resolvePackChain(packUrl, providedFileUrls = [], onProgress) {
  await ready;
  onProgress?.("⏳ Scanning episode links…");
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
          if (fileIds.length) fileUrls = fileIds.map((id) => `${origin}/file/${id}`);
        }
      } catch {}
    }
  }

  if (!fileUrls.length) {
    try {
      const html = await fetchHTML(packUrl);
      const matches = [...html.matchAll(/href=["']([^"']*\/(?:file)\/[a-zA-Z0-9_-]+)["']/gi)];
      fileUrls = [...new Set(matches.map((m) => (m[1].startsWith("http") ? m[1] : `${origin}${m[1]}`)))];
    } catch {}
  }

  if (!fileUrls.length) throw new Error("No episodes found in pack");

  let startedCount = 0;
  for (let i = 0; i < fileUrls.length; i++) {
    onProgress?.(`⏳ Episode ${i + 1}/${fileUrls.length}: Resolving stream…`);
    try {
      const result = await resolveFullChain(fileUrls[i]);
      if (result?.downloadUrl) {
        chrome.downloads.download({ url: result.downloadUrl });
        startedCount++;
      }
    } catch {}
  }

  return { success: startedCount > 0, count: startedCount, total: fileUrls.length };
}

function handleBypassRequest(url, tabId, isStream, sendResponse) {
  if (!url) { sendResponse({ success: false, error: "Missing URL" }); return; }
  if (!RE_BYPASS_URL.test(url)) { sendResponse({ success: false, error: "URL not in bypass allowlist" }); return; }

  const key = isStream ? `stream:${url}` : url;
  let promise = activeBypasses.get(key);
  if (!promise) {
    promise = ready.then(() => resolveFullChain(url, (msg) => sendProgress(tabId, url, msg)));
    activeBypasses.set(key, promise);
    promise.finally(() => activeBypasses.delete(key));
  }

  promise
    .then((result) => {
      sendProgress(tabId, url, isStream ? "✅ Stream ready" : "✅ Download started");
      if (isStream) sendResponse({ success: true, streamUrl: result.downloadUrl });
      else {
        chrome.downloads.download({ url: result.downloadUrl });
        sendResponse({ success: true });
      }
    })
    .catch((err) => {
      sendProgress(tabId, url, `❌ ${err.message}`);
      sendResponse({ success: false, error: err.message });
    });
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "resolve_stream") {
    handleBypassRequest(req.payload?.url, sender?.tab?.id, true, sendResponse);
    return true;
  }
  if (req.action === "full_bypass") {
    handleBypassRequest(req.payload?.url, sender?.tab?.id, false, sendResponse);
    return true;
  }
  if (req.action === "bypass_pack") {
    const { url, fileUrls } = req.payload || {};
    const tabId = sender?.tab?.id;
    if (!url) { sendResponse({ success: false, error: "Missing URL" }); return false; }
    resolvePackChain(url, fileUrls, (msg) => sendProgress(tabId, url, msg))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  sendResponse({ success: false, error: `Unknown action: ${req.action}` });
  return false;
});

const RE_TRAILING_DUP = /\s*\(\d+\)$/;
const RE_BRACKETS = /[\[\]\(\)\{\}]/g;
const RE_EP_PREFIX = /^EP((\.\d+)+)\./i;
const RE_SITE_BRAND = /\b(?:www\.)?(?:desiremovies|katmoviehd|katdrama|kmhd|moviesbaba)(?:\.(?:com|org|net|in|guru|fit|casa|cx|vip|lol|pro|tech|site|me|co|ws|cc|to|app|run|life|live|icu|top|art|xyz|pw))?\b/gi;
const RE_TAGS = /\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|msubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|kor|x264|x265)\b/gi;
const RE_SEASON_EP = /\bS(\d{2})(?:[.\-_]?(?:E|EP)?(\d{1,3})(?:-(?:E|EP)?(\d{1,3}))?)?\b/gi;
const RE_AUDIO_DOTS = /\b(5\.1|2\.0|7\.1|8\.1|2\.1)\b/g;
const RE_ALL_DOTS = /\./g;
const RE_DOT_PLACEHOLDER = /_DOT_/g;
const RE_NON_ALNUM = /[^a-zA-Z0-9\-.]/g;
const RE_MULTI_SPACE = /\s+/g;
const RE_TRAILING_PUNCT = /[-.]+$/;

const WORD_MAP = new Map([
  ["4k", "4K"], ["web-dl", "WEB-DL"], ["webdl", "WEB-DL"],
  ["web-hdrip", "WEB-HDRip"], ["webhdrip", "WEB-HDRip"],
  ["bluray", "BluRay"], ["webrip", "WEB-Rip"]
]);

function cleanFilename(filename) {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;
  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx).replace(RE_TRAILING_DUP, "").replace(RE_BRACKETS, " ");
  let epTag = "";

  base = base.replace(RE_EP_PREFIX, (_, group) => {
    const nums = group.split(".").filter(Boolean).map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    epTag = nums[0] === nums.at(-1) ? `EP${pad(nums[0])}` : `EP${pad(nums[0])}-${pad(nums.at(-1))}`;
    return "";
  });

  const clean = base
    .replace(RE_SITE_BRAND, "")
    .replace(RE_TAGS, "")
    .replace(RE_SEASON_EP, (_, s, ep1, ep2) => {
      if (!ep1) return epTag ? `S${s} ${epTag}` : `S${s}`;
      const p1 = String(ep1).padStart(2, "0");
      return ep2 ? `S${s} EP${p1}-${String(ep2).padStart(2, "0")}` : `S${s} EP${p1}`;
    })
    .replace(RE_AUDIO_DOTS, (m) => m.replace(".", "_DOT_"))
    .replace(RE_ALL_DOTS, " ")
    .replace(RE_DOT_PLACEHOLDER, ".")
    .replace(RE_NON_ALNUM, " ")
    .replace(RE_MULTI_SPACE, " ")
    .trim()
    .replace(RE_TRAILING_PUNCT, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => WORD_MAP.get(w.toLowerCase()) || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

  return clean + ext;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) { suggest(); return; }
  try {
    suggest({ filename: cleanFilename(item.filename) });
  } catch {
    suggest();
  }
});
