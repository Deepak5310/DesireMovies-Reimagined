/**
 * content.js — Main Orchestrator
 * DesireMovies Reimagined Chrome Extension
 *
 * Entry point: extracts site content, builds new UI, manages lifecycle.
 * All modules are loaded before this file by the manifest.
 */

(async function () {
  'use strict';

  /* ── Guard: only run on desiremovies sites ───────────────── */
  const hostname = window.location.hostname.toLowerCase();
  const title    = document.title.toLowerCase();
  const ogSite   = document.querySelector('meta[property="og:site_name"]')?.content?.toLowerCase() || '';

  const isDesiremovies =
    hostname.includes('desiremovie') ||
    title.includes('desiremovie') ||
    ogSite.includes('desiremovie');

  if (!isDesiremovies) return;

  /* ── Skip redesign on single post pages (keep original for download links) ── */
  const pageType = DMParser.detectPageType();
  if (pageType === 'single' || pageType === 'page') {
    // On single post: just apply dark theme + hide ads, don't rebuild layout
    applyMinimalSinglePageFixes();
    return;
  }

  /* ── Load user settings ──────────────────────────────────── */
  const settings = await DMStorage.getAll();

  /* ── Extract data FIRST (WP DOM still visible) ───────────── */
  const posts      = DMParser.extractPosts();
  const navLinks   = DMParser.extractNavLinks();
  const pagination = DMParser.extractPagination();
  const siteLogo   = DMParser.extractSiteLogo();
  const pageTitle  = document.querySelector('h1, .archive-title, .category-title, .page-title')?.textContent?.trim() || '';

  /* ── Now hide original content & show skeleton ───────────── */
  hideOriginalContent();
  const skeleton = DMRenderer.buildSkeletonGrid(12, settings.gridColumns);
  document.body.appendChild(skeleton);

  /* ── Small delay so skeleton paints, then swap in real UI ── */
  await new Promise(r => setTimeout(r, 80));
  skeleton.remove();

  /* ── Build & inject new UI shell ────────────────────────── */
  const app = DMRenderer.buildShell({
    posts,
    navLinks,
    pagination,
    siteLogo,
    pageType,
    pageTitle,
    settings,
  });

  document.body.appendChild(app);
  // ⚠️ CRITICAL: remove dm-loading BEFORE adding dm-reimagined
  // otherwise body.dm-loading CSS rule keeps #dm-app display:none
  document.body.classList.remove('dm-loading');
  document.body.classList.add('dm-reimagined');

  /* ── Wire up search ──────────────────────────────────────── */
  DMSearch.init(navLinks);

  /* ── Wire up grid toggle button ──────────────────────────── */
  initGridToggle(settings);

  /* ── Wire up mobile menu ─────────────────────────────────── */
  initMobileMenu();

  /* ── Wire up Load More button ────────────────────────────── */
  initLoadMore();

  /* ── Suppress ad elements ────────────────────────────────── */
  if (settings.hideAds) suppressAds();

  /* ── Start mutation observer for lazy-loaded content ─────── */
  DMObserver.init((newPosts) => {
    const grid = document.querySelector('.dm-grid');
    if (!grid || newPosts.length === 0) return;
    newPosts.forEach(post => {
      const card = DMRenderer.buildCard(post, settings.showBadges !== false);
      grid.appendChild(card);
      // Animate new card in
      requestAnimationFrame(() => card.classList.add('dm-card--visible'));
    });
  });

  /* ── Register all rendered cards with observer ───────────── */
  posts.forEach(p => DMObserver.registerPost(p.id));

  /* ── Animate cards in ────────────────────────────────────── */
  animateCardsIn();

  // ══════════════════════════════════════════════════════════
  //  HELPER FUNCTIONS
  // ══════════════════════════════════════════════════════════

  /* ── Hide original WordPress content ────────────────────── */
  function hideOriginalContent() {
    document.body.classList.add('dm-loading');

    // Directly hide all WP structural elements with inline styles
    // (inline styles beat any stylesheet, including the site's own CSS)
    const toHide = [
      '#mh-header', '.mh-header-inner',
      '#mh-navigation', '.mh-navigation', '.mh-main-nav-search',
      '#mh-content-row', '.mh-content-row',
      '#mh-sidebar', '.mh-sidebar',
      '#mh-content', '.mh-content-main',
      '#mh-footer', '.mh-footer',
      '.mh-paging',
      // Generic WP
      '#masthead', '#site-header', '#primary-menu',
      '#content', '#primary', '#secondary', '#colophon',
      '.site-header', '.site-footer',
      '.navigation', '.main-navigation',
      // Theme root containers
      '.mh-container-outer', '.mh-container',
    ];

    const HIDE = 'display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;height:0!important;overflow:hidden!important;';
    for (const sel of toHide) {
      document.querySelectorAll(sel).forEach(el => {
        el.dataset.dmHidden = '1';
        el.style.cssText = HIDE;
      });
    }

    // Also hide every direct body child that isn't a script/style
    // This is the nuclear option — catches any WP wrapper not listed above
    for (const child of document.body.children) {
      if (['SCRIPT','STYLE','LINK','META','NOSCRIPT'].includes(child.tagName)) continue;
      if (child.id === 'dm-app' || child.classList.contains('dm-grid-section')) continue;
      child.style.cssText = HIDE;
    }

    suppressAds();
  }

  /* ── Ad suppression ──────────────────────────────────────── */
  function suppressAds() {
    const adSelectors = [
      '.ai-viewports',
      'ins',
      '.adsbygoogle',
      '[id*="google_ads"]',
      '[class*="ad-slot"]',
      '[class*="ad-wrap"]',
      '[id*="AdSense"]',
      '.banner-ad',
      '.mh-ads',
      '[data-ad]',
      'iframe[src*="ads"]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]',
    ];
    for (const sel of adSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        el.style.cssText = 'display:none!important';
      });
    }
  }

  /* ── Grid column toggle ──────────────────────────────────── */
  function initGridToggle(settings) {
    const btn = document.querySelector('#dm-grid-toggle');
    if (!btn) return;

    const steps = [3, 4, 5];
    let currentIdx = steps.indexOf(settings.gridColumns);
    if (currentIdx === -1) currentIdx = 1; // default 4

    btn.addEventListener('click', async () => {
      currentIdx = (currentIdx + 1) % steps.length;
      const newCols = steps[currentIdx];
      DMRenderer.updateGridCols(newCols);
      await DMStorage.set('gridColumns', newCols);

      // Visual feedback on button
      btn.classList.add('dm-navbar__btn--active');
      setTimeout(() => btn.classList.remove('dm-navbar__btn--active'), 300);
    });
  }

  /* ── Mobile menu toggle ──────────────────────────────────── */
  function initMobileMenu() {
    const btn    = document.querySelector('#dm-mobile-menu-btn');
    const mobileNav = document.querySelector('#dm-mobile-nav');
    if (!btn || !mobileNav) return;

    btn.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('dm-mobile-nav--open');
      btn.classList.toggle('dm-navbar__btn--active', isOpen);
    });

    // Close when clicking a link
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileNav.classList.remove('dm-mobile-nav--open');
        btn.classList.remove('dm-navbar__btn--active');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('dm-mobile-nav--open');
        btn.classList.remove('dm-navbar__btn--active');
      }
    });
  }

  /* ── Load More (AJAX next page fetch) ────────────────────── */
  function initLoadMore() {
    const btn = document.querySelector('#dm-load-more');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const nextHref = btn.dataset.href;
      if (!nextHref) return;

      btn.classList.add('dm-load-more--loading');
      btn.querySelector('.dm-load-more__text').textContent = 'Loading…';

      try {
        const res = await fetch(nextHref, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Network error');
        const html = await res.text();

        // Parse the fetched HTML
        const parser = new DOMParser();
        const doc    = parser.parseFromString(html, 'text/html');

        // Extract posts from the fetched page using same selectors
        const articleSelectors = [
          'article.post',
          'article.type-post',
          'article[id^="post-"]',
          '.mh-posts article',
        ];
        let newArticles = [];
        for (const sel of articleSelectors) {
          newArticles = [...doc.querySelectorAll(sel)];
          if (newArticles.length > 0) break;
        }

        // Re-use parser on each article (they're now detached elements)
        const grid = document.querySelector('.dm-grid');
        if (!grid) return;

        let addedCount = 0;
        newArticles.forEach((article, i) => {
          // Temporarily attach to our doc so parser can work
          document.body.appendChild(article);
          const rawTitle  = DMParser.parseTitle(article.querySelector?.('.entry-title')?.textContent?.trim() || '');
          article.remove();

          // Build a minimal post object from the fetched article
          const titleEl   = doc.querySelector(`#${article.id} .entry-title a, #${article.id} h2.entry-title a, #${article.id} h3.entry-title a`);
          const imgEl     = doc.querySelector(`#${article.id} img`);
          const link      = titleEl?.href || '';
          const rawTitleText = titleEl?.textContent?.trim() || '';

          if (!link || !rawTitleText) return;

          const parsed = DMParser.parseTitle(rawTitleText);
          const post = {
            id: article.id || `dm-load-${Date.now()}-${i}`,
            rawTitle: rawTitleText,
            ...parsed,
            thumbnail: imgEl?.src || imgEl?.dataset?.src || '',
            link,
            category: null,
            date: '',
          };

          const card = DMRenderer.buildCard(post, settings.showBadges !== false);
          card.style.opacity = '0';
          card.style.transform = 'translateY(20px)';
          grid.appendChild(card);
          addedCount++;

          // Staggered animation
          setTimeout(() => {
            card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          }, i * 40);
        });

        // Update the Load More button with new next page URL
        const nextPagination = DMParser.extractPaginationFromDoc(doc);
        if (nextPagination?.nextHref) {
          btn.dataset.href = nextPagination.nextHref;
          btn.querySelector('.dm-load-more__text').textContent = 'Load More';
          btn.classList.remove('dm-load-more--loading');
        } else {
          // No more pages
          btn.parentElement?.removeChild(btn);
        }

        if (addedCount === 0) {
          btn.parentElement?.removeChild(btn);
        }

      } catch (err) {
        console.warn('[DM Reimagined] Load more failed:', err);
        btn.querySelector('.dm-load-more__text').textContent = 'Load More';
        btn.classList.remove('dm-load-more--loading');
      }
    });
  }

  /* ── Animate cards in with stagger ──────────────────────── */
  function animateCardsIn() {
    const cards = document.querySelectorAll('.dm-card');
    cards.forEach((card, i) => {
      card.style.animationDelay = `${Math.min(i * 30, 600)}ms`;
      card.classList.add('dm-card--animate');
    });
  }

  /* ── Minimal fixes for single post pages ────────────────── */
  function applyMinimalSinglePageFixes() {
    document.documentElement.setAttribute('data-dm-single', 'true');
    suppressAds();

    // Inject minimal dark stylesheet override for readability on single pages
    const style = document.createElement('style');
    style.id = 'dm-single-fix';
    style.textContent = `
      body { background: #0d1117 !important; color: #e6edf3 !important; }
      .mh-header-inner, #mh-header { background: #0d1117 !important; }
      .mh-navigation, #mh-navigation { background: #161b22 !important; }
      #mh-sidebar { display: none !important; }
      #mh-content { max-width: 860px; margin: 0 auto; float: none !important; width: 100% !important; }
      .entry-title { color: #e6edf3 !important; }
      .entry-content { color: #c9d1d9 !important; }
      a { color: #ff6b35 !important; }
      ins, .adsbygoogle, [id*="google_ads"], .ai-viewports { display: none !important; }
    `;
    document.head.appendChild(style);
  }

})();
