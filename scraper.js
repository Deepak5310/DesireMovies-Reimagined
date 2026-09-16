import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i;

export async function scrapePost(postUrl) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20000);
  let html = "";
  try {
    const res = await fetch(postUrl, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching post`);
    html = await res.text();
  } finally {
    clearTimeout(tid);
  }

  const $ = cheerio.load(html);
  const host = new URL(postUrl).hostname;

  // Title
  const title = $("h1.entry-title, h1.post-title, h1").first().text().trim() || $("title").text().trim();

  // Poster Image
  let poster = $('meta[property="og:image"]').attr("content") ||
    $(".entry-content img, .post-body img, article img").first().attr("src") || "";
  if (poster && !poster.startsWith("http")) {
    try { poster = new URL(poster, postUrl).href; } catch {}
  }

  // Extract Clean Metadata
  let imdb = "", audio = "", genre = "", plot = "";
  $(".entry-content, .post-body, article").find("p, div").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ");
    if (!imdb && /imdb:\s*([0-9.]+\s*\/\s*10|[0-9.]+)/i.test(text)) imdb = text.match(/imdb:\s*([0-9.]+\s*\/\s*10|[0-9.]+)/i)[1];
    if (!audio && /language:\s*([^:\n]+?)(?=\s*(?:all genres?|genres?|quality|format|size|stars?|director|plot|imdb|\-:|$))/i.test(text)) {
      audio = text.match(/language:\s*([^:\n]+?)(?=\s*(?:all genres?|genres?|quality|format|size|stars?|director|plot|imdb|\-:|$))/i)[1].trim();
    }
    if (!genre && /(?:genres?|all genres?):\s*([^:\n]+?)(?=\s*(?:plot|storyline|director|stars?|language|quality|\-:|$))/i.test(text)) {
      genre = text.match(/(?:genres?|all genres?):\s*([^:\n]+?)(?=\s*(?:plot|storyline|director|stars?|language|quality|\-:|$))/i)[1].trim();
    }
    if (!plot && /(?:plot|storyline):\s*([^:\n]+?)(?=\s*(?:\-:|screenshots?|trailer|download|$))/i.test(text)) {
      plot = text.match(/(?:plot|storyline):\s*([^:\n]+?)(?=\s*(?:\-:|screenshots?|trailer|download|$))/i)[1].trim();
    }
  });

  const isSeries = /season|episode|episodes|s\d{1,2}|batch/i.test(title);

  // Parse download links with context awareness
  const groups = [];
  const seenUrls = new Set();
  let currentEpisode = "";
  let currentQuality = "";
  let currentSize = "";

  const container = $(".entry-content, .post-body, article").first();
  container.find("h2, h3, h4, p, div, a").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().trim().replace(/\s+/g, " ");

    if (tag === "a") {
      const href = $(el).attr("href")?.trim();
      if (!href || !href.startsWith("http") || seenUrls.has(href)) return;
      try { if (new URL(href).hostname === host) return; } catch { return; }

      if (RE_BYPASS.test(href) || /download|drive|hub|gdflix|watch|stream/i.test(text)) {
        seenUrls.add(href);

        let label = text;
        const qual = currentQuality || detectQuality(text) || "Direct Link";
        const sizeStr = currentSize ? ` [${currentSize}]` : "";

        if (isSeries) {
          const ep = currentEpisode || detectEpisode(text) || "";
          label = ep ? `${ep} • ${qual}${sizeStr}` : `${qual}${sizeStr}`;
        } else {
          label = `${qual}${sizeStr}`;
        }

        groups.push({
          label: label.trim(),
          quality: qual,
          episode: currentEpisode,
          size: currentSize,
          isPack: /pack|batch|zip/i.test(label),
          url: href,
        });
      }
      return;
    }

    // Context tracking for headings & paragraphs
    if (/(?:^|\s)(?:ep|episode|e)\s*\d+/i.test(text) || /ep\s*\d+\s*to\s*\d+/i.test(text) || /zip\s*pack|full\s*season/i.test(text)) {
      const epMatch = text.match(/(?:ep|episode|e)\s*\d+(?:\s*to\s*\d+)?/i) || text.match(/zip\s*pack|full\s*season/i);
      if (epMatch) currentEpisode = epMatch[0].toUpperCase();
    }

    const q = detectQuality(text);
    if (q) currentQuality = q;

    const sizeMatch = text.match(/\[?(\d+(?:\.\d+)?\s*(?:GB|MB))\]?/i);
    if (sizeMatch) currentSize = sizeMatch[1].toUpperCase();
  });

  return {
    url: postUrl,
    title,
    poster,
    meta: { imdb, audio, genre, plot },
    isSeries,
    groups,
  };
}

function detectQuality(str) {
  if (!str) return "";
  if (/2160p|4k/i.test(str)) return "4K 2160p";
  if (/1080p\s*hq/i.test(str)) return "1080p HQ";
  if (/1080p\s*hevc/i.test(str)) return "1080p HEVC";
  if (/1080p/i.test(str)) return "1080p FHD";
  if (/720p\s*hevc/i.test(str)) return "720p HEVC";
  if (/720p/i.test(str)) return "720p HD";
  if (/480p/i.test(str)) return "480p SD";
  return "";
}

function detectEpisode(str) {
  if (!str) return "";
  const m = str.match(/(?:ep|episode|e)\s*(\d{1,3})/i);
  return m ? `EP ${m[1].padStart(2, "0")}` : "";
}
