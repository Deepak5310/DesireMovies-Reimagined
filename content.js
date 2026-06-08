/**
 * content.js — Main Orchestrator
 * DesireMovies Reimagined Chrome Extension
 *
 * Entry point: extracts site content, builds new UI, manages lifecycle.
 * All modules are loaded before this file by the manifest.
 */

(async function () {
  "use strict";

  // Set the active class on HTML tag immediately to hide original theme layout elements
  document.documentElement.classList.add("dm-extension-active");

  // ── 1. Common Helpers ──
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k === "innerHTML") node.innerHTML = v;
      else if (k === "textContent") node.textContent = v;
      else if (k.startsWith("data-")) node.dataset[k.slice(5)] = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child)
        node.appendChild(
          typeof child === "string" ? document.createTextNode(child) : child,
        );
    }
    return node;
  }

  function svgIcon(name) {
    const icons = {
      search: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
      film: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" x2="7" y1="2" y2="22"/><line x1="17" x2="17" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="2" x2="7" y1="7" y2="7"/><line x1="17" x2="22" y1="7" y2="7"/><line x1="17" x2="22" y1="17" y2="17"/><line x1="2" x2="7" y1="17" y2="17"/></svg>`,
    };
    const wrapper = document.createElement("span");
    wrapper.className = "dm-icon";
    wrapper.innerHTML = icons[name] || "";
    return wrapper;
  }

  function getImgSrc(img) {
    if (!img) return "";
    const attrs = [
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-lazy",
      "data-lazysrc",
      "data-original-src",
      "data-full-url",
      "data-large-file",
      "data-medium-large",
    ];
    for (const attr of attrs) {
      const val = img.getAttribute(attr);
      if (val && isRealUrl(val)) return val;
    }
    const srcset =
      img.getAttribute("srcset") || img.getAttribute("data-srcset");
    if (srcset) {
      const best = parseSrcset(srcset);
      if (best) return best;
    }
    const src = img.getAttribute("src") || "";
    if (isRealUrl(src)) return src;
    return "";
  }

  function isRealUrl(url) {
    if (!url) return false;
    if (url.startsWith("data:")) return false;
    if (/\/(\d+)x(\d+)(\.gif|\.png)?$/.test(url) && !url.includes("wp-content"))
      return false;
    return url.startsWith("http") || url.startsWith("//");
  }

  function parseSrcset(srcset) {
    const parts = srcset.split(",").map((s) => s.trim());
    let bestUrl = "";
    let bestW = 0;
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      if (!url) continue;
      const w = descriptor ? parseInt(descriptor) : 0;
      if (w > bestW) {
        bestW = w;
        bestUrl = url;
      }
    }
    return bestUrl || parts[0]?.split(/\s+/)[0] || "";
  }

  async function bgFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "fetch", url, options }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response ? response.error : "Background fetch failed"));
        }
      });
    });
  }

  // ── 2. DOM Extraction & Title Parser ──
  const DMParser = {
    detectPageType() {
      const body = document.body;
      if (body.classList.contains("home") || body.classList.contains("blog"))
        return "home";
      if (body.classList.contains("category")) return "category";
      if (body.classList.contains("search-results")) return "search";
      if (
        body.classList.contains("single-post") ||
        body.classList.contains("single")
      )
        return "single";
      if (body.classList.contains("archive")) return "archive";
      if (body.classList.contains("page")) return "page";
      return "unknown";
    },

    parseTitle(rawTitle) {
      if (!rawTitle)
        return {
          cleanTitle: "",
          year: "",
          quality: [],
          codec: [],
          audio: [],
          type: "",
          subtitles: "",
          season: "",
          episode: "",
        };
      let working = rawTitle.trim();

      const yearMatch = working.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : "";
      if (yearMatch) working = working.replace(yearMatch[0], "").trim();

      const seasonMatch = working.match(/\[?(Season\s*\d+|S\d{1,2})\]?/i);
      const season = seasonMatch ? seasonMatch[1] : "";
      if (seasonMatch) working = working.replace(seasonMatch[0], "").trim();

      const epMatch = working.match(
        /\[?(Episode\s*\d+[\s\d\-]*(?:Added)?|EP?\s*\d+[\s\d\-]*(?:ADDED)?)\]?/i,
      );
      const episode = epMatch ? epMatch[1] : "";
      if (epMatch) working = working.replace(epMatch[0], "").trim();

      const qualityTokens = ["4K", "2160p", "1080p", "720p", "480p", "360p"];
      const quality = qualityTokens.filter((q) =>
        new RegExp(q, "i").test(working),
      );

      const codecTokens = ["x265", "x264", "HEVC", "AVC", "H.264", "H.265"];
      const codec = codecTokens.filter((c) =>
        new RegExp(c.replace(".", "\\."), "i").test(working),
      );

      const subMatch = working.match(
        /\b(ESubs?|HSubs?|Subs?|Subtitles?|Multi[-\s]?Subs?)\b/i,
      );
      const subtitles = subMatch ? subMatch[1] : "";

      const typeMatch = working.match(
        /\b(WEB-?HDRip|WEB-?DL|BluRay|Blu-?Ray|HDCAM|CAM|DVDRip|HQ[-\s]?HDTS|HDTS|HDRip|WEBRip|AMZN|NF|DSNP|HMAX|ATVP|SonyLIV|ZEE5|HOTSTAR|JioCinema)\b/i,
      );
      const type = typeMatch ? typeMatch[1] : "";

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

      let cleanTitle = working
        .replace(/\[.*?\]/g, "")
        .replace(/\(.*?\)/g, "")
        .replace(/\|.*$/g, "")
        .replace(new RegExp(`\\b(${qualityTokens.join("|")})\\b`, "gi"), "")
        .replace(
          new RegExp(
            `\\b(${codecTokens.map((c) => c.replace(".", "\\.")).join("|")})\\b`,
            "gi",
          ),
          "",
        )
        .replace(
          /\b(WEB-?HDRip|WEB-?DL|BluRay|Blu-?Ray|HDCAM|CAM|DVDRip|HQ[-\s]?HDTS|HDTS|HDRip|WEBRip)\b/gi,
          "",
        )
        .replace(
          /\b(ESubs?|HSubs?|Subs?|Dual\s*Audio|Multi\s*Audio|Hindi\s*ORG|Hindi|Tamil|Telugu|Malayalam|English|Korean|DD\s*[\d.]+|DDP\s*[\d.]+|DD5\.1|Atmos|ORG)\b/gi,
          "",
        )
        .replace(/[\[\](){}|]/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/[-–—]\s*$/, "")
        .trim();

      if (!cleanTitle) {
        cleanTitle = rawTitle
          .split(/[\[(|]/)[0]
          .replace(/\(.*/, "")
          .trim();
      }

      return {
        cleanTitle,
        year,
        season,
        episode,
        quality,
        codec,
        audio,
        type,
        subtitles,
      };
    },

    extractNavLinks() {
      const links = [];
      const selectors = [
        "#mh-main-nav ul li a",
        ".mh-nav li a",
        "#menu-main-menu li a",
        ".main-navigation li a",
        "nav ul li a",
      ];
      for (const sel of selectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
          nodes.forEach((a) => {
            let text = a.textContent.trim();
            const href = a.href;

            // Skip "Desiremovies Home" to avoid redundancy in nav and category bars
            if (/desiremovies\s+home/i.test(text) || text.toLowerCase() === "home") return;

            // Normalize brackets into parentheses for consistent labeling
            text = text.replace(/\[([^\]]+)\]/g, "($1)");

            if (text && href && !links.find((l) => l.href === href)) {
              links.push({ text, href });
            }
          });
          break;
        }
      }
      return links.filter((l) => l.text.length > 0 && l.text.length < 60);
    },

    extractThumbnail(article) {
      const imgSelectors = [
        ".mh-thumb img",
        ".post-thumb img",
        ".wp-post-image",
        "a img",
        "img",
      ];
      for (const sel of imgSelectors) {
        const img = article.querySelector(sel);
        if (img) {
          const src =
            img.dataset.src ||
            img.dataset.lazySrc ||
            img.getAttribute("data-original") ||
            img.src ||
            "";
          if (src && !src.startsWith("data:") && src.length > 5) return src;
        }
      }
      const thumbDiv = article.querySelector(
        ".mh-thumb, .post-thumb, .post-image, figure",
      );
      if (thumbDiv) {
        try {
          const bg = window.getComputedStyle(thumbDiv).backgroundImage;
          const m = bg?.match(/url\(["']?(.+?)["']?\)/);
          if (m) return m[1];
        } catch (e) {}
      }
      return "";
    },

    extractPostLink(article) {
      const selectors = [
        "h1.entry-title a",
        "h2.entry-title a",
        "h3.entry-title a",
        ".entry-title a",
        ".mh-excerpt-block h3 a",
        'a[rel="bookmark"]',
      ];
      for (const sel of selectors) {
        const a = article.querySelector(sel);
        if (a && a.href) return a.href;
      }
      return "";
    },

    extractRawTitle(article) {
      const selectors = [
        "h1.entry-title",
        "h2.entry-title",
        "h3.entry-title",
        ".entry-title",
        ".mh-excerpt-block h3",
        ".mh-excerpt-block h2",
      ];
      for (const sel of selectors) {
        const el = article.querySelector(sel);
        if (el) return el.textContent.trim();
      }
      return "";
    },

    extractCategory(article) {
      const selectors = [
        ".entry-category a",
        ".cat-links a",
        ".entry-meta .category a",
        ".post-categories a",
      ];
      for (const sel of selectors) {
        const el = article.querySelector(sel);
        if (el) return { text: el.textContent.trim(), href: el.href };
      }
      return null;
    },

    extractPosts() {
      const articleSelectors = [
        "article.post",
        "article.type-post",
        'article[id^="post-"]',
        ".mh-posts article",
        "#mh-content article",
      ];
      let articles = [];
      for (const sel of articleSelectors) {
        articles = [...document.querySelectorAll(sel)];
        if (articles.length > 0) break;
      }
      articles = articles.filter((a) => this.extractRawTitle(a).length > 2);

      return articles
        .map((article, index) => {
          const rawTitle = this.extractRawTitle(article);
          const parsed = this.parseTitle(rawTitle);
          const thumbnail = this.extractThumbnail(article);
          const link = this.extractPostLink(article);
          const category = this.extractCategory(article);
          return {
            id: article.id || `dm-post-${index}`,
            rawTitle,
            ...parsed,
            thumbnail,
            link,
            category,
          };
        })
        .filter((p) => p.link);
    },

    extractPagination() {
      const selectors = [
        ".mh-paging",
        ".pagination",
        ".nav-links",
        ".page-links",
        ".wp-pagenavi",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const links = [...el.querySelectorAll("a")].map((a) => ({
            text: a.textContent.trim(),
            href: a.href,
          }));
          const current = el.querySelector(".current, .page-numbers.current");
          const currentPage = current
            ? parseInt(current.textContent.trim()) || 1
            : 1;
          const nextLink = el.querySelector('a.next, a[rel="next"], .next a');
          return {
            links,
            currentPage,
            nextHref: nextLink ? nextLink.href : null,
          };
        }
      }
      return { links: [], currentPage: 1, nextHref: null };
    },

    extractPaginationFromDoc(doc) {
      const selectors = [
        ".mh-paging",
        ".pagination",
        ".nav-links",
        ".wp-pagenavi",
      ];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el) {
          const nextLink = el.querySelector('a.next, a[rel="next"], .next a');
          return { nextHref: nextLink ? nextLink.href : null };
        }
      }
      return null;
    },

    extractSiteLogo() {
      const logoImg = document.querySelector(
        ".custom-logo, #mh-header img.logo, .mh-header-inner img, .site-logo img, header img",
      );
      return logoImg ? logoImg.src : null;
    },
  };

  // ── 3. List Page Renderer ──
  const DMRenderer = {
    BADGE_CONFIG: {
      "4K": { color: "#a855f7", label: "4K" },
      "2160p": { color: "#a855f7", label: "4K" },
      "1080p": { color: "#3b82f6", label: "1080p" },
      "720p": { color: "#22c55e", label: "720p" },
      "480p": { color: "#f59e0b", label: "480p" },
      HEVC: { color: "#06b6d4", label: "HEVC" },
      x265: { color: "#06b6d4", label: "x265" },
      "Dual Audio": { color: "#f97316", label: "Dual" },
      "Multi Audio": { color: "#f97316", label: "Multi" },
      ESubs: { color: "#8b5cf6", label: "SUB" },
    },

    buildBadge(text, color) {
      const badge = el("span", {
        className: "dm-badge",
        style: `--badge-color: ${color}`,
      });
      badge.textContent = text;
      return badge;
    },

    buildBadgesFromPost(post, maxBadges = 3) {
      const fragment = document.createDocumentFragment();
      const shown = new Set();
      let count = 0;

      const addBadge = (text, configKey) => {
        if (count >= maxBadges) return;
        const cfg = this.BADGE_CONFIG[configKey] || this.BADGE_CONFIG[text];
        if (!cfg || shown.has(cfg.label)) return;
        shown.add(cfg.label);
        fragment.appendChild(this.buildBadge(cfg.label, cfg.color));
        count++;
      };

      for (const q of post.quality) addBadge(q, q);
      for (const c of post.codec) addBadge(c, c);
      for (const a of post.audio) {
        if (/dual/i.test(a)) addBadge("Dual Audio", "Dual Audio");
        else if (/multi/i.test(a)) addBadge("Multi Audio", "Multi Audio");
      }
      if (post.subtitles) {
        addBadge(/esub/i.test(post.subtitles) ? "ESubs" : "ESubs", "ESubs");
      }
      return fragment;
    },

    buildCard(post) {
      const card = el("article", { className: "dm-card", "data-id": post.id });
      const link = el("a", {
        href: post.link,
        className: "dm-card__poster-link",
        title: post.cleanTitle,
      });
      const imgWrapper = el("div", { className: "dm-card__img-wrapper" });

      if (post.thumbnail) {
        const img = el("img", {
          className: "dm-card__img",
          alt: post.cleanTitle,
          loading: "lazy",
        });
        img.src = post.thumbnail;
        img.onerror = function () {
          this.style.display = "none";
          imgWrapper.classList.add("dm-card__img--error");
          imgWrapper.appendChild(svgIcon("film"));
        };
        imgWrapper.appendChild(img);
      } else {
        imgWrapper.classList.add("dm-card__img--error");
        imgWrapper.appendChild(svgIcon("film"));
      }

      const overlay = el("div", { className: "dm-card__overlay" });
      const badgeRow = el("div", { className: "dm-card__badges" });
      badgeRow.appendChild(this.buildBadgesFromPost(post, 3));
      overlay.appendChild(badgeRow);

      const overlayMeta = el("div", { className: "dm-card__overlay-meta" });
      const overlayTitle = el("p", { className: "dm-card__overlay-title" });
      overlayTitle.textContent = post.cleanTitle || post.rawTitle;
      overlayMeta.appendChild(overlayTitle);

      if (post.type) {
        const sourceTag = el("span", { className: "dm-card__source" });
        sourceTag.textContent = post.type.toUpperCase();
        overlayMeta.appendChild(sourceTag);
      }
      overlay.appendChild(overlayMeta);

      const cta = el("div", { className: "dm-card__cta" });
      const ctaBtn = el("span", { className: "dm-card__cta-btn" });
      ctaBtn.textContent = "View Details";
      cta.appendChild(ctaBtn);
      overlay.appendChild(cta);

      imgWrapper.appendChild(overlay);
      link.appendChild(imgWrapper);
      card.appendChild(link);

      const info = el("div", { className: "dm-card__info" });
      const title = el("h3", { className: "dm-card__title" });
      const titleLink = el("a", {
        href: post.link,
        className: "dm-card__title-link",
      });
      titleLink.textContent =
        post.cleanTitle || post.rawTitle.split(/[\[(|]/)[0].trim();
      title.appendChild(titleLink);
      info.appendChild(title);

      const meta = el("div", { className: "dm-card__meta" });
      if (post.year) {
        const yearSpan = el("span", { className: "dm-card__year" });
        yearSpan.textContent = post.year;
        meta.appendChild(yearSpan);
      }
      if (post.season) {
        const seasonSpan = el("span", { className: "dm-card__season" });
        seasonSpan.textContent = post.season;
        meta.appendChild(seasonSpan);
      }
      if (post.category) {
        const catSpan = el("span", { className: "dm-card__cat" });
        catSpan.textContent = post.category.text;
        meta.appendChild(catSpan);
      }
      info.appendChild(meta);

      if (post.quality.length > 0 || post.codec.length > 0) {
        const inlineBadges = el("div", { className: "dm-card__inline-badges" });
        inlineBadges.appendChild(this.buildBadgesFromPost(post, 4));
        info.appendChild(inlineBadges);
      }

      card.appendChild(info);
      return card;
    },

    buildGrid(posts) {
      const section = el("section", { className: "dm-grid-section" });
      if (!posts || posts.length === 0) {
        section.appendChild(this.buildEmptyState());
        return section;
      }
      const grid = el("div", { className: "dm-grid", "data-cols": "6" });
      for (const post of posts) {
        grid.appendChild(this.buildCard(post));
      }
      section.appendChild(grid);
      return section;
    },

    buildNavbar(navLinks, siteLogo) {
      const nav = el("nav", { className: "dm-navbar", id: "dm-navbar" });
      const left = el("div", { className: "dm-navbar__left" });
      const logoLink = el("a", {
        href: window.location.origin + "/",
        className: "dm-logo",
      });

      const logoText = el("span", { className: "dm-logo__text" });
      logoText.innerHTML =
        '<span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span>';
      logoLink.appendChild(logoText);
      left.appendChild(logoLink);

      const center = el("div", { className: "dm-navbar__center" });
      const navList = el("ul", { className: "dm-navbar__links" });

      // Home link
      const homeLi = el("li", { className: "dm-navbar__link-item" });
      const homeA = el("a", {
        href: window.location.origin + "/",
        className: "dm-navbar__link",
      });
      homeA.textContent = "Home";
      if (
        window.location.pathname === "/" ||
        window.location.pathname === ""
      ) {
        homeA.classList.add("dm-navbar__link--active");
      }
      homeLi.appendChild(homeA);
      navList.appendChild(homeLi);

      // Categories Dropdown Link
      const dropdownLi = el("li", {
        className: "dm-navbar__link-item dm-dropdown",
      });
      const dropdownBtn = el("button", {
        type: "button",
        className: "dm-navbar__link dm-dropdown-btn",
      });
      dropdownBtn.innerHTML = `Categories <span class="dm-dropdown-arrow"></span>`;

      const dropdownMenu = el("div", { className: "dm-dropdown-menu" });
      const dropdownGrid = el("div", { className: "dm-dropdown-grid" });



      // Category links
      navLinks.forEach((link) => {
        const catLink = el("a", {
          href: link.href,
          className: "dm-dropdown-link",
        });
        catLink.textContent = link.text;
        if (
          window.location.href === link.href ||
          window.location.href.startsWith(link.href)
        ) {
          catLink.classList.add("dm-dropdown-link--active");
          dropdownBtn.classList.add("dm-navbar__link--active");
        }
        dropdownGrid.appendChild(catLink);
      });

      dropdownMenu.appendChild(dropdownGrid);
      dropdownLi.appendChild(dropdownBtn);
      dropdownLi.appendChild(dropdownMenu);
      navList.appendChild(dropdownLi);

      // Touch events for mobile/tablet dropdown behavior
      dropdownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdownLi.classList.toggle("dm-dropdown--open");
      });
      document.addEventListener("click", () => {
        dropdownLi.classList.remove("dm-dropdown--open");
      });

      center.appendChild(navList);

      const right = el("div", { className: "dm-navbar__right" });

      // Clean inline search form (Direct Form Action, replaces full search modal)
      const searchForm = el("form", {
        action: window.location.origin + "/",
        method: "get",
        className: "dm-navbar__search",
      });
      const searchInput = el("input", {
        type: "search",
        name: "s",
        placeholder: "Search...",
        className: "dm-navbar__search-input",
      });
      if (DMParser.detectPageType() === "search") {
        searchInput.value =
          new URLSearchParams(window.location.search).get("s") || "";
      }
      const searchSubmit = el("button", {
        type: "submit",
        className: "dm-navbar__search-btn",
        title: "Search",
      });
      searchSubmit.appendChild(svgIcon("search"));
      searchForm.appendChild(searchInput);
      searchForm.appendChild(searchSubmit);
      right.appendChild(searchForm);



      nav.appendChild(left);
      nav.appendChild(center);
      nav.appendChild(right);



      return nav;
    },

    buildPageHeader(text, sub) {
      const header = el("div", { className: "dm-page-header" });
      header.appendChild(
        el("h1", { className: "dm-page-header__title", textContent: text }),
      );
      if (sub)
        header.appendChild(
          el("p", { className: "dm-page-header__sub", textContent: sub }),
        );
      return header;
    },

    buildPagination(paginationData) {
      if (!paginationData.links.length && !paginationData.nextHref) return null;
      const pag = el("nav", { className: "dm-pagination" });

      const prevLink = paginationData.links.find(
        (l) => l.text === "←" || /prev/i.test(l.text),
      );
      if (prevLink) {
        pag.appendChild(
          el("a", {
            href: prevLink.href,
            className: "dm-pag__btn dm-pag__prev",
            textContent: "← Previous",
          }),
        );
      }

      const numbers = el("div", { className: "dm-pag__numbers" });
      paginationData.links.forEach((link) => {
        if (/^\d+$/.test(link.text)) {
          const btn = el("a", {
            href: link.href,
            className: `dm-pag__num ${parseInt(link.text) === paginationData.currentPage ? "dm-pag__num--active" : ""}`,
            textContent: link.text,
          });
          numbers.appendChild(btn);
        }
      });
      pag.appendChild(numbers);

      if (paginationData.nextHref) {
        pag.appendChild(
          el("a", {
            href: paginationData.nextHref,
            className: "dm-pag__btn dm-pag__next",
            textContent: "Next Page →",
          }),
        );
        const loadMore = el("button", {
          className: "dm-load-more",
          id: "dm-load-more",
          type: "button",
          "data-href": paginationData.nextHref,
        });
        loadMore.innerHTML = `<span class="dm-load-more__text">Load More</span><span class="dm-load-more__spinner"></span>`;
        pag.appendChild(loadMore);
      }
      return pag;
    },

    buildSkeletonGrid(count = 12) {
      const section = el("section", { className: "dm-grid-section" });
      const grid = el("div", {
        className: "dm-grid dm-grid--skeleton",
        "data-cols": "6",
      });
      for (let i = 0; i < count; i++) {
        const card = el("div", { className: "dm-card dm-card--skeleton" });
        card.appendChild(
          el("div", { className: "dm-card__img-wrapper dm-skeleton" }),
        );
        const info = el("div", { className: "dm-card__info" });
        info.appendChild(
          el("div", { className: "dm-skeleton dm-skeleton--text" }),
        );
        info.appendChild(
          el("div", {
            className: "dm-skeleton dm-skeleton--text dm-skeleton--short",
          }),
        );
        card.appendChild(info);
        grid.appendChild(card);
      }
      section.appendChild(grid);
      return section;
    },

    buildEmptyState(message = "No movies found") {
      const empty = el("div", { className: "dm-empty" });
      empty.appendChild(svgIcon("film"));
      empty.appendChild(
        el("p", { className: "dm-empty__msg", textContent: message }),
      );
      return empty;
    },

    buildShell({ posts, navLinks, pagination, siteLogo, pageType, pageTitle }) {
      const app = el("div", { className: "dm-app", id: "dm-app" });
      app.appendChild(this.buildNavbar(navLinks, siteLogo));

      const main = el("main", { className: "dm-main", id: "dm-main" });
      if (pageType === "category") {
        const catTitle = document.querySelector(
          ".category-title, .archive-title, .page-header h1, h1.entry-title",
        );
        main.appendChild(
          this.buildPageHeader(
            catTitle ? catTitle.textContent.trim() : pageTitle || "Movies",
            `${posts.length} titles found`,
          ),
        );
      } else if (pageType === "search") {
        const q = new URLSearchParams(window.location.search).get("s") || "";
        main.appendChild(
          this.buildPageHeader(
            q ? `Search: "${q}"` : "Search Results",
            `${posts.length} results found`,
          ),
        );
      } else if (pageType === "archive") {
        main.appendChild(
          this.buildPageHeader(
            pageTitle || "Archive",
            `${posts.length} titles`,
          ),
        );
      }

      if (posts.length === 0) {
        main.appendChild(this.buildEmptyState("No titles found on this page."));
      } else {
        main.appendChild(this.buildGrid(posts));
      }

      if (pagination) {
        const pagEl = this.buildPagination(pagination);
        if (pagEl) main.appendChild(pagEl);
      }

      app.appendChild(main);

      const footer = el("footer", { className: "dm-footer" });
      footer.innerHTML = `<div class="dm-footer__inner"><div class="dm-footer__brand"><span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span><span class="dm-footer__tag">Reimagined</span></div><p class="dm-footer__note">UI redesigned by DesireMovies Reimagined Chrome Extension.</p></div>`;
      app.appendChild(footer);

      return app;
    },
  };

  // ── 4. Single Post Redesign ──
  const DMSingle = {
    qualityColor(label) {
      if (/4K|2160/i.test(label)) return "#a855f7";
      if (/1080/i.test(label)) return "#3b82f6";
      if (/720/i.test(label)) return "#22c55e";
      if (/480/i.test(label)) return "#f59e0b";
      if (/HEVC|x265/i.test(label)) return "#06b6d4";
      return "#6b7280";
    },

    extractSinglePost() {
      const titleEl = document.querySelector(
        "h1.entry-title, h1.post-title, .entry-title h1, h1",
      );
      const rawTitle =
        titleEl?.textContent?.trim() || document.title.split("–")[0].trim();
      const parsed = DMParser.parseTitle(rawTitle);

      const contentEl = document.querySelector(
        ".entry-content, #mh-content .entry-content, .post-content, .mh-excerpt-block",
      );
      let poster = "";

      const posterSelectors = [
        'img[fifu-featured="1"]',
        "img[data-fifu-featured]",
        ".wp-post-image img",
        "img.wp-post-image",
        ".mh-thumb img",
        ".post-thumb img",
        "figure.post-thumbnail img",
        "figure img",
      ];
      for (const sel of posterSelectors) {
        const img = document.querySelector(sel);
        if (img) {
          const src = getImgSrc(img);
          if (src) {
            poster = src;
            break;
          }
        }
      }

      if (!poster && contentEl) {
        const allImgs = [...contentEl.querySelectorAll("img")];
        for (const img of allImgs) {
          const src = getImgSrc(img);
          if (src) {
            poster = src;
            break;
          }
        }
      }

      const releaseInfo = [];
      if (contentEl) {
        const allText = contentEl.innerText || contentEl.textContent || "";
        const patterns = [
          { key: "Title", re: /Title[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Year", re: /Year[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Size", re: /Size[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Quality", re: /Qualit[y]?[:\t \u00a0]+([^\n\r]+)/i },
          { key: "IMDb", re: /IMDb[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Language", re: /Language[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Genres", re: /(?:All\s+)?Genres?[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Audio", re: /Audio[:\t \u00a0]+([^\n\r]+)/i },
          { key: "Format", re: /Format[:\t \u00a0]+([^\n\r]+)/i },
        ];
        for (const { key, re } of patterns) {
          const m = allText.match(re);
          if (m)
            releaseInfo.push({ key, value: m[1].trim().replace(/\s+/g, " ") });
        }
      }

      const screenshots = [];
      if (contentEl) {
        const imgs = [...contentEl.querySelectorAll("img")];
        imgs.forEach((img) => {
          const src = getImgSrc(img);
          if (!src) return;
          if (src === poster) return;
          if (
            src.includes("telegram") ||
            src.includes("logo") ||
            src.includes("1x1") ||
            src.includes("banner") ||
            src.includes("dd.jpg")
          )
            return;
          screenshots.push(src);
        });
      }

      const downloadSections = [];
      if (contentEl) {
        this.extractDownloadSections(contentEl, downloadSections);
      }

      const catLinks = [
        ...document.querySelectorAll(
          '.entry-meta a[rel="category tag"], .cat-links a, .entry-category a',
        ),
      ].map((a) => ({
        text: a.textContent.trim(),
        href: a.href,
      }));

      const dateEl = document.querySelector(
        "time[datetime], .entry-date, .post-date",
      );
      const date =
        dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";

      return {
        rawTitle,
        parsed,
        poster,
        releaseInfo,
        screenshots,
        downloadSections,
        catLinks,
        date,
      };
    },

    extractDownloadSections(contentEl, out) {
      const allChildren = [
        ...contentEl.children
      ].filter(node => ["P", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "HR", "TABLE", "CENTER"].includes(node.tagName.toUpperCase()));
      let currentSection = null;
      const DOWNLOAD_LINK_RE = /download|GD|Gdrive|Magnet|Torrent|Direct/i;
      const QUALITY_RE = /\d{3,4}p|4K|HEVC|x265|x264|HC|Esub|Dual|Multi|MB|GB/i;
      const SECTION_HEADING_RE =
        /version|untouched|encoded|print|cam|part|ep\b|episode|season|pack|zip|single\s*link/i;

      for (const node of allChildren) {
        const text = node.textContent?.trim() || "";
        if (!text) continue;

        const tagUpper = node.tagName.toUpperCase();
        if (
          (tagUpper === "P" || /^H[1-6]$/.test(tagUpper) || tagUpper === "CENTER") &&
          SECTION_HEADING_RE.test(text) &&
          text.length < 100
        ) {
          currentSection = { heading: text, items: [] };
          out.push(currentSection);
          continue;
        }

        if (
          (tagUpper === "P" || /^H[1-6]$/.test(tagUpper) || tagUpper === "CENTER") &&
          QUALITY_RE.test(text) &&
          text.length < 80
        ) {
          if (!currentSection) {
            currentSection = { heading: "Downloads", items: [] };
            out.push(currentSection);
          }
          const links = this.collectLinks(node, DOWNLOAD_LINK_RE, QUALITY_RE, SECTION_HEADING_RE);
          currentSection.items.push({ label: text, links });
          continue;
        }

        const anchors = [...node.querySelectorAll("a[href]")].filter(
          (a) =>
            DOWNLOAD_LINK_RE.test(a.textContent) ||
            DOWNLOAD_LINK_RE.test(a.href),
        );
        if (anchors.length > 0 && currentSection) {
          const lastItem =
            currentSection.items[currentSection.items.length - 1];
          if (lastItem) {
            anchors.forEach((a) => {
              if (!lastItem.links.find((l) => l.href === a.href)) {
                lastItem.links.push({
                  text: a.textContent.trim() || "Download",
                  href: a.href,
                });
              }
            });
          }
        }
      }

      if (out.length === 0) {
        const allLinks = [...contentEl.querySelectorAll("a[href]")].filter(
          (a) =>
            DOWNLOAD_LINK_RE.test(a.textContent) ||
            /\/download|gdrive|mega\./i.test(a.href),
        );
        if (allLinks.length > 0) {
          out.push({
            heading: "Downloads",
            items: [
              {
                label: "All Links",
                links: allLinks.map((a) => ({
                  text: a.textContent.trim() || "Download",
                  href: a.href,
                })),
              },
            ],
          });
        }
      }
    },

    collectLinks(node, re, qualityRe, sectionHeadingRe) {
      const links = [];
      if (node.tagName === "A" && re.test(node.textContent)) {
        links.push({
          text: node.textContent.trim() || "Download",
          href: node.href,
        });
      }
      node.querySelectorAll("a[href]").forEach((a) => {
        if (re.test(a.textContent) || re.test(a.href)) {
          links.push({
            text: a.textContent.trim() || "Download",
            href: a.href,
          });
        }
      });
      let sib = node.nextElementSibling;
      let count = 0;
      while (sib && count < 3) {
        const sibText = sib.textContent?.trim() || "";
        if (
          /version|heading|^::/i.test(sibText) ||
          sib.tagName === "HR" ||
          (qualityRe && qualityRe.test(sibText)) ||
          (sectionHeadingRe && sectionHeadingRe.test(sibText))
        ) {
          break;
        }
        sib.querySelectorAll("a[href]").forEach((a) => {
          if (re.test(a.textContent) || re.test(a.href)) {
            links.push({
              text: a.textContent.trim() || "Download",
              href: a.href,
            });
          }
        });
        if (sib.tagName === "A" && re.test(sibText)) {
          links.push({ text: sibText || "Download", href: sib.href });
        }
        sib = sib.nextElementSibling;
        count++;
      }
      return links;
    },

    buildDetailPage(data, navLinks) {
      const {
        rawTitle,
        parsed,
        poster,
        releaseInfo,
        screenshots,
        downloadSections,
        catLinks,
      } = data;
      const displayTitle =
        parsed.cleanTitle || rawTitle.split(/[\[(|]/)[0].trim();
      const app = el("div", { className: "dm-app", id: "dm-app" });

      app.appendChild(
        DMRenderer.buildNavbar(navLinks, DMParser.extractSiteLogo()),
      );

      const main = el("main", {
        className: "dm-main dm-single-main",
        id: "dm-main",
      });
      const backBtn = el("a", {
        href: window.location.origin + "/",
        className: "dm-single__back",
      });
      backBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> Back to Browse`;
      main.appendChild(backBtn);

      const hero = el("div", { className: "dm-single__hero" });
      const posterWrap = el("div", { className: "dm-single__poster-wrap" });
      if (poster) {
        const posterImg = el("img", {
          src: poster,
          alt: displayTitle,
          className: "dm-single__poster",
        });
        posterImg.onerror = function () {
          this.parentElement.classList.add("dm-single__poster-wrap--error");
        };
        posterWrap.appendChild(posterImg);
      } else {
        posterWrap.classList.add("dm-single__poster-wrap--error");
        posterWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:.3"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" x2="7" y1="2" y2="22"/><line x1="17" x2="17" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/></svg>`;
      }
      hero.appendChild(posterWrap);

      const metaCol = el("div", { className: "dm-single__meta-col" });
      metaCol.appendChild(
        el("h1", { className: "dm-single__title", textContent: displayTitle }),
      );

      if (parsed.quality.length > 0 || parsed.codec.length > 0) {
        const badgeRow = el("div", { className: "dm-single__badges" });
        const allBadges = [
          ...parsed.quality.map((q) => ({
            label: q,
            color: this.qualityColor(q),
          })),
          ...parsed.codec.map((c) => ({ label: c, color: "#06b6d4" })),
          ...(parsed.audio.some((a) => /dual/i.test(a))
            ? [{ label: "Dual Audio", color: "#f97316" }]
            : []),
          ...(parsed.audio.some((a) => /multi/i.test(a))
            ? [{ label: "Multi Audio", color: "#f97316" }]
            : []),
          ...(parsed.subtitles
            ? [{ label: parsed.subtitles, color: "#8b5cf6" }]
            : []),
        ];
        allBadges.forEach((b) => {
          badgeRow.appendChild(
            el("span", {
              className: "dm-badge dm-badge--lg",
              style: `--badge-color:${b.color}`,
              textContent: b.label,
            }),
          );
        });
        metaCol.appendChild(badgeRow);
      }

      if (releaseInfo.length > 0) {
        const infoGrid = el("dl", { className: "dm-single__info-grid" });
        const infoFull = [...releaseInfo];
        if (parsed.year && !releaseInfo.find((r) => r.key === "Year"))
          infoFull.unshift({ key: "Year", value: parsed.year });
        if (parsed.type && !releaseInfo.find((r) => r.key === "Format"))
          infoFull.push({ key: "Source", value: parsed.type });
        if (parsed.season)
          infoFull.push({ key: "Season", value: parsed.season });

        infoFull.forEach(({ key, value }) => {
          infoGrid.appendChild(
            el("dt", { className: "dm-single__info-key", textContent: key }),
          );
          infoGrid.appendChild(
            el("dd", { className: "dm-single__info-val", textContent: value }),
          );
        });
        metaCol.appendChild(infoGrid);
      } else if (parsed.year || parsed.type || parsed.season) {
        const infoGrid = el("dl", { className: "dm-single__info-grid" });
        const items = [
          parsed.year && { key: "Year", value: parsed.year },
          parsed.season && { key: "Season", value: parsed.season },
          parsed.type && { key: "Source", value: parsed.type },
          parsed.audio.length && {
            key: "Audio",
            value: parsed.audio.slice(0, 2).join(", "),
          },
        ].filter(Boolean);
        items.forEach(({ key, value }) => {
          infoGrid.appendChild(
            el("dt", { className: "dm-single__info-key", textContent: key }),
          );
          infoGrid.appendChild(
            el("dd", { className: "dm-single__info-val", textContent: value }),
          );
        });
        metaCol.appendChild(infoGrid);
      }

      if (catLinks.length > 0) {
        const catRow = el("div", { className: "dm-single__cats" });
        catRow.appendChild(
          el("span", {
            className: "dm-single__cats-label",
            textContent: "Categories:",
          }),
        );
        catLinks.forEach((c) => {
          catRow.appendChild(
            el("a", {
              href: c.href,
              className: "dm-chip dm-chip--sm",
              textContent: c.text,
            }),
          );
        });
        metaCol.appendChild(catRow);
      }

      hero.appendChild(metaCol);
      main.appendChild(hero);

      if (downloadSections.length > 0) {
        const dlSection = el("section", { className: "dm-single__dl-section" });
        dlSection.appendChild(
          el("h2", {
            className: "dm-single__section-title",
            textContent: "Download Links",
          }),
        );

        downloadSections.forEach((section) => {
          const group = el("div", { className: "dm-single__dl-group" });
          group.appendChild(
            el("div", {
              className: "dm-single__dl-group-head",
              textContent: section.heading,
            }),
          );

          if (section.items.length === 0) {
            group.appendChild(
              el("p", {
                className: "dm-single__dl-empty",
                textContent: "No links found",
              }),
            );
          }

          section.items.forEach((item) => {
            const row = el("div", { className: "dm-single__dl-row" });
            const label = el("div", { className: "dm-single__dl-label" });
            label.appendChild(
              el("span", {
                className: "dm-badge",
                style: `--badge-color:${this.qualityColor(item.label)}`,
                textContent: item.label,
              }),
            );
            row.appendChild(label);

            const linksWrap = el("div", { className: "dm-single__dl-links" });
            if (item.links.length === 0) {
              linksWrap.appendChild(
                el("span", {
                  className: "dm-single__dl-nolink",
                  textContent: "—",
                }),
              );
            }
            item.links.forEach((link) => {
              const a = el("a", {
                href: link.href,
                className: "dm-single__dl-btn",
                target: "_blank",
                rel: "noopener noreferrer",
              });
              a.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> ${link.text || "Download"}`;
              linksWrap.appendChild(a);
            });
            row.appendChild(linksWrap);
            group.appendChild(row);
          });
          dlSection.appendChild(group);
        });
        main.appendChild(dlSection);
      }

      if (screenshots.length > 0) {
        const ssSection = el("section", { className: "dm-single__ss-section" });
        ssSection.appendChild(
          el("h2", {
            className: "dm-single__section-title",
            textContent: "Screenshots",
          }),
        );
        const ssGrid = el("div", { className: "dm-single__ss-grid" });
        screenshots.slice(0, 12).forEach((src) => {
          const ssWrap = el("div", { className: "dm-single__ss-wrap" });
          ssWrap.appendChild(
            el("img", {
              src,
              className: "dm-single__ss-img",
              loading: "lazy",
              alt: "Screenshot",
            }),
          );
          ssGrid.appendChild(ssWrap);
        });
        ssSection.appendChild(ssGrid);
        main.appendChild(ssSection);
      }

      app.appendChild(main);

      const footer = el("footer", { className: "dm-footer" });
      footer.innerHTML = `<div class="dm-footer__inner"><div class="dm-footer__brand"><span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span><span class="dm-footer__tag">Reimagined</span></div><p class="dm-footer__note">UI redesigned by DesireMovies Reimagined Chrome Extension.</p></div>`;
      app.appendChild(footer);

      return app;
    },

    async init() {
      const data = this.extractSinglePost();

      // Fetch correct IMDb rating from OMDb API / IMDb suggestions
      if (data.parsed && data.parsed.cleanTitle) {
        try {
          const queryTitle = data.parsed.cleanTitle;
          const queryYear = data.parsed.year || "";
          let imdbRating = null;

          // 1. Try direct OMDb search by title and year
          const apiUrl = `https://www.omdbapi.com/?apikey=thewdb&t=${encodeURIComponent(queryTitle)}&y=${queryYear}`;
          const responseData = await bgFetch(apiUrl);
          let movieData = JSON.parse(responseData.text);

          // 2. If direct title + year search fails, try suggestions API as fallback
          if (!movieData || movieData.Response === "False") {
            const firstChar = queryTitle.trim().charAt(0).toLowerCase();
            if (firstChar) {
              const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(queryTitle.trim().toLowerCase())}.json`;
              const suggestRes = await bgFetch(suggestUrl);
              const suggestData = JSON.parse(suggestRes.text);
              if (suggestData && suggestData.d && suggestData.d.length > 0) {
                const queryTitleLower = queryTitle.toLowerCase();
                const targetYear = queryYear ? parseInt(queryYear) : null;
                
                // Find best candidate
                let bestMatch = suggestData.d.find(item => {
                  if (!item.id || !item.l) return false;
                  const titleMatch = item.l.toLowerCase() === queryTitleLower;
                  if (!titleMatch) return false;
                  if (targetYear && item.y) {
                    return Math.abs(item.y - targetYear) <= 1;
                  }
                  return true;
                });

                if (!bestMatch) {
                  bestMatch = suggestData.d.find(item => {
                    if (!item.id || !item.l) return false;
                    return item.l.toLowerCase() === queryTitleLower;
                  });
                }

                if (!bestMatch) {
                  bestMatch = suggestData.d.find(item => {
                    if (!item.id || !item.l) return false;
                    return item.l.toLowerCase().includes(queryTitleLower) && 
                           (item.qid === "movie" || item.qid === "tvSeries" || item.qid === "tvMiniSeries");
                  });
                }

                if (bestMatch && bestMatch.id) {
                  // Fetch from OMDb by IMDb ID
                  const idApiUrl = `https://www.omdbapi.com/?apikey=thewdb&i=${bestMatch.id}`;
                  const idResponse = await bgFetch(idApiUrl);
                  movieData = JSON.parse(idResponse.text);
                }
              }
            }
          }

          if (movieData && movieData.Response === "True" && movieData.imdbRating && movieData.imdbRating !== "N/A") {
            imdbRating = `${movieData.imdbRating}/10`;
          }

          const imdbIndex = data.releaseInfo.findIndex((info) => info.key === "IMDb");
          if (imdbRating) {
            if (imdbIndex !== -1) {
              data.releaseInfo[imdbIndex].value = imdbRating;
            } else {
              data.releaseInfo.push({ key: "IMDb", value: imdbRating });
            }
          } else {
            // Remove incorrect or empty IMDb field if OMDb/IMDb lookup has no rating
            if (imdbIndex !== -1) {
              data.releaseInfo.splice(imdbIndex, 1);
            }
          }
        } catch (err) {
          console.warn("[DM Reimagined] Failed to fetch correct IMDb rating:", err);
        }
      }

      const navLinks = DMParser.extractNavLinks();
      const app = this.buildDetailPage(data, navLinks);
      document.body.appendChild(app);
    },


  };

  // ── 5. Main Orchestration ──
  async function initApp() {
    const hostname = window.location.hostname.toLowerCase();
    const title = document.title.toLowerCase();
    const ogSite =
      document
        .querySelector('meta[property="og:site_name"]')
        ?.content?.toLowerCase() || "";

    const isDesiremovies =
      hostname.includes("desiremovie") ||
      title.includes("desiremovie") ||
      ogSite.includes("desiremovie");
    if (!isDesiremovies) return;

    const pageType = DMParser.detectPageType();
    if (pageType === "single" || pageType === "page") {
      await DMSingle.init();
      return;
    }

    const posts = DMParser.extractPosts();
    const navLinks = DMParser.extractNavLinks();
    const pagination = DMParser.extractPagination();
    const siteLogo = DMParser.extractSiteLogo();
    const pageTitle =
      document
        .querySelector("h1, .archive-title, .category-title, .page-title")
        ?.textContent?.trim() || "";

    const skeleton = DMRenderer.buildSkeletonGrid(12);
    document.body.appendChild(skeleton);

    await new Promise((r) => setTimeout(r, 80));
    skeleton.remove();

    const app = DMRenderer.buildShell({
      posts,
      navLinks,
      pagination,
      siteLogo,
      pageType,
      pageTitle,
    });
    document.body.appendChild(app);

    initLoadMore();
    animateCardsIn();
  }





  function initLoadMore() {
    const btn = document.querySelector("#dm-load-more");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      const nextHref = btn.dataset.href;
      if (!nextHref) return;

      btn.classList.add("dm-load-more--loading");
      btn.querySelector(".dm-load-more__text").textContent = "Loading…";

      try {
        const res = await fetch(nextHref, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Network error");
        const html = await res.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const articleSelectors = [
          "article.post",
          "article.type-post",
          'article[id^="post-"]',
          ".mh-posts article",
        ];
        let newArticles = [];
        for (const sel of articleSelectors) {
          newArticles = [...doc.querySelectorAll(sel)];
          if (newArticles.length > 0) break;
        }

        const grid = document.querySelector(".dm-grid");
        if (!grid) return;

        let addedCount = 0;
        newArticles.forEach((article, i) => {
          const titleEl = article.querySelector(
            '.entry-title a, h2.entry-title a, h3.entry-title a, a[rel="bookmark"]',
          );
          const link = titleEl?.href || "";
          const rawTitleText =
            titleEl?.textContent?.trim() ||
            article.querySelector(".entry-title")?.textContent?.trim() ||
            "";

          if (!link || !rawTitleText) return;

          const parsed = DMParser.parseTitle(rawTitleText);
          const thumbnail = DMParser.extractThumbnail(article);

          const post = {
            id: article.id || `dm-load-${Date.now()}-${i}`,
            rawTitle: rawTitleText,
            ...parsed,
            thumbnail,
            link,
            category: null,
            date: "",
          };

          const card = DMRenderer.buildCard(post);
          card.style.opacity = "0";
          card.style.transform = "translateY(20px)";
          grid.appendChild(card);
          addedCount++;

          setTimeout(() => {
            card.style.transition = "opacity 0.4s ease, transform 0.4s ease";
            card.style.opacity = "1";
            card.style.transform = "translateY(0)";
          }, i * 40);
        });

        const nextPagination = DMParser.extractPaginationFromDoc(doc);
        if (nextPagination?.nextHref) {
          btn.dataset.href = nextPagination.nextHref;
          btn.querySelector(".dm-load-more__text").textContent = "Load More";
          btn.classList.remove("dm-load-more--loading");
        } else {
          btn.parentElement?.removeChild(btn);
        }

        if (addedCount === 0) {
          btn.parentElement?.removeChild(btn);
        }
      } catch (err) {
        console.warn("[DM Reimagined] Load more failed:", err);
        btn.querySelector(".dm-load-more__text").textContent = "Load More";
        btn.classList.remove("dm-load-more--loading");
      }
    });
  }

  function animateCardsIn() {
    const cards = document.querySelectorAll(".dm-card");
    cards.forEach((card, i) => {
      card.style.animationDelay = `${Math.min(i * 30, 600)}ms`;
      card.classList.add("dm-card--animate");
    });
  }

  // Initialize App
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
