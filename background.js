"use strict";

// Service Worker — DesireMovies Bypass & Stream (MV3)

const bypassCache = new Map();
const activeBypasses = new Map();
const CACHE_TTL = 3 * 3600 * 1000; // 3 Hours

const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse|multicloudlinks)/i;
const RE_STREAM = /href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers(?:\.dev)?|cloudflarestorage|pixeldrain)[^"']+)["']/i;
const RE_CLOUD = /href=["']([^"']*\/(?:cloud)\/[^"'\s]+)["']/i;
const RE_HUB = /href=["'](https?:\/\/[^"'\s]*(?:hubcloud|hubdrive)[^"'\s]*)['\"]/i;
const RE_GDFLIX = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['\"]/i;
const RE_GATEWAY = /href=["'](https?:\/\/[^"'\s]*(?:gamerxyt|sportverse|hubcloud\.php)[^"'\s]*)['\"]/i;

// Cache restoration & session persistence
const ready = chrome.storage.session.get(["bypassCache"]).then(({ bypassCache: c }) => {
  if (c && typeof c === "object") {
    const now = Date.now();
    for (const [k, v] of Object.entries(c)) {
      if (/^[sd]:/.test(k) && (v?.downloadUrl || v?.streamUrl) && now - (v.ts || 0) < CACHE_TTL) {
        if (!v?.downloadUrl?.includes("dl.php")) bypassCache.set(k, v);
      }
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
    const target = new URL(res.url);
    const link = target.searchParams.get("link") || target.searchParams.get("url");
    if (link && link.startsWith("http")) return link;
    return res.url;
  } finally {
    clearTimeout(tid);
  }
}

function isDirectMedia(url) {
  if (!url || typeof url !== "string") return false;
  if (/workers\.dev|cloudflarestorage|googleusercontent\.com|pixeldrain\.(?:com|dev|org)\/api\/file\/|gpdl/i.test(url)) return true;
  if (/[?&]bytes=\d+/i.test(url)) return true;
  try {
    const { pathname } = new URL(url);
    return /\.(?:mkv|mp4|avi|webm|mov|m4v)(?:\?|$)/i.test(pathname) && !/(?:goflix|gdflix|mirror|view|drive)/i.test(pathname);
  } catch {
    return false;
  }
}

async function extractGatewayUrls(html, isStream = false) {
  let streamUrl = null, downloadUrl = null, hbplayUrl = null;

  // 1. Pixeldrain / PixelServer for in-page player (supports resume & range requests)
  const pxlVar = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);
  if (pxlVar && !pxlVar[1].includes("negn6f")) streamUrl = pxlVar[1].trim();
  if (!streamUrl) {
    const pxlHref = html.match(/href=["'](https?:\/\/[^"'\s]*pixeldrain\.[^"'\s]+)["']/i);
    if (pxlHref && !pxlHref[1].includes("negn6f")) streamUrl = pxlHref[1].trim();
  }
  if (streamUrl) streamUrl = streamUrl.replace(/\/u\/([a-zA-Z0-9_-]+)/, "/api/file/$1");

  // Web Player URL (hbplay)
  const hbMatch = html.match(/href=["'](https?:\/\/[^"'\s]*hbplay\.pages\.dev[^"'\s]*)["']/i);
  if (hbMatch) hbplayUrl = hbMatch[1].replace(/&amp;/g, "&");

  // Fallback stream: hbplay (base64 R2 URL) or direct Cloudflare R2
  if (!streamUrl && hbplayUrl) {
    const uParam = new URL(hbplayUrl).searchParams.get("u");
    if (uParam) {
      try { streamUrl = atob(uParam); } catch {}
    }
  }
  if (!streamUrl) {
    const r2 = html.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|r2\.cloudflarestorage\.com)[^"'\s]*)["']/i);
    if (r2) streamUrl = r2[1].replace(/&amp;/g, "&");
  }

  // If resolving for streaming, return immediately without waiting for slow 10Gbps redirect
  if (isStream && streamUrl) {
    return { streamUrl, hbplayUrl };
  }

  // 2. Server 10Gbps (Google Video stream via GPDL redirect)
  const dl10g = html.match(/href=["'](https?:\/\/[^"'\s]*(?:gpdl)[^"'\s]*)["']/i) ||
                html.match(/href=["'](https?:\/\/[^"'\s]+)["'][^>]*>(?:(?!<\/a>)[\s\S])*10Gbps/i);
  if (dl10g) {
    try {
      const final10g = await fetchFinalUrl(dl10g[1].replace(/&amp;/g, "&"), 20000);
      if (final10g) {
        if (final10g.includes("dl.php")) {
          const unwrapped = new URL(final10g).searchParams.get("link");
          if (unwrapped && unwrapped.startsWith("http")) downloadUrl = unwrapped;
        } else {
          downloadUrl = final10g;
        }
      }
    } catch {}
  }

  // Fallback download servers: FSL (Cloudflare R2) or PixelDrain (never let dl.php slip through)
  if (!downloadUrl) {
    const r2 = html.match(/href=["'](https?:\/\/[^"'\s]*(?:cloudflarestorage|r2\.cloudflarestorage\.com)[^"'\s]*)["']/i);
    if (r2) downloadUrl = r2[1].replace(/&amp;/g, "&");
  }
  if (!downloadUrl) downloadUrl = streamUrl;

  return streamUrl || downloadUrl ? { streamUrl, downloadUrl, hbplayUrl } : null;
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
  const u = encodeURI(finalUrl);
  return { streamUrl: u, downloadUrl: u };
}

async function resolveHubCloud(hubUrl, onProgress, isStream = false) {
  onProgress?.("⏳ Connecting to HubCloud…");
  let current = hubUrl;
  if (/hubdrive/i.test(current)) {
    try {
      const driveHtml = await fetchHTML(current);
      const m = driveHtml.match(/href=["'](https?:\/\/[^"'\s]*hubcloud\.[^"'\s]*\/drive\/[^"'\s]+)["']/i) ||
                driveHtml.match(/href=["'](https?:\/\/[^"'\s]*hubcloud\.[^"'\s]*)["']/i);
      if (m) current = m[1];
    } catch {}
  }
  const html = await fetchHTML(current);
  const direct = html.match(RE_STREAM);
  if (direct) {
    const u = direct[1].replace(/\/u\/([a-zA-Z0-9_-]+)/, "/api/file/$1");
    return { streamUrl: u, downloadUrl: u };
  }

  const gateway = html.match(/href=["'](https?:\/\/[^"'\s]*(?:gamerxyt|sportverse|hubcloud\.php)[^"'\s]*)['\"]/i) ||
                  html.match(/<a[^>]+id=["']download["'][^>]*href=["']([^"']+)["']/i) ||
                  html.match(/href=["'](https?:\/\/[^"'\s]+)["'][^>]*>(?:(?!<\/a>)[\s\S])*Generate Direct Download Link/i);
  if (gateway) {
    onProgress?.("⏳ Resolving gateway link…");
    const gHtml = await fetchHTML(gateway[1]);
    return await extractGatewayUrls(gHtml, isStream);
  }
  return null;
}

async function resolveFullChain(url, onProgress, isStream = false) {
  await ready;
  const cacheKey = `${isStream ? "s" : "d"}:${url}`;
  const cached = bypassCache.get(cacheKey);
  if (cached && Date.now() - (cached.ts || 0) < CACHE_TTL) {
    if (isStream && cached.streamUrl) return { success: true, ...cached };
    if (!isStream && cached.downloadUrl) return { success: true, ...cached };
  }

  let final = null;
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
        final = await resolveGDFlix(html, data.linkId, onProgress);
      }
    } catch {}

    if (!final) {
      onProgress?.("⏳ Trying HubDrive fallback…");
      const res = await fetch(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (!data?.linkId) throw new Error("KMHD link resolution failed");
      final = await resolveHubCloud(data.linkId, onProgress, isStream);
    }
  } else if (/hubcloud|hubdrive|gamerxyt|sportverse/i.test(url)) {
    final = await resolveHubCloud(url, onProgress, isStream);
  } else if (/gdflix|goflix/i.test(url)) {
    onProgress?.("⏳ Connecting to GDFlix…");
    final = await resolveGDFlix(await fetchHTML(url), url, onProgress);
  } else {
    onProgress?.("⏳ Connecting to Gyanigurus…");
    let html = await fetchHTML(url);
    if (html.includes("<input")) {
      const body = new URLSearchParams();
      for (const tag of html.matchAll(/<input[^>]+>/gi)) {
        const name = tag[0].match(/name=["']([^"']+)["']/i)?.[1];
        const val = tag[0].match(/value=["']([^"']*)["']/i)?.[1] ?? "";
        if (name) body.append(name, val);
      }
      if (Array.from(body.keys()).length) {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        html = await res.text();
      }
    }
    const hub = html.match(/href=["'](https?:\/\/[^"'\s]*(?:hubcloud\.[^"'\s]*\/drive\/[^"'\s]+))["']/i) ||
                html.match(/href=["'](https?:\/\/[^"'\s]*(?:hubcloud|hubdrive)[^"'\s]*)['\"]/i);
    if (hub) {
      try { final = await resolveHubCloud(hub[1], onProgress, isStream); } catch {}
    }
    if (!final) {
      const gd = html.match(RE_GDFLIX);
      if (gd) final = await resolveGDFlix(await fetchHTML(gd[1]), gd[1], onProgress);
    }
  }

  if (isStream) {
    if (!final?.streamUrl) throw new Error("Could not resolve stream URL");
    const result = {
      streamUrl: final.streamUrl,
      hbplayUrl: final.hbplayUrl || null,
      ts: Date.now()
    };
    bypassCache.set(cacheKey, result);
    persistState();
    return { success: true, ...result };
  } else {
    if (!final?.downloadUrl) throw new Error("Could not resolve final download URL");
    let dl = final.downloadUrl;
    if (dl.includes("dl.php")) {
      const link = new URL(dl).searchParams.get("link");
      if (link && link.startsWith("http")) dl = link;
    }
    const result = {
      downloadUrl: dl,
      is10Gbps: /gpdl|googleusercontent|workers\.dev/i.test(dl),
      ts: Date.now()
    };
    bypassCache.set(cacheKey, result);
    persistState();
    return { success: true, ...result };
  }
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
        const dl = res?.downloadUrl || res?.streamUrl;
        if (dl) {
          chrome.downloads.download({ url: dl });
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
  const key = `${isStream ? "s" : "d"}:${url}`;
  let promise = activeBypasses.get(key);
  if (!promise) {
    promise = resolveFullChain(url, (msg) => sendProgress(tabId, url, msg), isStream);
    activeBypasses.set(key, promise);
    promise.finally(() => activeBypasses.delete(key));
  }
  promise
    .then((res) => {
      sendProgress(tabId, url, isStream ? "✅ Stream ready" : "✅ Download started");
      if (isStream) {
        sendResponse({ success: true, streamUrl: res.streamUrl, hbplayUrl: res.hbplayUrl });
      } else {
        chrome.downloads.download({ url: res.downloadUrl }, (id) => {
          if (chrome.runtime.lastError) console.warn("Download error:", chrome.runtime.lastError.message);
        });
        sendResponse({ success: true, is10Gbps: res.is10Gbps });
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
  let name = filename.replace(/\.(mkv|mp4|avi|webm|mov|m4v)\.zip$/i, ".$1");
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx === -1) return name;
  const ext = name.slice(dotIdx);
  let base = name.slice(0, dotIdx).replace(/\s*\(\d+\)$/, "").replace(/[\[\]\(\)\{\}]/g, " ");
  let epTag = "";

  base = base.replace(/^EP((\.d+)+)\./i, (_, grp) => {
    const nums = grp.split(".").filter(Boolean).map((n) => String(n).padStart(2, "0"));
    epTag = nums[0] === nums.at(-1) ? `EP${nums[0]}` : `EP${nums[0]}-${nums.at(-1)}`;
    return "";
  });

  const clean = base
    .replace(/(?:www\.)?(?:desiremovies|katmoviehd|katdrama|kmhd|moviesbaba)(?:\.[a-z]{2,8})?/gi, "")
    .replace(/\b(10bits?|hevc|hq|hd|dual[- ]?audio|esubs?|msubs?|multi[- ]?audio|hin[- ]?eng|eng[- ]?hin|hindi[- ]?english|english[- ]?hindi|kor|x264|x265)\b/gi, "")
    .replace(/\bS(\d{2})(?:[.\-_]?(?:E|EP)?(\d{1,3})(?:-(?:E|EP)?(\d{1,3}))?)?/gi, (_, s, e1, e2) => {
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
