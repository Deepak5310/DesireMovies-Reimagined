/**
 * single.js — Single Post Page Redesign
 *
 * Completely rebuilds the movie/show detail page into a
 * modern streaming-platform style detail view.
 *
 * Extracts: title, poster, release info table, screenshots,
 * download sections (version groups + quality links).
 */

window.DMSingle = (() => {

  /* ── Utility ────────────────────────────────────────────── */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'innerHTML') node.innerHTML = v;
      else if (k === 'textContent') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  /**
   * Robustly extract the real image URL from a WP lazy-loaded <img>.
   * WordPress lazy loaders use many different data attributes.
   * We try them all and skip placeholder data-URIs / tiny 1px GIFs.
   */
  function getImgSrc(img) {
    if (!img) return '';

    // All possible lazy-load attributes (order matters: most specific first)
    const attrs = [
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-lazy',
      'data-lazysrc',
      'data-original-src',
      'data-full-url',
      'data-large-file',
      'data-medium-large',
    ];

    for (const attr of attrs) {
      const val = img.getAttribute(attr);
      if (val && isRealUrl(val)) return val;
    }

    // Try srcset — pick the largest URL
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (srcset) {
      const best = parseSrcset(srcset);
      if (best) return best;
    }

    // Finally fall back to src — but reject tiny data-URIs and 1px placeholders
    const src = img.getAttribute('src') || '';
    if (isRealUrl(src)) return src;

    return '';
  }

  function isRealUrl(url) {
    if (!url) return false;
    if (url.startsWith('data:')) return false;           // data URI placeholder
    if (/\/(\d+)x(\d+)(\.gif|\.png)?$/.test(url) &&    // tiny placeholder like /1x1.gif
        !url.includes('wp-content')) return false;
    return url.startsWith('http') || url.startsWith('//');
  }

  function parseSrcset(srcset) {
    // srcset format: "url1 400w, url2 800w, url3 1200w"
    const parts = srcset.split(',').map(s => s.trim());
    let bestUrl = '';
    let bestW = 0;
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      if (!url) continue;
      const w = descriptor ? parseInt(descriptor) : 0;
      if (w > bestW) { bestW = w; bestUrl = url; }
    }
    return bestUrl || (parts[0]?.split(/\s+/)[0] || '');
  }

  /* ── Extract raw post data from WP DOM ─────────────────── */
  function extractSinglePost() {
    // Title
    const titleEl = document.querySelector('h1.entry-title, h1.post-title, .entry-title h1, h1');
    const rawTitle = titleEl?.textContent?.trim() || document.title.split('–')[0].trim();
    const parsed = DMParser.parseTitle(rawTitle);

    // Poster / main image — try all lazy-load data attributes
    const contentEl = document.querySelector('.entry-content, #mh-content .entry-content, .post-content, .mh-excerpt-block');
    let poster = '';
    if (contentEl) {
      // Some themes put the poster in a dedicated wrapper outside .entry-content
      const posterSelectors = [
        '.mh-thumb img',
        '.post-thumb img',
        '.wp-post-image',
        'figure.post-thumbnail img',
        'figure img',
      ];
      for (const sel of posterSelectors) {
        const img = document.querySelector(sel);
        if (img) { poster = getImgSrc(img); if (poster) break; }
      }
      // Fall back to first image in post content
      if (!poster) {
        const firstImg = contentEl.querySelector('img');
        poster = getImgSrc(firstImg);
      }
    }

    // Release info table (the site renders a table with Title, Year, Hindi, Quality, IMDb, Language, Genres)
    const releaseInfo = [];
    if (contentEl) {
      // Look for paragraph-based info (the site uses colored text in paragraphs)
      const allText = contentEl.innerText || contentEl.textContent || '';

      // Extract key-value pairs from structured text
      const patterns = [
        { key: 'Title',    re: /Title[:\s]+([^\n\r]+)/i },
        { key: 'Year',     re: /Year[:\s]+([^\n\r]+)/i },
        { key: 'Quality',  re: /Qualit[y]?[:\s]+([^\n\r]+)/i },
        { key: 'IMDb',     re: /IMDb[:\s]+([^\n\r]+)/i },
        { key: 'Language', re: /Language[:\s]+([^\n\r]+)/i },
        { key: 'Genres',   re: /(?:All\s+)?Genres?[:\s]+([^\n\r]+)/i },
        { key: 'Audio',    re: /Audio[:\s]+([^\n\r]+)/i },
        { key: 'Format',   re: /Format[:\s]+([^\n\r]+)/i },
      ];

      for (const { key, re } of patterns) {
        const m = allText.match(re);
        if (m) releaseInfo.push({ key, value: m[1].trim().replace(/\s+/g, ' ') });
      }
    }

    // Screenshots — all post images except the poster
    const screenshots = [];
    if (contentEl) {
      const imgs = [...contentEl.querySelectorAll('img')];
      // Skip first image (poster)
      imgs.slice(1).forEach(img => {
        const src = getImgSrc(img);
        if (src && !src.includes('telegram') && !src.includes('logo') && !src.includes('1x1')) {
          screenshots.push(src);
        }
      });
    }

    // Download sections — the site groups downloads under headings like
    // "Untouched Version [E-AC3 DDP 2.0]" and "Encoded Version"
    // Each section has quality labels + "GD & DOWNLOAD" links
    const downloadSections = [];
    if (contentEl) {
      extractDownloadSections(contentEl, downloadSections);
    }

    // Categories from entry-meta / sidebar
    const catLinks = [...document.querySelectorAll('.entry-meta a[rel="category tag"], .cat-links a, .entry-category a')].map(a => ({
      text: a.textContent.trim(),
      href: a.href,
    }));

    // Date
    const dateEl = document.querySelector('time[datetime], .entry-date, .post-date');
    const date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

    return { rawTitle, parsed, poster, releaseInfo, screenshots, downloadSections, catLinks, date };
  }

  /* ── Download Section Parser ────────────────────────────── */
  function extractDownloadSections(contentEl, out) {
    // Strategy: walk all block-level elements looking for section headings
    // followed by quality labels and anchor tags
    const allChildren = [...contentEl.querySelectorAll('p, h2, h3, h4, div, hr, table, center')];

    let currentSection = null;
    const DOWNLOAD_LINK_RE = /download|GD|Gdrive|Magnet|Torrent|Direct/i;
    const QUALITY_RE = /\d{3,4}p|4K|HEVC|x265|x264|HC|Esub|Dual|Multi|MB|GB/i;
    const SECTION_HEADING_RE = /version|untouched|encoded|print|cam|part\s*\d/i;

    for (const node of allChildren) {
      const text = node.textContent?.trim() || '';
      if (!text) continue;

      // Detect a new section heading
      if (
        (node.tagName === 'P' || /^H[1-6]$/.test(node.tagName)) &&
        SECTION_HEADING_RE.test(text) &&
        text.length < 100
      ) {
        currentSection = { heading: text, items: [] };
        out.push(currentSection);
        continue;
      }

      // Detect quality label (standalone paragraph like "1080p (1.9 GB)")
      if (node.tagName === 'P' && QUALITY_RE.test(text) && text.length < 80) {
        if (!currentSection) {
          currentSection = { heading: 'Downloads', items: [] };
          out.push(currentSection);
        }
        // Look for download links in the next sibling or current node
        const links = collectLinks(node, DOWNLOAD_LINK_RE);
        currentSection.items.push({ label: text, links });
        continue;
      }

      // Detect download anchor directly
      const anchors = [...node.querySelectorAll('a[href]')].filter(a =>
        DOWNLOAD_LINK_RE.test(a.textContent) || DOWNLOAD_LINK_RE.test(a.href)
      );
      if (anchors.length > 0 && currentSection) {
        // Add to the last item if it exists, otherwise create one
        const lastItem = currentSection.items[currentSection.items.length - 1];
        if (lastItem) {
          anchors.forEach(a => {
            if (!lastItem.links.find(l => l.href === a.href)) {
              lastItem.links.push({ text: a.textContent.trim() || 'Download', href: a.href });
            }
          });
        }
        continue;
      }
    }

    // Fallback: if no sections found, collect ALL download links from content
    if (out.length === 0) {
      const allLinks = [...contentEl.querySelectorAll('a[href]')].filter(a =>
        DOWNLOAD_LINK_RE.test(a.textContent) || /\/download|gdrive|mega\./i.test(a.href)
      );
      if (allLinks.length > 0) {
        out.push({
          heading: 'Downloads',
          items: [{ label: 'All Links', links: allLinks.map(a => ({ text: a.textContent.trim() || 'Download', href: a.href })) }]
        });
      }
    }
  }

  function collectLinks(node, re) {
    const links = [];
    // Check node itself
    if (node.tagName === 'A' && re.test(node.textContent)) {
      links.push({ text: node.textContent.trim() || 'Download', href: node.href });
    }
    // Check children
    node.querySelectorAll('a[href]').forEach(a => {
      if (re.test(a.textContent) || re.test(a.href)) {
        links.push({ text: a.textContent.trim() || 'Download', href: a.href });
      }
    });
    // Check next few siblings
    let sib = node.nextElementSibling;
    let count = 0;
    while (sib && count < 3) {
      const sibText = sib.textContent?.trim() || '';
      if (/version|heading|^::/i.test(sibText)) break;
      sib.querySelectorAll('a[href]').forEach(a => {
        if (re.test(a.textContent) || re.test(a.href)) {
          links.push({ text: a.textContent.trim() || 'Download', href: a.href });
        }
      });
      if (sib.tagName === 'A' && re.test(sibText)) {
        links.push({ text: sibText || 'Download', href: sib.href });
      }
      sib = sib.nextElementSibling;
      count++;
    }
    return links;
  }

  /* ── Quality Badge Color ────────────────────────────────── */
  function qualityColor(label) {
    if (/4K|2160/i.test(label)) return '#a855f7';
    if (/1080/i.test(label)) return '#3b82f6';
    if (/720/i.test(label)) return '#22c55e';
    if (/480/i.test(label)) return '#f59e0b';
    if (/HEVC|x265/i.test(label)) return '#06b6d4';
    return '#6b7280';
  }

  /* ── Render Full Detail Page ─────────────────────────────── */
  function buildDetailPage(data, navLinks) {
    const { rawTitle, parsed, poster, releaseInfo, screenshots, downloadSections, catLinks, date } = data;
    const displayTitle = parsed.cleanTitle || rawTitle.split(/[\[(|]/)[0].trim();

    const app = el('div', { className: 'dm-app', id: 'dm-app' });

    // ── Navbar ──
    app.appendChild(DMRenderer.buildNavbar(navLinks, DMParser.extractSiteLogo()));

    // ── Category bar ──
    app.appendChild(DMRenderer.buildCategoryBar(navLinks));

    // ── Main ──
    const main = el('main', { className: 'dm-main dm-single-main', id: 'dm-main' });

    // Back button
    const backBtn = el('a', { href: window.location.origin + '/', className: 'dm-single__back' });
    backBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> Back to Browse`;
    main.appendChild(backBtn);

    // ── Hero section ──
    const hero = el('div', { className: 'dm-single__hero' });

    // Poster
    const posterWrap = el('div', { className: 'dm-single__poster-wrap' });
    if (poster) {
      const posterImg = el('img', { src: poster, alt: displayTitle, className: 'dm-single__poster' });
      posterImg.onerror = function() { this.parentElement.classList.add('dm-single__poster-wrap--error'); };
      posterWrap.appendChild(posterImg);
    } else {
      posterWrap.classList.add('dm-single__poster-wrap--error');
      posterWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" x2="7" y1="2" y2="22"/><line x1="17" x2="17" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/></svg>`;
    }
    hero.appendChild(posterWrap);

    // Meta column
    const metaCol = el('div', { className: 'dm-single__meta-col' });

    // Title
    const titleEl = el('h1', { className: 'dm-single__title' });
    titleEl.textContent = displayTitle;
    metaCol.appendChild(titleEl);

    // Quality badges row
    if (parsed.quality.length > 0 || parsed.codec.length > 0) {
      const badgeRow = el('div', { className: 'dm-single__badges' });
      const allBadges = [
        ...parsed.quality.map(q => ({ label: q, color: qualityColor(q) })),
        ...parsed.codec.map(c => ({ label: c, color: '#06b6d4' })),
        ...(parsed.audio.some(a => /dual/i.test(a)) ? [{ label: 'Dual Audio', color: '#f97316' }] : []),
        ...(parsed.audio.some(a => /multi/i.test(a)) ? [{ label: 'Multi Audio', color: '#f97316' }] : []),
        ...(parsed.subtitles ? [{ label: parsed.subtitles, color: '#8b5cf6' }] : []),
      ];
      allBadges.forEach(b => {
        const badge = el('span', { className: 'dm-badge dm-badge--lg', style: `--badge-color:${b.color}` });
        badge.textContent = b.label;
        badgeRow.appendChild(badge);
      });
      metaCol.appendChild(badgeRow);
    }

    // Release info grid
    if (releaseInfo.length > 0) {
      const infoGrid = el('dl', { className: 'dm-single__info-grid' });
      // Also add parsed year/season/type if not already in releaseInfo
      const infoFull = [...releaseInfo];
      if (parsed.year && !releaseInfo.find(r => r.key === 'Year')) {
        infoFull.unshift({ key: 'Year', value: parsed.year });
      }
      if (parsed.type && !releaseInfo.find(r => r.key === 'Format')) {
        infoFull.push({ key: 'Source', value: parsed.type });
      }
      if (parsed.season) {
        infoFull.push({ key: 'Season', value: parsed.season });
      }

      infoFull.forEach(({ key, value }) => {
        const dt = el('dt', { className: 'dm-single__info-key' });
        dt.textContent = key;
        const dd = el('dd', { className: 'dm-single__info-val' });
        dd.textContent = value;
        infoGrid.appendChild(dt);
        infoGrid.appendChild(dd);
      });
      metaCol.appendChild(infoGrid);
    } else {
      // Fallback: show at least year + source from parsed title
      if (parsed.year || parsed.type || parsed.season) {
        const infoGrid = el('dl', { className: 'dm-single__info-grid' });
        const items = [
          parsed.year && { key: 'Year', value: parsed.year },
          parsed.season && { key: 'Season', value: parsed.season },
          parsed.type && { key: 'Source', value: parsed.type },
          parsed.audio.length && { key: 'Audio', value: parsed.audio.slice(0, 2).join(', ') },
        ].filter(Boolean);
        items.forEach(({ key, value }) => {
          const dt = el('dt', { className: 'dm-single__info-key' }); dt.textContent = key;
          const dd = el('dd', { className: 'dm-single__info-val' }); dd.textContent = value;
          infoGrid.appendChild(dt); infoGrid.appendChild(dd);
        });
        metaCol.appendChild(infoGrid);
      }
    }

    // Categories
    if (catLinks.length > 0) {
      const catRow = el('div', { className: 'dm-single__cats' });
      const catLabel = el('span', { className: 'dm-single__cats-label' }); catLabel.textContent = 'Categories:';
      catRow.appendChild(catLabel);
      catLinks.forEach(c => {
        const chip = el('a', { href: c.href, className: 'dm-chip dm-chip--sm' });
        chip.textContent = c.text;
        catRow.appendChild(chip);
      });
      metaCol.appendChild(catRow);
    }

    hero.appendChild(metaCol);
    main.appendChild(hero);

    // ── Download Sections ──
    if (downloadSections.length > 0) {
      const dlSection = el('section', { className: 'dm-single__dl-section' });
      const dlTitle = el('h2', { className: 'dm-single__section-title' }); dlTitle.textContent = 'Download Links';
      dlSection.appendChild(dlTitle);

      downloadSections.forEach(section => {
        const group = el('div', { className: 'dm-single__dl-group' });
        const groupHead = el('div', { className: 'dm-single__dl-group-head' });
        groupHead.textContent = section.heading;
        group.appendChild(groupHead);

        if (section.items.length === 0) {
          const empty = el('p', { className: 'dm-single__dl-empty' }); empty.textContent = 'No links found';
          group.appendChild(empty);
        }

        section.items.forEach(item => {
          const row = el('div', { className: 'dm-single__dl-row' });

          // Quality label
          const label = el('div', { className: 'dm-single__dl-label' });
          const color = qualityColor(item.label);
          const labelBadge = el('span', { className: 'dm-badge', style: `--badge-color:${color}` });
          labelBadge.textContent = item.label;
          label.appendChild(labelBadge);
          row.appendChild(label);

          // Links
          const linksWrap = el('div', { className: 'dm-single__dl-links' });
          if (item.links.length === 0) {
            const noLink = el('span', { className: 'dm-single__dl-nolink' }); noLink.textContent = '—';
            linksWrap.appendChild(noLink);
          }
          item.links.forEach(link => {
            const a = el('a', {
              href: link.href,
              className: 'dm-single__dl-btn',
              target: '_blank',
              rel: 'noopener noreferrer',
            });
            a.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> ${link.text || 'Download'}`;
            linksWrap.appendChild(a);
          });
          row.appendChild(linksWrap);
          group.appendChild(row);
        });

        dlSection.appendChild(group);
      });
      main.appendChild(dlSection);
    }

    // ── Screenshots ──
    if (screenshots.length > 0) {
      const ssSection = el('section', { className: 'dm-single__ss-section' });
      const ssTitle = el('h2', { className: 'dm-single__section-title' }); ssTitle.textContent = 'Screenshots';
      ssSection.appendChild(ssTitle);

      const ssGrid = el('div', { className: 'dm-single__ss-grid' });
      screenshots.slice(0, 12).forEach(src => {
        const ssWrap = el('div', { className: 'dm-single__ss-wrap' });
        const ssImg = el('img', { src, className: 'dm-single__ss-img', loading: 'lazy', alt: 'Screenshot' });
        ssWrap.appendChild(ssImg);
        ssGrid.appendChild(ssWrap);
      });
      ssSection.appendChild(ssGrid);
      main.appendChild(ssSection);
    }

    app.appendChild(main);

    // Footer
    const footer = el('footer', { className: 'dm-footer' });
    footer.innerHTML = `<div class="dm-footer__inner"><div class="dm-footer__brand"><span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span><span class="dm-footer__tag">Reimagined</span></div><p class="dm-footer__note">UI redesigned by DesireMovies Reimagined Chrome Extension.</p></div>`;
    app.appendChild(footer);

    return app;
  }

  /* ── Main init for single pages ─────────────────────────── */
  async function init() {
    const settings = await DMStorage.getAll();

    // Extract all data BEFORE touching the DOM
    const data    = extractSinglePost();
    const navLinks = DMParser.extractNavLinks();

    // Now hide original
    hideSinglePageContent();

    // Build and inject
    const app = buildDetailPage(data, navLinks);
    document.body.appendChild(app);
    document.body.classList.remove('dm-loading');
    document.body.classList.add('dm-reimagined');

    // Wire search
    DMSearch.init(navLinks);

    // Wire mobile menu
    const menuBtn  = document.querySelector('#dm-mobile-menu-btn');
    const mobileNav = document.querySelector('#dm-mobile-nav');
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', () => {
        mobileNav.classList.toggle('dm-mobile-nav--open');
        menuBtn.classList.toggle('dm-navbar__btn--active');
      });
    }
  }

  function hideSinglePageContent() {
    document.body.classList.add('dm-loading');
    const HIDE = 'display:none!important;visibility:hidden!important;';
    for (const child of document.body.children) {
      if (['SCRIPT','STYLE','LINK','META','NOSCRIPT'].includes(child.tagName)) continue;
      if (child.id === 'dm-app') continue;
      child.style.cssText = HIDE;
    }
  }

  return { init };
})();
