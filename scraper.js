import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const RE_BYPASS = /^https?:\/\/[^/]*(?:gyanigurus|kmhd|moviesbaba|gdflix|goflix|katmoviehd|katdrama|hubcloud|hubdrive|gamerxyt|sportverse)/i;
const RE_IMDB = /imdb:\s*([0-9.]+\s*\/\s*10|[0-9.]+)/i;
const RE_AUDIO = /language:\s*([^:\n]+?)(?=\s*(?:all genres?|genres?|quality|format|size|stars?|director|plot|imdb|\-:|$))/i;
const RE_GENRE = /(?:genres?|all genres?):\s*([^:\n]+?)(?=\s*(?:plot|storyline|director|stars?|language|quality|\-:|$))/i;
const RE_PLOT = /(?:plot|storyline):\s*([^:\n]+?)(?=\s*(?:\-:|screenshots?|trailer|download|$))/i;
const RE_SIZE = /\[?(\d+(?:\.\d+)?\s*(?:GB|MB))\]?/i;
const RE_EP_MATCH = /(?:ep|episode|e)\s*(\d{1,3})(?:\s*to\s*(\d{1,3}))?/i;

export function parseTitle(raw) {
  if (!raw) return { cleanName: "Unknown", year: "", season: "", displayTitle: "Unknown" };
  const title = raw.replace(/^Download\s+/i, "");
  const yearMatch = title.match(/\((19\d\d|20\d\d)\)/);
  const year = yearMatch ? yearMatch[1] : "";
  const seasonMatch = title.match(/\[?(?:Season|S)\s*(\d{1,2})\]?/i);
  const season = seasonMatch ? `Season ${seasonMatch[1]}` : "";

  const cleanName = title
    .replace(/\((?:19|20)\d\d\).*/i, "")
    .replace(/\[?(?:Season|S)\s*\d+\]?.*/i, "")
    .replace(/WEB-HDRip|WEB-DL|BluRay|HDTV|HDRip|x264|x265|HEVC|Dual Audio|Hindi|Esubs|ORG|DD\s*5\.1|480p|720p|1080p|4K|2160p/gi, "")
    .replace(/[\[\]\(\)\{\}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    cleanName: cleanName || title,
    year,
    season,
    displayTitle: year ? `${cleanName} (${year})` : cleanName,
  };
}

export async function scrapePost(postUrl) {
  const res = await fetch(postUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching post`);
  const html = await res.text();

  const $ = cheerio.load(html);
  const host = new URL(postUrl).hostname;
  const title = $("h1.entry-title, h1.post-title, h1").first().text().trim() || $("title").text().trim();

  let poster = $('meta[property="og:image"]').attr("content") ||
    $(".entry-content img, .post-body img, article img").first().attr("src") || "";
  if (poster && !poster.startsWith("http")) {
    try { poster = new URL(poster, postUrl).href; } catch {}
  }

  let imdb = "", audio = "", genre = "", plot = "";
  $(".entry-content, .post-body, article").find("p, div").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ");
    if (!imdb && RE_IMDB.test(text)) imdb = text.match(RE_IMDB)[1];
    if (!audio && RE_AUDIO.test(text)) audio = text.match(RE_AUDIO)[1].trim();
    if (!genre && RE_GENRE.test(text)) genre = text.match(RE_GENRE)[1].trim();
    if (!plot && RE_PLOT.test(text)) plot = text.match(RE_PLOT)[1].trim();
  });

  const isSeries = /season|episode|episodes|s\d{1,2}|batch/i.test(title);
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
        const qual = currentQuality || detectQuality(text) || "Download";
        const ep = isSeries ? (currentEpisode || detectEpisode(text) || "") : "";
        const label = formatButtonLabel(ep, qual, currentSize);

        groups.push({
          label: label.trim(),
          quality: qual,
          episode: ep,
          size: currentSize,
          isPack: /pack|batch|zip/i.test(label),
          url: href,
        });
      }
      return;
    }

    if (RE_EP_MATCH.test(text) || /zip\s*pack|full\s*season/i.test(text)) {
      const epMatch = text.match(/(?:ep|episode|e)\s*\d+(?:\s*to\s*\d+)?/i) || text.match(/zip\s*pack|full\s*season/i);
      if (epMatch) currentEpisode = epMatch[0].toUpperCase().replace(/\s*TO\s*/i, "-");
    }

    const q = detectQuality(text);
    if (q) currentQuality = q;

    const sizeMatch = text.match(RE_SIZE);
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

function formatButtonLabel(episode, quality, size) {
  const ep = episode ? episode.replace(/\s*TO\s*/i, "-").replace(/^EPISODE\s*/i, "EP ").replace(/^EP\s*0?(\d+)/i, "EP $1") : "";
  const qual = quality || "Download";
  const sz = size ? ` (${size.replace(/\s+/g, "")})` : "";
  return ep ? `${ep} • ${qual}${sz}` : `${qual}${sz}`;
}

function detectQuality(str) {
  if (!str) return "";
  if (/2160p|4k/i.test(str)) return "4K 2160p";
  if (/1080p\s*hq/i.test(str)) return "1080p HQ";
  if (/1080p\s*hevc/i.test(str)) return "1080p HEVC";
  if (/1080p/i.test(str)) return "1080p";
  if (/720p\s*hevc/i.test(str)) return "720p HEVC";
  if (/720p/i.test(str)) return "720p";
  if (/480p/i.test(str)) return "480p";
  return "";
}

function detectEpisode(str) {
  if (!str) return "";
  const m = str.match(/(?:ep|episode|e)\s*(\d{1,3})/i);
  return m ? `EP ${m[1]}` : "";
}
