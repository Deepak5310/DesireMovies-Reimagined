import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export class PostTracker {
  constructor(siteUrl, storagePath = "data/seen.json") {
    this.siteUrl = siteUrl.replace(/\/+$/, "");
    this.storageFile = path.resolve(process.cwd(), storagePath);
    this.seenUrls = new Set();
  }

  async init() {
    try {
      await fs.mkdir(path.dirname(this.storageFile), { recursive: true });
      const raw = await fs.readFile(this.storageFile, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) this.seenUrls = new Set(list);
    } catch {
      this.seenUrls = new Set();
    }
  }

  async save() {
    try {
      const arr = Array.from(this.seenUrls).slice(-500); // keep last 500
      await fs.writeFile(this.storageFile, JSON.stringify(arr, null, 2));
    } catch (err) {
      console.error("[Tracker] Failed to save seen posts:", err.message);
    }
  }

  async fetchLatestPosts() {
    // 1. Try WordPress RSS Feed
    try {
      const feedRes = await fetch(`${this.siteUrl}/feed/`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (feedRes.ok) {
        const xml = await feedRes.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        const posts = [];
        $("item").each((_, item) => {
          const title = $(item).find("title").text().trim();
          const link = $(item).find("link").text().trim() || $(item).find("guid").text().trim();
          if (link) posts.push({ title, url: link });
        });
        if (posts.length > 0) return posts;
      }
    } catch {}

    // 2. Fallback: Parse Home Page
    try {
      const homeRes = await fetch(this.siteUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (!homeRes.ok) return [];
      const html = await homeRes.text();
      const $ = cheerio.load(html);
      const posts = [];
      const host = new URL(this.siteUrl).hostname;

      $("article, .post-item, .latest-post, .thumb").each((_, el) => {
        const a = $(el).find("a[href]").first();
        const href = a.attr("href");
        const title = a.attr("title") || a.text().trim() || $(el).find("h2, h3").text().trim();
        if (href && title) {
          try {
            const u = new URL(href, this.siteUrl);
            if (u.hostname === host && u.pathname.length > 2 && !/category|tag|page|author/i.test(u.pathname)) {
              posts.push({ title, url: u.href });
            }
          } catch {}
        }
      });
      return posts;
    } catch (err) {
      console.error("[Tracker] Failed to fetch homepage:", err.message);
      return [];
    }
  }

  async getNewPosts() {
    const latest = await this.fetchLatestPosts();
    if (!latest.length) return [];

    // On initial cold start without history, seed existing posts without spamming
    if (this.seenUrls.size === 0) {
      for (const p of latest) this.seenUrls.add(p.url);
      await this.save();
      console.log(`[Tracker] Initialized with ${latest.length} existing posts.`);
      return [];
    }

    const newPosts = [];
    for (const p of latest) {
      if (!this.seenUrls.has(p.url)) {
        this.seenUrls.add(p.url);
        newPosts.push(p);
      }
    }

    if (newPosts.length > 0) {
      await this.save();
    }
    return newPosts;
  }
}
