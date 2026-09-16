"use strict";

/**
 * Service Worker for DesireMovies Bypass & Stream (Manifest V3)
 * Concise, event-driven multi-hop link resolver & filename sanitizer.
 */

const bypassCache = new Map();
const activeBypasses = new Map();
const CACHE_TTL = 3 * 3600 * 1000; // 3 Hours

const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i;
const RE_STREAM = /href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers(?:\.dev)?|cloudflarestorage|pixeldrain)[^"']+)["']/i;
const RE_CLOUD = /href=["']([^"']*\/(?:cloud)\/[^"'\s]+)["']/i;
const RE_HUB = /href=["'](https?:\/\/[^"'\s]*(?:hubcloud|hubdrive)[^"'\s]*)['"]/i;
const RE_GDFLIX = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i;
const RE_GATEWAY = /href=["'](https?:\/\/[^"'\s]*(?:gamerxyt|sportverse|hubcloud\.php)[^"'\s]*)['"]/i;

// Cache restoration & session persistence
const ready = chrome.storage.session.get(["bypassCache"]).then(({ bypassCache: c }) => {
  if (c && typeof c === "object") {
    const now = Date.now();
    for (const [k, v] of Object.entries(c)) {
      if (v?.downloadUrl && now - (v.ts || 0) < CACHE_TTL) bypassCache.set(k, v);
    }
  }
}).catch(() => {});

function persistState() {
  chrome.storage.session.set({ bypassCache: Object.fromEntries(bypassCache) }).catch(() => {});
}

async function fetchHTML(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${new URL(url).hostname}`);
    return await res.text();
  } finally {
    clearTimeout(tid);
  }
}

async function fetchFinalUrl(url, ms = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return new URL(res.url).searchParams.get("url") || res.url;
  } finally {
    clearTimeout(tid);
  }
}

function isDirectMedia(url) {
  if (!url || typeof url !== "string") return false;
  if (/workers\.dev|cloudflarestorage|googleusercontent\.com|pixeldrain\.com\/api\/file\//i.test(url)) return true;
  if (/[?&]bytes=\d+/i.test(url)) return true;
  try {
    const { pathname } = new URL(url);
    return /\.(?:mkv|mp4|avi|webm|mov|m4v)(?:\?|$)/i.test(pathname) && !/(?:goflix|gdflix|mirror|view|drive)/i.test(pathname);
  } catch {
    return false;
  }
}

async function resolveCloudWorker(html, baseUrl) {
  const match = html.match(RE_CLOUD);
  if (!match) return null;
  try {
    const cloudUrl = match[1].startsWith("http") ? match[1] : `${new URL(baseUrl).origin}${match[1]}`;
    const pageHtml = await fetchHTML(cloudUrl);
    return pageHtml.match(RE_STREAM)?.[1] || null;
  } catch {
    return null;
  }
}

async function resolveGDFlix(html, pageUrl, onProgress) {
  onProgress?.("⏳ Searching GDFlix stream…");
  let direct = (await resolveCloudWorker(html, pageUrl)) || html.match(RE_STREAM)?.[1];
  if (!direct) throw new Error("Stream link not found on GDFlix");

  onProgress?.("⏳ Preparing direct stream URL…");
  let finalUrl = await fetchFinalUrl(direct.replace(/&amp;/g, "&"));

  for (let hop = 0; hop < 3 && !isDirectMedia(finalUrl); hop++) {
    if (!/goflix|gdflix|mirror|\/file\/|\/view\//i.test(finalUrl)) break;
    onProgress?.(`⏳ Resolving mirror (${new URL(finalUrl).hostname})…`);
    try {
      const page = await fetchHTML(finalUrl);
      const stream = (await resolveCloudWorker(page, finalUrl)) || page.match(RE_STREAM)?.[1];
      if (stream) finalUrl = await fetchFinalUrl(stream.replace(/&amp;/g, "&"));
      else break;
    } catch {
      break;
    }
  }

  if (/googleusercontent\.com/i.test(finalUrl) && !direct.includes("workers.dev")) {
    const worker = await resolveCloudWorker(html, pageUrl);
    if (worker) {
      try { finalUrl = await fetchFinalUrl(worker.replace(/&amp;/g, "&")); } catch {}
    }
  }
  return encodeURI(finalUrl);
}

async function resolveHubCloud(hubUrl, onProgress) {
  onProgress?.("⏳ Connecting to HubCloud…");
  let current = hubUrl;
  if (/hubdrive/i.test(current)) {
    try {
      const driveHtml = await fetchHTML(current);
      const m = driveHtml.match(RE_HUB);
      if (m) current = m[1];
    } catch {}
  }
  const html = await fetchHTML(current);
  const direct = html.match(RE_STREAM);
  if (direct) return direct[1];

  const gateway = html.match(RE_GATEWAY);
  if (gateway) {
    onProgress?.("⏳ Resolving gateway link…");
    const gHtml = await fetchHTML(gateway[1]);
    return gHtml.match(RE_STREAM)?.[1] || null;
  }
  return null;
}

async function resolveFullChain(url, onProgress) {
  await ready;
  const cached = bypassCache.get(url);
  if (cached && Date.now() - (cached.ts || 0) < CACHE_TTL) return { success: true, downloadUrl: cached.downloadUrl };

  let finalUrl = "";
  if (/kmhd/i.test(url)) {
    const fileId = url.match(/\/file\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!fileId) throw new Error("Invalid KMHD link");
    const origin = new URL(url).origin;

    try {
      onProgress?.("⏳ Checking KMHD GDFlix…");
      const res = await fetch(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (data?.linkId) {
        const html = await fetchHTML(data.linkId);
        finalUrl = await resolveGDFlix(html, data.linkId, onProgress);
      }
    } catch {}

    if (!finalUrl) {
      onProgress?.("⏳ Trying HubDrive fallback…");
      const res = await fetch(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (!data?.linkId) throw new Error("KMHD link resolution failed");
      finalUrl = await resolveHubCloud(data.linkId, onProgress);
    }
  } else if (/hubcloud|hubdrive|gamerxyt|sportverse/i.test(url)) {
    finalUrl = await resolveHubCloud(url, onProgress);
  } else if (/gdflix|goflix/i.test(url)) {
    onProgress?.("⏳ Connecting to GDFlix…");
    finalUrl = await resolveGDFlix(await fetchHTML(url), url, onProgress);
  } else {
    onProgress?.("⏳ Connecting to Gyanigurus…");
    let html = await fetchHTML(url);
    if (html.includes("<input")) {
      const body = new URLSearchParams();
      for (const m of html.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) {
        body.append(m[1], m[2]);
      }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      html = await res.text();
    }
    const hub = html.match(RE_HUB);
    if (hub) {
      try { finalUrl = await resolveHubCloud(hub[1], onProgress); } catch {}
    }
    if (!finalUrl) {
      const gd = html.match(RE_GDFLIX);
      if (gd) finalUrl = await resolveGDFlix(await fetchHTML(gd[1]), gd[1], onProgress);
    }
  }

  if (!finalUrl) throw new Error("Could not resolve final download URL");
  bypassCache.set(url, { downloadUrl: finalUrl, ts: Date.now() });
  persistState();
  return { success: true, downloadUrl: finalUrl };
}

async function resolvePackChain(packUrl, providedFileUrls = [], onProgress) {
  await ready;
  const origin = new URL(packUrl).origin;
  let fileUrls = providedFileUrls.length ? providedFileUrls : [];

  if (!fileUrls.length) {
    const packId = packUrl.match(/\/pack\/([a-zA-Z0-9_-]+)/)?.[1];
    if (packId) {
      try {
        const res = await fetch(`https://api.dandndn.one/api/v1/pack/${packId}`);
        if (res.ok) {
          const ids = Object.keys((await res.json())?.info || {});
          if (ids.length) fileUrls = ids.map((id) => `${origin}/file/${id}`);
        }
      } catch {}
    }
  }
  if (!fileUrls.length) {
    try {
      const html = await fetchHTML(packUrl);
      fileUrls = [...new Set([...html.matchAll(/href=["']([^"']*\/(?:file)\/[a-zA-Z0-9_-]+)["']/gi)].map((m) => (m[1].startsWith("http") ? m[1] : `${origin}${m[1]}`)))];
    } catch {}
  }
  if (!fileUrls.length) throw new Error("No episodes found in pack");

  let count = 0;
  const queue = [...fileUrls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      onProgress?.(`⏳ Episode (${count + 1}/${fileUrls.length})…`);
      try {
        const res = await resolveFullChain(u);
        if (res?.downloadUrl) {
          chrome.downloads.download({ url: res.downloadUrl });
          count++;
        }
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, fileUrls.length) }, worker));
  return { success: count > 0, count, total: fileUrls.length };
}

