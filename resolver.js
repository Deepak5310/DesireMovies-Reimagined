/**
 * Multi-hop headless resolver for DesireMovies & associated link gateways.
 * Resolves intermediate links (Gyanigurus, KMHD, GDFlix, HubCloud) to direct media URLs.
 */

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

const RE_STREAM = /href=["'](https?:\/\/[^"']*(?:busycdn|fastcdn|cloud-dl|workers(?:\.dev)?|cloudflarestorage|pixeldrain)[^"']+)["']/i;
const RE_CLOUD = /href=["']([^"']*\/(?:cloud)\/[^"'\s]+)["']/i;
const RE_HUB = /href=["'](https?:\/\/[^"'\s]*(?:hubcloud|hubdrive)[^"'\s]*)['"]/i;
const RE_GDFLIX = /href=["'](https?:\/\/[^"'\s]*gdflix[^"'\s]*)['"]/i;
const RE_GATEWAY = /href=["'](https?:\/\/[^"'\s]*(?:gamerxyt|sportverse|hubcloud\.php)[^"'\s]*)['"]/i;

export function sanitizeUrl(url) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/\.(mkv|mp4|avi|webm|mov|m4v)\.zip(\?|$)/i, ".$1$2");
}

function extractStreamUrl(html) {
  if (!html) return null;

  // 1. Check for real JS pxl variable (bypasses HubCloud negn6f anti-bot decoy)
  const pxlVar = html.match(/var\s+pxl\s*=\s*["'](https?:\/\/[^"']+)["']/i);
  if (pxlVar && !/negn6f/i.test(pxlVar[1])) {
    return pxlVar[1];
  }

  // 2. Check for direct CDN / worker streams
  const matches = [...html.matchAll(new RegExp(RE_STREAM.source, "gi"))]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .filter((u) => !/negn6f|sample|preview/i.test(u));

  if (!matches.length) return null;
  const nonZip = matches.find((u) => !/\.zip(?:\?|$)/i.test(u));
  return nonZip || matches[0];
}

async function fetchHTML(url, opts = {}, ms = 15000) {
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${new URL(url).hostname}`);
  return await res.text();
}

async function fetchFinalUrl(url, ms = 15000) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(ms) });
  const target = new URL(res.url).searchParams.get("url") || res.url;
  return sanitizeUrl(target);
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
    return extractStreamUrl(pageHtml);
  } catch {
    return null;
  }
}

async function resolveGDFlix(html, pageUrl) {
  let direct = (await resolveCloudWorker(html, pageUrl)) || extractStreamUrl(html);
  if (!direct) throw new Error("Stream link not found on GDFlix");

  let finalUrl = await fetchFinalUrl(direct.replace(/&amp;/g, "&"));
  for (let hop = 0; hop < 3 && !isDirectMedia(finalUrl); hop++) {
    if (!/goflix|gdflix|mirror|\/file\/|\/view\//i.test(finalUrl)) break;
    try {
      const page = await fetchHTML(finalUrl);
      const stream = (await resolveCloudWorker(page, finalUrl)) || extractStreamUrl(page);
      if (stream) finalUrl = await fetchFinalUrl(stream.replace(/&amp;/g, "&"));
      else break;
    } catch {
      break;
    }
  }
  return encodeURI(sanitizeUrl(finalUrl));
}

async function resolveHubCloud(hubUrl) {
  let current = hubUrl;
  if (/hubdrive/i.test(current)) {
    try {
      const driveHtml = await fetchHTML(current);
      const m = driveHtml.match(RE_HUB);
      if (m) current = m[1];
    } catch {}
  }
  const html = await fetchHTML(current);
  const direct = extractStreamUrl(html);
  if (direct) return sanitizeUrl(direct);

  const gateway = html.match(RE_GATEWAY);
  if (gateway) {
    const gHtml = await fetchHTML(gateway[1]);
    const gDirect = extractStreamUrl(gHtml);
    return gDirect ? sanitizeUrl(gDirect) : null;
  }
  return null;
}

export async function resolveBypass(url) {
  if (!url || typeof url !== "string") throw new Error("Invalid URL");
  let finalUrl = "";

  if (/kmhd/i.test(url)) {
    const fileId = url.match(/\/file\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!fileId) throw new Error("Invalid KMHD link");
    const origin = new URL(url).origin;

    try {
      const res = await fetch(`${origin}/api/touchme/${fileId}?c=gdflix_res`, { method: "POST", headers: HEADERS });
      const data = res.ok ? await res.json() : null;
      if (data?.linkId) {
        const html = await fetchHTML(data.linkId);
        finalUrl = await resolveGDFlix(html, data.linkId);
      }
    } catch {}

    if (!finalUrl) {
      const res = await fetch(`${origin}/api/touchme/${fileId}?c=hubdrive_res`, { method: "POST", headers: HEADERS });
      const data = res.ok ? await res.json() : null;
      if (!data?.linkId) throw new Error("KMHD link resolution failed");
      finalUrl = await resolveHubCloud(data.linkId);
    }
  } else if (/hubcloud|hubdrive|gamerxyt|sportverse/i.test(url)) {
    finalUrl = await resolveHubCloud(url);
  } else if (/gdflix|goflix/i.test(url)) {
    finalUrl = await resolveGDFlix(await fetchHTML(url), url);
  } else {
    let html = await fetchHTML(url);
    if (html.includes("<input")) {
      const body = new URLSearchParams();
      for (const m of html.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) {
        body.append(m[1], m[2]);
      }
      const res = await fetch(url, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body });
      html = await res.text();
    }
    const hub = html.match(RE_HUB);
    if (hub) {
      try { finalUrl = await resolveHubCloud(hub[1]); } catch {}
    }
    if (!finalUrl) {
      const gd = html.match(RE_GDFLIX);
      if (gd) {
        try { finalUrl = await resolveGDFlix(await fetchHTML(gd[1]), gd[1]); } catch {}
      }
    }
    if (!finalUrl) {
      const pxl = html.match(/href=["'](https?:\/\/(?:pixeldrain\.com|pixeldrain\.dev)\/u\/[a-zA-Z0-9_-]+)["']/i);
      if (pxl && !/negn6f/i.test(pxl[1])) finalUrl = pxl[1];
    }
    if (!finalUrl) {
      const gof = html.match(/href=["'](https?:\/\/gofile\.io\/d\/[a-zA-Z0-9_-]+)["']/i);
      if (gof) finalUrl = gof[1];
    }
    if (!finalUrl) {
      const ocf = html.match(/href=["'](https?:\/\/1cloudfile\.com\/[a-zA-Z0-9_-]+)["']/i);
      if (ocf) finalUrl = ocf[1];
    }
  }

  if (!finalUrl) throw new Error("Could not resolve final direct stream URL");
  return sanitizeUrl(finalUrl);
}
