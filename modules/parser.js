/**
 * parser.js — DOM Extraction & Title Parsing Engine
 *
 * Extracts structured movie/show data from the raw WordPress DOM.
 * The site uses MH Magazine Lite theme — selectors are based on
 * actual DOM analysis of the homepage HTML.
 */

window.DMParser = (() => {

  /* ── Page Type Detection ─────────────────────────────────── */
  function detectPageType() {
    const body = document.body;
    if (body.classList.contains('home') || body.classList.contains('blog')) return 'home';
    if (body.classList.contains('category')) return 'category';
    if (body.classList.contains('search-results')) return 'search';
    if (body.classList.contains('single-post') || body.classList.contains('single')) return 'single';
    if (body.classList.contains('archive')) return 'archive';
    if (body.classList.contains('page')) return 'page';
    return 'unknown';
  }

  /* ── Title Parsing Engine ────────────────────────────────── */
  // Extracts structured metadata from verbose WP post titles like:
  // "Police Police (2025) [Season 1] WEB-HDRip [Hindi ORG DD 2.0] 1080p | 720p | HEVC | 480p [x264|x265] Esubs"
  function parseTitle(rawTitle) {
    if (!rawTitle) return { cleanTitle: '', year: '', quality: [], codec: [], audio: [], type: '', subtitles: '', season: '', episode: '' };

    let working = rawTitle.trim();

    // Extract year (4 digits in parens or standalone)
    const yearMatch = working.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : '';
    if (yearMatch) working = working.replace(yearMatch[0], '').trim();

    // Extract season/episode
    const seasonMatch = working.match(/\[?(Season\s*\d+|S\d{1,2})\]?/i);
    const season = seasonMatch ? seasonMatch[1] : '';
    if (seasonMatch) working = working.replace(seasonMatch[0], '').trim();

    const epMatch = working.match(/\[?(Episode\s*\d+[\s\d\-]*(?:Added)?|EP?\s*\d+[\s\d\-]*(?:ADDED)?)\]?/i);
    const episode = epMatch ? epMatch[1] : '';
    if (epMatch) working = working.replace(epMatch[0], '').trim();

    // Quality resolutions
    const qualityTokens = ['4K', '2160p', '1080p', '720p', '480p', '360p'];
    const quality = qualityTokens.filter(q => new RegExp(q, 'i').test(working));

    // Codec
    const codecTokens = ['x265', 'x264', 'HEVC', 'AVC', 'H.264', 'H.265'];
    const codec = codecTokens.filter(c => new RegExp(c.replace('.', '\\.'), 'i').test(working));

    // Subtitle type
    const subMatch = working.match(/\b(ESubs?|HSubs?|Subs?|Subtitles?|Multi[-\s]?Subs?)\b/i);
    const subtitles = subMatch ? subMatch[1] : '';

    // Source/type
    const typeMatch = working.match(/\b(WEB-?HDRip|WEB-?DL|BluRay|Blu-?Ray|HDCAM|CAM|DVDRip|HQ[-\s]?HDTS|HDTS|HDRip|WEBRip|AMZN|NF|DSNP|HMAX|ATVP|SonyLIV|ZEE5|HOTSTAR|JioCinema)\b/i);
    const type = typeMatch ? typeMatch[1] : '';

    // Audio tracks
    const audioPatterns = [
      /Dual\s*Audio/i,
      /Multi\s*Audio/i,
      /Hindi\s*ORG(?:inal)?/i,
      /Hindi(?:\s*\+\s*\w+)*/i,
      /Tamil(?:\s*\+\s*\w+)*/i,
      /Telugu(?:\s*\+\s*\w+)*/i,
      /Malayalam/i,
      /English/i,
      /Korean/i,
      /DD\s*[\d.]+/i,
      /DDP\s*[\d.]+/i,
      /DD5\.1/i,
      /Atmos/i,
    ];
    const audioSet = new Set();
    for (const pat of audioPatterns) {
      const m = working.match(pat);
      if (m) audioSet.add(m[0].trim());
    }
    const audio = [...audioSet];

    // Clean title: strip everything after brackets/pipes or known keywords
    let cleanTitle = working
      .replace(/\[.*?\]/g, '')          // remove [anything]
      .replace(/\(.*?\)/g, '')          // remove (anything)
      .replace(/\|.*$/g, '')            // remove everything after |
      .replace(new RegExp(`\\b(${qualityTokens.join('|')})\\b`, 'gi'), '')
      .replace(new RegExp(`\\b(${codecTokens.map(c => c.replace('.', '\\.')).join('|')})\\b`, 'gi'), '')
      .replace(/\b(WEB-?HDRip|WEB-?DL|BluRay|Blu-?Ray|HDCAM|CAM|DVDRip|HQ[-\s]?HDTS|HDTS|HDRip|WEBRip)\b/gi, '')
      .replace(/\b(ESubs?|HSubs?|Subs?|Dual\s*Audio|Multi\s*Audio|Hindi\s*ORG|Hindi|Tamil|Telugu|Malayalam|English|Korean|DD\s*[\d.]+|DDP\s*[\d.]+|DD5\.1|Atmos|ORG)\b/gi, '')
      .replace(/[\[\](){}|]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[-–—]\s*$/, '')
      .trim();

    // Fallback: if cleanTitle is empty, use first segment of raw title before special chars
    if (!cleanTitle) {
      cleanTitle = rawTitle.split(/[\[(|]/)[0].replace(/\(.*/, '').trim();
    }

    return { cleanTitle, year, season, episode, quality, codec, audio, type, subtitles };
  }

  /* ── Navigation Extraction ───────────────────────────────── */
  function extractNavLinks() {
    const links = [];
    // MH Magazine nav: #mh-main-nav ul li a, or .mh-nav li a
    const selectors = [
      '#mh-main-nav ul li a',
      '.mh-nav li a',
      '#menu-main-menu li a',
      '.main-navigation li a',
      'nav ul li a',
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length > 0) {
        nodes.forEach(a => {
          const text = a.textContent.trim();
          const href = a.href;
          if (text && href && !links.find(l => l.href === href)) {
            links.push({ text, href });
          }
        });
        break;
      }
    }
    // Deduplicate and filter empties
    return links.filter(l => l.text.length > 0 && l.text.length < 60);
  }

  /* ── Post/Article Extraction ─────────────────────────────── */
  function extractThumbnail(article) {
    // Try multiple selectors for the post thumbnail
    const imgSelectors = [
      '.mh-thumb img',
      '.post-thumb img',
      '.wp-post-image',
      'a img',
      'img',
    ];
    for (const sel of imgSelectors) {
      const img = article.querySelector(sel);
      if (img) {
        // Find the best URL out of lazy-load dataset or src (skipping tiny data URIs/placeholders)
        const src = img.dataset.src || img.dataset.lazySrc || img.getAttribute('data-original') || img.src || '';
        if (src && !src.startsWith('data:') && src.length > 5) {
          return src;
        }
      }
    }
    // Try background-image on divs (only works if attached to DOM, otherwise safe fallback)
    const thumbDiv = article.querySelector('.mh-thumb, .post-thumb, .post-image, figure');
    if (thumbDiv) {
      try {
        const bg = window.getComputedStyle(thumbDiv).backgroundImage;
        const m = bg?.match(/url\(["']?(.+?)["']?\)/);
        if (m) return m[1];
      } catch (e) {
        // detached element, getComputedStyle might fail
      }
    }
    return '';
  }

  function extractPostLink(article) {
    const selectors = [
      'h1.entry-title a',
      'h2.entry-title a',
      'h3.entry-title a',
      '.entry-title a',
      '.mh-excerpt-block h3 a',
      '.mh-excerpt-block h2 a',
      'a.mh-excerpt-thumb',
      'a[rel="bookmark"]',
    ];
    for (const sel of selectors) {
      const a = article.querySelector(sel);
      if (a && a.href) return a.href;
    }
    // Fallback: first meaningful anchor
    const anchors = article.querySelectorAll('a[href]');
    for (const a of anchors) {
      if (a.href && !a.href.includes('#') && a.href !== window.location.href) {
        return a.href;
      }
    }
    return '';
  }

  function extractRawTitle(article) {
    const selectors = [
      'h1.entry-title',
      'h2.entry-title',
      'h3.entry-title',
      '.entry-title',
      '.mh-excerpt-block h3',
      '.mh-excerpt-block h2',
    ];
    for (const sel of selectors) {
      const el = article.querySelector(sel);
      if (el) return el.textContent.trim();
    }
    return '';
  }

  function extractCategory(article) {
    const selectors = [
      '.entry-category a',
      '.cat-links a',
      '.entry-meta .category a',
      '.post-categories a',
    ];
    for (const sel of selectors) {
      const el = article.querySelector(sel);
      if (el) return { text: el.textContent.trim(), href: el.href };
    }
    return null;
  }

  function extractDate(article) {
    const el = article.querySelector('time, .entry-date, .post-date');
    if (el) return el.getAttribute('datetime') || el.textContent.trim();
    return '';
  }

  function extractExcerpt(article) {
    const selectors = ['.entry-content p', '.entry-excerpt p', '.mh-excerpt p'];
    for (const sel of selectors) {
      const el = article.querySelector(sel);
      if (el) return el.textContent.trim().slice(0, 120);
    }
    return '';
  }

  /* ── Main Extraction Function ────────────────────────────── */
  function extractPosts() {
    // Try multiple article selectors (MH Magazine Lite uses various structures)
    const articleSelectors = [
      'article.post',
      'article.type-post',
      'article[id^="post-"]',
      '.mh-posts article',
      '.mh-posts > div',
      '#mh-content article',
      '.content-area article',
    ];

    let articles = [];
    for (const sel of articleSelectors) {
      articles = [...document.querySelectorAll(sel)];
      if (articles.length > 0) break;
    }

    // Filter out obvious non-post elements (ads, widgets)
    articles = articles.filter(a => {
      const title = extractRawTitle(a);
      return title.length > 2;
    });

    return articles.map((article, index) => {
      const rawTitle = extractRawTitle(article);
      const parsed = parseTitle(rawTitle);
      const thumbnail = extractThumbnail(article);
      const link = extractPostLink(article);
      const category = extractCategory(article);
      const date = extractDate(article);

      return {
        id: article.id || `dm-post-${index}`,
        rawTitle,
        ...parsed,
        thumbnail,
        link,
        category,
        date,
        _el: article,   // reference for mutation observer
      };
    }).filter(p => p.link);
  }

  /* ── Pagination Extraction ───────────────────────────────── */
  function extractPagination() {
    const selectors = [
      '.mh-paging',
      '.pagination',
      '.nav-links',
      '.page-links',
      '.wp-pagenavi',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const links = [...el.querySelectorAll('a')].map(a => ({
          text: a.textContent.trim(),
          href: a.href,
          isCurrent: false,
        }));
        const current = el.querySelector('.current, .page-numbers.current');
        const currentPage = current ? parseInt(current.textContent.trim()) || 1 : 1;
        const nextLink = el.querySelector('a.next, a[rel="next"], .next a');
        return { links, currentPage, nextHref: nextLink ? nextLink.href : null, el };
      }
    }
    return { links: [], currentPage: 1, nextHref: null, el: null };
  }

  /* ── Search URL Builder ──────────────────────────────────── */
  function buildSearchUrl(query) {
    const base = window.location.origin;
    return `${base}/?s=${encodeURIComponent(query)}`;
  }

  /* ── Pagination from arbitrary document ──────────────────── */
  // Used by Load More to parse next-page link from fetched HTML
  function extractPaginationFromDoc(doc) {
    const selectors = ['.mh-paging', '.pagination', '.nav-links', '.page-links', '.wp-pagenavi'];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const nextLink = el.querySelector('a.next, a[rel="next"], .next a');
        const links = [...el.querySelectorAll('a')].map(a => ({
          text: a.textContent.trim(),
          href: a.href,
        }));
        const current = el.querySelector('.current, .page-numbers.current');
        const currentPage = current ? parseInt(current.textContent.trim()) || 1 : 1;
        return { links, currentPage, nextHref: nextLink ? nextLink.href : null };
      }
    }
    return null;
  }

  /* ── Site Logo Extraction ────────────────────────────────── */
  function extractSiteLogo() {
    const logoImg = document.querySelector('.custom-logo, #mh-header img.logo, .mh-header-inner img, .site-logo img, header img');
    if (logoImg) return logoImg.src;
    return null;
  }

  return {
    detectPageType,
    parseTitle,
    extractPosts,
    extractThumbnail,
    extractNavLinks,
    extractPagination,
    extractPaginationFromDoc,
    buildSearchUrl,
    extractSiteLogo,
  };
})();
