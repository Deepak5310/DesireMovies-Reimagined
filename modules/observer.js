/**
 * observer.js — MutationObserver for DOM Changes
 *
 * Watches for new posts injected into the DOM (e.g., infinite scroll,
 * AJAX pagination, or WordPress query changes) and re-renders new cards
 * into the existing grid without a full rebuild.
 */

window.DMObserver = (() => {

  let observer = null;
  let debounceTimer = null;
  let isProcessing = false;
  let knownPostIds = new Set();

  /* ── Initialize observer ─────────────────────────────────── */
  function init(onNewPostsCallback) {
    // Track existing posts so we don't re-render them
    document.querySelectorAll('.dm-card').forEach(card => {
      if (card.dataset.id) knownPostIds.add(card.dataset.id);
    });

    // Observe the entire body for changes
    // (WP can inject posts anywhere)
    observer = new MutationObserver((mutations) => {
      let hasRelevantChange = false;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Check if it's a post article or contains post articles
          if (
            node.matches?.('article[id^="post-"], article.post, article.type-post') ||
            node.querySelector?.('article[id^="post-"], article.post, article.type-post')
          ) {
            hasRelevantChange = true;
            break;
          }
        }
        if (hasRelevantChange) break;
      }

      if (!hasRelevantChange || isProcessing) return;

      // Debounce to batch rapid DOM changes
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        handleNewContent(onNewPostsCallback);
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /* ── Handle newly injected content ──────────────────────── */
  function handleNewContent(callback) {
    isProcessing = true;
    try {
      // Extract new posts not already in our grid
      const allPosts = DMParser.extractPosts();
      const newPosts = allPosts.filter(p => {
        const id = p.id;
        if (knownPostIds.has(id)) return false;
        knownPostIds.add(id);
        return true;
      });

      if (newPosts.length > 0 && callback) {
        callback(newPosts);
      }
    } catch (err) {
      console.warn('[DMObserver] Error processing new content:', err);
    } finally {
      isProcessing = false;
    }
  }

  /* ── Disconnect ──────────────────────────────────────────── */
  function disconnect() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(debounceTimer);
  }

  /* ── Register known post ─────────────────────────────────── */
  function registerPost(id) {
    knownPostIds.add(id);
  }

  return { init, disconnect, registerPost };
})();
