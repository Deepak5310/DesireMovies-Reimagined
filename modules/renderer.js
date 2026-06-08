/**
 * renderer.js — UI Construction Engine
 *
 * Builds the complete streaming-platform UI shell:
 * glassmorphic navbar, category filter bar, movie poster grid,
 * card components with quality badges, and pagination.
 */

window.DMRenderer = (() => {

  /* ── Quality Badge Config ────────────────────────────────── */
  const BADGE_CONFIG = {
    '4K':         { color: '#a855f7', label: '4K' },
    '2160p':      { color: '#a855f7', label: '4K' },
    '1080p':      { color: '#3b82f6', label: '1080p' },
    '720p':       { color: '#22c55e', label: '720p' },
    '480p':       { color: '#f59e0b', label: '480p' },
    '360p':       { color: '#6b7280', label: '360p' },
    'HEVC':       { color: '#06b6d4', label: 'HEVC' },
    'x265':       { color: '#06b6d4', label: 'x265' },
    'x264':       { color: '#64748b', label: 'x264' },
    'Dual Audio': { color: '#f97316', label: 'Dual' },
    'Multi Audio':{ color: '#f97316', label: 'Multi' },
    'ESubs':      { color: '#8b5cf6', label: 'SUB' },
    'HSubs':      { color: '#8b5cf6', label: 'SUB' },
    'WEB-DL':     { color: '#10b981', label: 'WEB-DL' },
    'WEBRip':     { color: '#10b981', label: 'WEBRip' },
    'BluRay':     { color: '#6366f1', label: 'BluRay' },
    'HDCAM':      { color: '#dc2626', label: 'HDCAM' },
  };

  // Priority order for which badges to show on a card (max 3 visible)
  const BADGE_PRIORITY = ['4K', '2160p', '1080p', '720p', '480p', 'HEVC', 'x265', 'Dual Audio', 'Multi Audio', 'ESubs'];

  /* ── Utility ─────────────────────────────────────────────── */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'innerHTML') node.innerHTML = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function svgIcon(name) {
    const icons = {
      search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
      home:   `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      menu:   `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
      close:  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
      grid4:  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
      grid3:  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="7"/><rect x="10" y="3" width="5" height="7"/><rect x="17" y="3" width="4" height="7"/><rect x="3" y="14" width="5" height="7"/><rect x="10" y="14" width="5" height="7"/><rect x="17" y="14" width="4" height="7"/></svg>`,
      film:   `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" x2="7" y1="2" y2="22"/><line x1="17" x2="17" y1="2" y2="22"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="2" x2="7" y1="7" y2="7"/><line x1="17" x2="22" y1="7" y2="7"/><line x1="17" x2="22" y1="17" y2="17"/><line x1="2" x2="7" y1="17" y2="17"/></svg>`,
      chevron:`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
      spark:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>`,
    };
    const wrapper = document.createElement('span');
    wrapper.className = 'dm-icon';
    wrapper.innerHTML = icons[name] || '';
    return wrapper;
  }

  /* ── Quality Badge Builder ───────────────────────────────── */
  function buildBadge(text, color) {
    const badge = el('span', {
      className: 'dm-badge',
      style: `--badge-color: ${color}`,
    });
    badge.textContent = text;
    return badge;
  }

  function buildBadgesFromPost(post, maxBadges = 3) {
    const fragment = document.createDocumentFragment();
    const shown = new Set();
    let count = 0;

    const addBadge = (text, configKey) => {
      if (count >= maxBadges) return;
      const cfg = BADGE_CONFIG[configKey] || BADGE_CONFIG[text];
      if (!cfg || shown.has(cfg.label)) return;
      shown.add(cfg.label);
      fragment.appendChild(buildBadge(cfg.label, cfg.color));
      count++;
    };

    // Priority: resolution first
    for (const q of post.quality) {
      addBadge(q, q);
    }
    // Then codec
    for (const c of post.codec) {
      addBadge(c, c);
    }
    // Then audio
    for (const a of post.audio) {
      if (/dual/i.test(a)) addBadge('Dual Audio', 'Dual Audio');
      else if (/multi/i.test(a)) addBadge('Multi Audio', 'Multi Audio');
    }
    // Subtitles
    if (post.subtitles) {
      const key = /esub/i.test(post.subtitles) ? 'ESubs' : 'HSubs';
      addBadge(key, key);
    }

    return fragment;
  }

  /* ── Card Component ──────────────────────────────────────── */
  function buildCard(post, showBadges = true) {
    const card = el('article', {
      className: 'dm-card',
      'data-id': post.id,
      'data-category': post.category ? post.category.text : '',
    });

    // === Poster wrapper (link) ===
    const link = el('a', {
      href: post.link,
      className: 'dm-card__poster-link',
      title: post.cleanTitle,
    });

    // Poster image
    const imgWrapper = el('div', { className: 'dm-card__img-wrapper' });
    if (post.thumbnail) {
      const img = el('img', {
        className: 'dm-card__img',
        alt: post.cleanTitle,
        loading: 'lazy',
      });
      // Use data-src for lazy loading support
      img.src = post.thumbnail;
      img.onerror = function () {
        this.style.display = 'none';
        imgWrapper.classList.add('dm-card__img--error');
        imgWrapper.appendChild(svgIcon('film'));
      };
      imgWrapper.appendChild(img);
    } else {
      imgWrapper.classList.add('dm-card__img--error');
      imgWrapper.appendChild(svgIcon('film'));
    }

    // Hover overlay
    const overlay = el('div', { className: 'dm-card__overlay' });

    // Quality badges on overlay
    const badgeRow = el('div', { className: 'dm-card__badges' });
    if (showBadges) {
      badgeRow.appendChild(buildBadgesFromPost(post, 3));
    }
    overlay.appendChild(badgeRow);

    // Overlay bottom: title + year on hover
    const overlayMeta = el('div', { className: 'dm-card__overlay-meta' });
    const overlayTitle = el('p', { className: 'dm-card__overlay-title' });
    overlayTitle.textContent = post.cleanTitle || post.rawTitle;
    overlayMeta.appendChild(overlayTitle);

    if (post.type) {
      const sourceTag = el('span', { className: 'dm-card__source' });
      sourceTag.textContent = post.type.toUpperCase();
      overlayMeta.appendChild(sourceTag);
    }
    overlay.appendChild(overlayMeta);

    // CTA button
    const cta = el('div', { className: 'dm-card__cta' });
    const ctaBtn = el('span', { className: 'dm-card__cta-btn' });
    ctaBtn.textContent = 'View Details';
    cta.appendChild(ctaBtn);
    overlay.appendChild(cta);

    imgWrapper.appendChild(overlay);
    link.appendChild(imgWrapper);
    card.appendChild(link);

    // === Card info (below poster) ===
    const info = el('div', { className: 'dm-card__info' });

    const title = el('h3', { className: 'dm-card__title' });
    const titleLink = el('a', { href: post.link, className: 'dm-card__title-link' });
    titleLink.textContent = post.cleanTitle || post.rawTitle.split(/[\[(|]/)[0].trim();
    title.appendChild(titleLink);
    info.appendChild(title);

    // Meta row: year + category
    const meta = el('div', { className: 'dm-card__meta' });
    if (post.year) {
      const yearSpan = el('span', { className: 'dm-card__year' });
      yearSpan.textContent = post.year;
      meta.appendChild(yearSpan);
    }
    if (post.season) {
      const seasonSpan = el('span', { className: 'dm-card__season' });
      seasonSpan.textContent = post.season;
      meta.appendChild(seasonSpan);
    }
    if (post.category) {
      const catSpan = el('span', { className: 'dm-card__cat' });
      catSpan.textContent = post.category.text;
      meta.appendChild(catSpan);
    }
    info.appendChild(meta);

    // Inline badges below title (always visible, small)
    if (showBadges && (post.quality.length > 0 || post.codec.length > 0)) {
      const inlineBadges = el('div', { className: 'dm-card__inline-badges' });
      inlineBadges.appendChild(buildBadgesFromPost(post, 4));
      info.appendChild(inlineBadges);
    }

    card.appendChild(info);

    return card;
  }

  /* ── Grid Component ──────────────────────────────────────── */
  function buildGrid(posts, settings) {
    const section = el('section', { className: 'dm-grid-section' });

    if (!posts || posts.length === 0) {
      section.appendChild(buildEmptyState());
      return section;
    }

    const grid = el('div', {
      className: 'dm-grid',
      'data-cols': settings.gridColumns || 4,
    });
    grid.style.setProperty('--dm-cols', settings.gridColumns || 4);

    // Build skeleton cards first (will be replaced by real cards)
    for (const post of posts) {
      grid.appendChild(buildCard(post, settings.showBadges !== false));
    }

    section.appendChild(grid);
    return section;
  }

  /* ── Navbar ──────────────────────────────────────────────── */
  function buildNavbar(navLinks, siteLogo) {
    const nav = el('nav', { className: 'dm-navbar', id: 'dm-navbar' });

    // Left: Logo
    const left = el('div', { className: 'dm-navbar__left' });
    const logoLink = el('a', { href: window.location.origin + '/', className: 'dm-logo' });

    if (siteLogo) {
      const logoImg = el('img', { src: siteLogo, alt: 'DesireMovies', className: 'dm-logo__img' });
      logoLink.appendChild(logoImg);
    } else {
      const logoText = el('span', { className: 'dm-logo__text' });
      logoText.innerHTML = '<span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span>';
      logoLink.appendChild(logoText);
    }
    left.appendChild(logoLink);

    // Center: Navigation links (desktop) — trimmed to top 7
    const center = el('div', { className: 'dm-navbar__center' });
    const navList = el('ul', { className: 'dm-navbar__links' });
    const topLinks = navLinks.slice(0, 8);
    topLinks.forEach(link => {
      const li = el('li', { className: 'dm-navbar__link-item' });
      const a = el('a', { href: link.href, className: 'dm-navbar__link' });
      a.textContent = link.text;
      // Mark active
      if (window.location.href === link.href || window.location.href.startsWith(link.href)) {
        a.classList.add('dm-navbar__link--active');
      }
      li.appendChild(a);
      navList.appendChild(li);
    });
    center.appendChild(navList);

    // Right: Search + Grid toggle + Mobile menu
    const right = el('div', { className: 'dm-navbar__right' });

    // Search button
    const searchBtn = el('button', {
      className: 'dm-navbar__btn dm-navbar__search-btn',
      id: 'dm-search-btn',
      title: 'Search (Ctrl+K)',
      type: 'button',
    });
    searchBtn.appendChild(svgIcon('search'));
    right.appendChild(searchBtn);

    // Grid density toggle
    const gridToggle = el('button', {
      className: 'dm-navbar__btn dm-navbar__grid-btn',
      id: 'dm-grid-toggle',
      title: 'Toggle grid density',
      type: 'button',
    });
    gridToggle.appendChild(svgIcon('grid4'));
    right.appendChild(gridToggle);

    // Mobile hamburger
    const mobileMenu = el('button', {
      className: 'dm-navbar__btn dm-navbar__menu-btn',
      id: 'dm-mobile-menu-btn',
      type: 'button',
      title: 'Menu',
    });
    mobileMenu.appendChild(svgIcon('menu'));
    right.appendChild(mobileMenu);

    nav.appendChild(left);
    nav.appendChild(center);
    nav.appendChild(right);

    // Mobile dropdown menu
    const mobileNav = el('div', { className: 'dm-mobile-nav', id: 'dm-mobile-nav' });
    navLinks.forEach(link => {
      const a = el('a', { href: link.href, className: 'dm-mobile-nav__link' });
      a.textContent = link.text;
      mobileNav.appendChild(a);
    });
    nav.appendChild(mobileNav);

    return nav;
  }

  /* ── Category Filter Bar ─────────────────────────────────── */
  function buildCategoryBar(navLinks, currentCategory) {
    const bar = el('div', { className: 'dm-category-bar', id: 'dm-category-bar' });
    const inner = el('div', { className: 'dm-category-bar__inner' });

    // "All" chip
    const allChip = el('a', {
      href: window.location.origin + '/',
      className: `dm-chip ${!currentCategory ? 'dm-chip--active' : ''}`,
    });
    allChip.innerHTML = `${svgIcon('spark').outerHTML} All`;
    inner.appendChild(allChip);

    navLinks.forEach(link => {
      const chip = el('a', {
        href: link.href,
        className: 'dm-chip',
      });
      chip.textContent = link.text;

      // Check if this is the current category
      if (window.location.href.includes(link.href) || link.href === window.location.href) {
        chip.classList.add('dm-chip--active');
      }
      inner.appendChild(chip);
    });

    bar.appendChild(inner);
    return bar;
  }

  /* ── Page Header (category/search title) ─────────────────── */
  function buildPageHeader(text, sub) {
    const header = el('div', { className: 'dm-page-header' });
    const h1 = el('h1', { className: 'dm-page-header__title' });
    h1.textContent = text;
    header.appendChild(h1);
    if (sub) {
      const subEl = el('p', { className: 'dm-page-header__sub' });
      subEl.textContent = sub;
      header.appendChild(subEl);
    }
    return header;
  }

  /* ── Pagination ──────────────────────────────────────────── */
  function buildPagination(paginationData) {
    if (!paginationData.links.length && !paginationData.nextHref) return null;

    const pag = el('nav', { className: 'dm-pagination', 'aria-label': 'Page navigation' });

    // Previous link
    const prevLink = paginationData.links.find(l => l.text === '←' || /prev/i.test(l.text));
    if (prevLink) {
      const prev = el('a', { href: prevLink.href, className: 'dm-pag__btn dm-pag__prev' });
      prev.innerHTML = '← Previous';
      pag.appendChild(prev);
    }

    // Page number buttons
    const numbers = el('div', { className: 'dm-pag__numbers' });
    paginationData.links.forEach(link => {
      if (/^\d+$/.test(link.text)) {
        const btn = el('a', {
          href: link.href,
          className: `dm-pag__num ${parseInt(link.text) === paginationData.currentPage ? 'dm-pag__num--active' : ''}`,
        });
        btn.textContent = link.text;
        numbers.appendChild(btn);
      }
    });
    pag.appendChild(numbers);

    // Next link / Load More
    if (paginationData.nextHref) {
      const next = el('a', { href: paginationData.nextHref, className: 'dm-pag__btn dm-pag__next' });
      next.innerHTML = 'Next Page →';
      pag.appendChild(next);

      // Load more button (AJAX-style append)
      const loadMore = el('button', {
        className: 'dm-load-more',
        id: 'dm-load-more',
        type: 'button',
        'data-href': paginationData.nextHref,
      });
      loadMore.innerHTML = `<span class="dm-load-more__text">Load More</span><span class="dm-load-more__spinner"></span>`;
      pag.appendChild(loadMore);
    }

    return pag;
  }

  /* ── Loading Skeleton ────────────────────────────────────── */
  function buildSkeletonGrid(count = 12, cols = 4) {
    const section = el('section', { className: 'dm-grid-section' });
    const grid = el('div', { className: 'dm-grid dm-grid--skeleton' });
    grid.style.setProperty('--dm-cols', cols);

    for (let i = 0; i < count; i++) {
      const card = el('div', { className: 'dm-card dm-card--skeleton' });
      const poster = el('div', { className: 'dm-card__img-wrapper dm-skeleton' });
      const info = el('div', { className: 'dm-card__info' });
      const t1 = el('div', { className: 'dm-skeleton dm-skeleton--text' });
      const t2 = el('div', { className: 'dm-skeleton dm-skeleton--text dm-skeleton--short' });
      info.appendChild(t1);
      info.appendChild(t2);
      card.appendChild(poster);
      card.appendChild(info);
      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  /* ── Empty State ─────────────────────────────────────────── */
  function buildEmptyState(message = 'No movies found') {
    const empty = el('div', { className: 'dm-empty' });
    empty.appendChild(svgIcon('film'));
    const msg = el('p', { className: 'dm-empty__msg' });
    msg.textContent = message;
    empty.appendChild(msg);
    return empty;
  }

  /* ── Full App Shell ──────────────────────────────────────── */
  function buildShell({ posts, navLinks, pagination, siteLogo, pageType, pageTitle, settings }) {
    // Create the root app container
    const app = el('div', { className: 'dm-app', id: 'dm-app' });

    // 1. Navbar
    app.appendChild(buildNavbar(navLinks, siteLogo));

    // 2. Category filter bar
    app.appendChild(buildCategoryBar(navLinks));

    // 3. Main content area
    const main = el('main', { className: 'dm-main', id: 'dm-main' });

    // Page header for non-home pages
    if (pageType === 'category') {
      const catTitle = document.querySelector('.category-title, .archive-title, .page-header h1, h1.entry-title');
      const titleText = catTitle ? catTitle.textContent.trim() : pageTitle || 'Movies';
      main.appendChild(buildPageHeader(titleText, `${posts.length} titles found`));
    } else if (pageType === 'search') {
      const q = new URLSearchParams(window.location.search).get('s') || '';
      main.appendChild(buildPageHeader(
        q ? `Search: "${q}"` : 'Search Results',
        `${posts.length} results found`
      ));
    } else if (pageType === 'archive') {
      main.appendChild(buildPageHeader(pageTitle || 'Archive', `${posts.length} titles`));
    }

    // Grid (or skeleton placeholder)
    if (posts.length === 0) {
      main.appendChild(buildEmptyState('No titles found on this page.'));
    } else {
      main.appendChild(buildGrid(posts, settings));
    }

    // Pagination
    if (pagination) {
      const pagEl = buildPagination(pagination);
      if (pagEl) main.appendChild(pagEl);
    }

    app.appendChild(main);

    // Footer
    const footer = el('footer', { className: 'dm-footer' });
    footer.innerHTML = `
      <div class="dm-footer__inner">
        <div class="dm-footer__brand">
          <span class="dm-logo__desire">Desire</span><span class="dm-logo__movies">Movies</span>
          <span class="dm-footer__tag">Reimagined</span>
        </div>
        <p class="dm-footer__note">UI redesigned by DesireMovies Reimagined Chrome Extension. All content belongs to the original site.</p>
      </div>
    `;
    app.appendChild(footer);

    return app;
  }

  /* ── Grid Column Toggle ──────────────────────────────────── */
  function updateGridCols(cols) {
    const grid = document.querySelector('.dm-grid');
    if (grid) {
      grid.dataset.cols = cols;
      grid.style.setProperty('--dm-cols', cols);
    }
  }

  return {
    buildShell,
    buildCard,
    buildGrid,
    buildNavbar,
    buildCategoryBar,
    buildPagination,
    buildSkeletonGrid,
    buildEmptyState,
    updateGridCols,
    buildPageHeader,
  };
})();
