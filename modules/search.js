/**
 * search.js — Full-Screen Search Overlay
 *
 * Intercepts the native WordPress search form and replaces it with a
 * beautiful full-screen overlay with keyboard navigation support.
 */

window.DMSearch = (() => {

  let overlay = null;
  let input = null;
  let isOpen = false;

  /* ── Build Overlay DOM ───────────────────────────────────── */
  function build() {
    overlay = document.createElement('div');
    overlay.id = 'dm-search-overlay';
    overlay.className = 'dm-search-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search movies');

    overlay.innerHTML = `
      <div class="dm-search-backdrop" id="dm-search-backdrop"></div>
      <div class="dm-search-modal">
        <div class="dm-search-header">
          <div class="dm-search-icon-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </div>
          <input
            type="text"
            id="dm-search-input"
            class="dm-search-input"
            placeholder="Search movies, shows, actors…"
            autocomplete="off"
            spellcheck="false"
            autofocus
          />
          <div class="dm-search-shortcut">
            <kbd>ESC</kbd>
          </div>
          <button type="button" class="dm-search-close" id="dm-search-close" aria-label="Close search">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="dm-search-divider"></div>
        <div class="dm-search-body" id="dm-search-body">
          <div class="dm-search-hint">
            <span class="dm-search-hint__icon">🔥</span>
            <span>Type to search across all movies, shows, and web series</span>
          </div>
          <div class="dm-search-quick" id="dm-search-quick">
            <p class="dm-search-quick__label">Quick Categories</p>
            <div class="dm-search-quick__chips" id="dm-quick-chips">
              <!-- populated from nav links -->
            </div>
          </div>
        </div>
        <div class="dm-search-footer">
          <span class="dm-search-footer__tip"><kbd>↵</kbd> Search &nbsp;·&nbsp; <kbd>ESC</kbd> Close</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    input = overlay.querySelector('#dm-search-input');

    // Event listeners
    overlay.querySelector('#dm-search-backdrop').addEventListener('click', close);
    overlay.querySelector('#dm-search-close').addEventListener('click', close);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit(input.value.trim());
      }
      if (e.key === 'Escape') close();
    });

    // Live filter within current page
    input.addEventListener('input', () => {
      liveFilter(input.value.trim());
    });
  }

  /* ── Quick Category Chips ────────────────────────────────── */
  function populateQuickChips(navLinks) {
    const container = document.querySelector('#dm-quick-chips');
    if (!container) return;
    (navLinks || []).slice(0, 10).forEach(link => {
      const chip = document.createElement('a');
      chip.href = link.href;
      chip.className = 'dm-chip dm-chip--sm';
      chip.textContent = link.text;
      chip.addEventListener('click', () => close());
      container.appendChild(chip);
    });
  }

  /* ── Live Filter ─────────────────────────────────────────── */
  let filterTimeout = null;
  function liveFilter(query) {
    clearTimeout(filterTimeout);
    if (!query) {
      // Restore all cards
      document.querySelectorAll('.dm-card').forEach(c => {
        c.style.display = '';
        c.classList.remove('dm-card--hidden');
      });
      showSearchHint();
      return;
    }

    filterTimeout = setTimeout(() => {
      const q = query.toLowerCase();
      const cards = document.querySelectorAll('.dm-card');
      let found = 0;

      cards.forEach(card => {
        const titleEl = card.querySelector('.dm-card__title-link, .dm-card__overlay-title');
        const title = titleEl ? titleEl.textContent.toLowerCase() : '';
        const cat = (card.dataset.category || '').toLowerCase();
        const matches = title.includes(q) || cat.includes(q);

        if (matches) {
          card.style.display = '';
          card.classList.remove('dm-card--hidden');
          found++;
        } else {
          card.style.display = 'none';
          card.classList.add('dm-card--hidden');
        }
      });

      showResultCount(found, query);
    }, 200);
  }

  function showSearchHint() {
    const body = document.querySelector('#dm-search-body');
    if (!body) return;
    const hint = body.querySelector('.dm-search-hint');
    const quick = body.querySelector('#dm-search-quick');
    const counter = body.querySelector('.dm-search-counter');
    if (hint) hint.style.display = '';
    if (quick) quick.style.display = '';
    if (counter) counter.remove();
  }

  function showResultCount(count, query) {
    const body = document.querySelector('#dm-search-body');
    if (!body) return;
    const hint = body.querySelector('.dm-search-hint');
    const quick = body.querySelector('#dm-search-quick');
    if (hint) hint.style.display = 'none';
    if (quick) quick.style.display = 'none';

    let counter = body.querySelector('.dm-search-counter');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'dm-search-counter';
      body.appendChild(counter);
    }

    if (count === 0) {
      counter.innerHTML = `
        <div class="dm-search-noresult">
          <span class="dm-search-noresult__emoji">🎬</span>
          <p>No results for <strong>"${query}"</strong> on this page.</p>
          <p class="dm-search-noresult__sub">Press Enter to search the full site.</p>
        </div>
      `;
    } else {
      counter.innerHTML = `
        <div class="dm-search-count-badge">
          <span>${count}</span> result${count !== 1 ? 's' : ''} on this page for <strong>"${query}"</strong>
        </div>
      `;
    }
  }

  /* ── Submit (full site search) ───────────────────────────── */
  function submit(query) {
    if (!query) return;
    // Restore all cards before navigating
    document.querySelectorAll('.dm-card').forEach(c => { c.style.display = ''; });
    const url = DMParser.buildSearchUrl(query);
    window.location.href = url;
  }

  /* ── Open / Close ────────────────────────────────────────── */
  function open() {
    if (!overlay) build();
    overlay.classList.add('dm-search-overlay--open');
    document.body.classList.add('dm-search-active');
    isOpen = true;
    setTimeout(() => {
      if (input) {
        input.value = '';
        input.focus();
      }
      showSearchHint();
      // Restore any filtered cards
      document.querySelectorAll('.dm-card').forEach(c => { c.style.display = ''; });
    }, 50);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('dm-search-overlay--open');
    document.body.classList.remove('dm-search-active');
    isOpen = false;
    // Restore any filtered cards
    document.querySelectorAll('.dm-card').forEach(c => { c.style.display = ''; });
    if (filterTimeout) clearTimeout(filterTimeout);
  }

  function toggle() {
    isOpen ? close() : open();
  }

  /* ── Global Keyboard Shortcut ────────────────────────────── */
  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      // Forward slash (/) to open search (like GitHub/YouTube)
      if (e.key === '/' && !isOpen && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        open();
      }
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    });
  }

  /* ── Intercept Native WP Search ─────────────────────────── */
  function interceptNativeSearch() {
    // Hide all existing search forms and redirect their submits
    const forms = document.querySelectorAll('form[role="search"], form.search-form, .mh-search-form form, #searchform');
    forms.forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = form.querySelector('input[type="search"], input[name="s"]');
        if (q && q.value.trim()) {
          submit(q.value.trim());
        } else {
          open();
        }
      });
    });

    // Intercept search icon clicks in the original nav
    const searchToggles = document.querySelectorAll('.mh-search-btn, .search-toggle, .search-icon');
    searchToggles.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      });
    });
  }

  function init(navLinks) {
    build();
    populateQuickChips(navLinks);
    initKeyboard();
    interceptNativeSearch();

    // Wire up the navbar search button
    const searchBtn = document.querySelector('#dm-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', open);
  }

  return { init, open, close, toggle, submit };
})();