function sendProgress(tabId, url, statusText) {
  if (tabId) chrome.tabs.sendMessage(tabId, { action: "bypass_progress", url, statusText }).catch(() => {});
}

function handleBypassRequest(url, tabId, isStream, sendResponse) {
  if (!url || !RE_BYPASS.test(url)) {
    sendResponse({ success: false, error: "Invalid or unsupported URL" });
    return;
  }
  let promise = activeBypasses.get(url);
  if (!promise) {
    promise = resolveFullChain(url, (msg) => sendProgress(tabId, url, msg));
    activeBypasses.set(url, promise);
    promise.finally(() => activeBypasses.delete(url));
  }
  promise
    .then((res) => {
      sendProgress(tabId, url, isStream ? "✅ Stream ready" : "✅ Download started");
      if (isStream) sendResponse({ success: true, streamUrl: res.downloadUrl });
      else {
        chrome.downloads.download({ url: res.downloadUrl });
        sendResponse({ success: true });
      }
    })
    .catch((err) => {
      sendProgress(tabId, url, `❌ ${err.message}`);
      sendResponse({ success: false, error: err.message });
    });
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const tabId = sender?.tab?.id;
  const { action, payload } = req || {};
  if (action === "resolve_stream") {
    handleBypassRequest(payload?.url, tabId, true, sendResponse);
    return true;
  }
  if (action === "full_bypass") {
    handleBypassRequest(payload?.url, tabId, false, sendResponse);
    return true;
  }
  if (action === "bypass_pack") {
    resolvePackChain(payload?.url, payload?.fileUrls, (m) => sendProgress(tabId, payload?.url, m))
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  return false;
});

// Filename Cleaner
const WORD_MAP = { "4k": "4K", "web-dl": "WEB-DL", "webdl": "WEB-DL", "web-hdrip": "WEB-HDRip", "bluray": "BluRay", "webrip": "WEB-Rip", "uhd": "UHD" };

function cleanFilename(filename) {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1) return filename;
  const ext = filename.slice(dotIdx);
  let base = filename.slice(0, dotIdx).replace(/\s*\(\d+\)$/, "").replace(/[\[\]\(\)\{\}]/g, " ");
  let epTag = "";

  base = base.replace(/^EP((\.\d+)+)\./i, (_, grp) => {
    const nums = grp.split(".").filter(Boolean).map((n) => String(n).padStart(2, "0"));
    epTag = nums[0] === nums.at(-1) ? `EP${nums[0]}` : `EP${nums[0]}-${nums.at(-1)}`;
    return "";
  });

  const clean = base
    .replace(/(?:www\.)?(?:desiremovies|katmoviehd|katdrama|kmhd|moviesbaba)(?:\.[a-z]{2,8})?/gi, "")
    .replace(/\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|msubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|kor|x264|x265)\b/gi, "")
    .replace(/\bS(\d{2})(?:[.\-_]?(?:E|EP)?(\d{1,3})(?:-(?:E|EP)?(\d{1,3}))?)?\b/gi, (_, s, e1, e2) => {
      if (!e1) return epTag ? `S${s} ${epTag}` : `S${s}`;
      const p1 = String(e1).padStart(2, "0");
      return e2 ? `S${s} EP${p1}-${String(e2).padStart(2, "0")}` : `S${s} EP${p1}`;
    })
    .replace(/\b(5\.1|2\.0|7\.1|8\.1|2\.1)\b/g, (m) => m.replace(".", "_DOT_"))
    .replace(/\./g, " ")
    .replace(/_DOT_/g, ".")
    .replace(/[^a-zA-Z0-9\-.]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s_]+|[-.\s_]+$/g, "")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => WORD_MAP[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

  return clean + ext;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === chrome.runtime.id) {
    try { suggest({ filename: cleanFilename(item.filename), conflictAction: "uniquify" }); return; } catch {}
  }
  suggest();
});
