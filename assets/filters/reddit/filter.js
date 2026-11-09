(function() {
  'use strict';
  if (!/reddit\.com$/i.test(window.location.hostname)) return;
  // Re-entry guard. See instagram/filter.js for rationale.
  if (window.__dullPlatformInit_reddit) return;
  var cfg = window.__dullConfig || {};
  /* Dull's own copy on the page, in the app's language: FilterService
     passes it in cfg.strings, keyed like Localizable.xcstrings. Any key it
     does not pass, and every key on Android, which shares this file, keeps
     the English here. */
  var strings = cfg.strings || {};
  function copy(key, english) {
    var value = strings[key];
    return typeof value === 'string' && value ? value : english;
  }
  var processed = new WeakSet();
  var __dullBlockedCount = 0;
  var __dullCountPending = false;

  /* Query only the subtree that changed during infinite scroll. A document-wide
     query is still used for the initial pass and SPA navigation, but lazy feed
     appends must not rescan every post already on screen. */
  function matchingWithin(root, selector) {
    if (!root || root === document) return document.querySelectorAll(selector);
    if (root.nodeType !== 1) return [];
    var matches = [];
    if (root.matches && root.matches(selector)) matches.push(root);
    var descendants = root.querySelectorAll(selector);
    for (var i = 0; i < descendants.length; i++) matches.push(descendants[i]);
    return matches;
  }

  function reportCount() {
    if (__dullCountPending) return;
    __dullCountPending = true;
    setTimeout(function() {
      __dullCountPending = false;
      try { window.webkit.messageHandlers.dullFilterCount.postMessage({ platform: 'reddit', count: __dullBlockedCount }); } catch(e) {}
    }, 500);
  }

  function collapseElement(el) {
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();
    var s = el.style;
    s.setProperty('height', '0', 'important');
    s.setProperty('min-height', '0', 'important');
    s.setProperty('max-height', '0', 'important');
    s.setProperty('overflow', 'hidden', 'important');
    s.setProperty('padding', '0', 'important');
    s.setProperty('margin', '0', 'important');
    s.setProperty('border', '0', 'important');
    s.setProperty('visibility', 'hidden', 'important');
    s.setProperty('opacity', '0', 'important');
    s.setProperty('pointer-events', 'none', 'important');
  }

  function hideEl(el) {
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();
    el.style.setProperty('display', 'none', 'important');
  }

  /* --- Critical: Promoted/ad posts via shreddit web components --- */
  function hidePromotedPosts(root) {
    if (!cfg.ads) return;
    var adEls = matchingWithin(root,
      'shreddit-ad-post, shreddit-sidebar-ad, shreddit-comments-page-ad, ' +
      'shreddit-comment-tree-ad, shreddit-dynamic-ad-link, shreddit-brand-affiliate-tag'
    );
    for (var i = 0; i < adEls.length; i++) hideEl(adEls[i]);
    /* Async loader ads */
    var asyncAds = matchingWithin(root,
      'shreddit-async-loader[bundlename="sidebar_ad"], ' +
      'shreddit-async-loader[bundlename="feed_announcement"]'
    );
    for (var j = 0; j < asyncAds.length; j++) hideEl(asyncAds[j]);
    /* data-before-content="advertisement" containers */
    var adContainers = matchingWithin(root, 'div[data-before-content="advertisement"]');
    for (var k = 0; k < adContainers.length; k++) {
      var container = adContainers[k];
      for (var w = 0; w < 3; w++) {
        if (!container.parentElement || container.parentElement === document.body) break;
        container = container.parentElement;
      }
      collapseElement(container);
    }
  }

  /* --- Critical: text-based promoted detection (fallback for non-shreddit layouts) --- */
  function hideTextBasedPromoted(root) {
    if (!cfg.ads) return;
    var posts = matchingWithin(root, 'shreddit-post[promoted], [class*="promotedlink"]');
    for (var i = 0; i < posts.length; i++) {
      var article = posts[i].closest('article') || posts[i];
      collapseElement(article);
    }
  }

  /* --- Critical: Recommended/suggested posts (algorithmic injection) --- */
  function hideRecommendedPosts(root) {
    if (!cfg.suggested) return;
    /* Posts with recommendation attributes */
    var recPosts = matchingWithin(root,
      'shreddit-post[recommendation-subreddit-name], shreddit-post[recommendation-source]'
    );
    for (var i = 0; i < recPosts.length; i++) {
      var article = recPosts[i].closest('article') || recPosts[i];
      collapseElement(article);
    }
    /* Posts with Join button AND recommendation attributes = algorithmic suggestions.
       Join button alone is not enough — guests see join buttons on ALL posts. */
    var joinPosts = matchingWithin(root, 'article');
    for (var j = 0; j < joinPosts.length; j++) {
      if (processed.has(joinPosts[j])) continue;
      var post = joinPosts[j].querySelector('shreddit-post');
      if (post && joinPosts[j].querySelector('shreddit-join-button') &&
          (post.hasAttribute('recommendation-source') || post.hasAttribute('recommendation-subreddit-name'))) {
        collapseElement(joinPosts[j]);
      }
    }
  }

  /* --- Critical: Popular/All tab hiding + redirect --- */
  var lastRedirectedPath = '';
  function hidePopularAllTabs(root) {
    if (!cfg.popular) return;
    var links = matchingWithin(root,
      'a[href="/r/popular/"], a[href="/r/popular"], a[href="/r/all/"], ' +
      'a[href="/r/all"], a[href="/explore/"], a[href="/explore"], ' +
      'a[href="/news/"], a[href="/news"]'
    );
    for (var i = 0; i < links.length; i++) {
      var navItem = links[i].closest('li') || links[i].closest('div[role="listitem"]') || links[i];
      hideEl(navItem);
    }
    /* Hide left-nav-top-section (contains Popular/Explore/News) */
    var leftNav = matchingWithin(root, 'left-nav-top-section');
    for (var k = 0; k < leftNav.length; k++) hideEl(leftNav[k]);
    /* Redirect from Popular/All/Explore to home (once per path) */
    var path = window.location.pathname.toLowerCase();
    if (path === lastRedirectedPath) return;
    /* /news is Reddit's algorithmic news feed, not r/news. */
    if (path.startsWith('/r/popular') || path.startsWith('/r/all') || path.startsWith('/explore') ||
        /^\/news(?:\/|$)/.test(path)) {
      lastRedirectedPath = path;
      window.location.replace('/');
    }
  }

  /* --- Critical: signed-out home ---
     Signed out, Reddit serves its home page as the Popular feed
     (pagetype="popular"), so the popular group's CSS hides the whole feed and
     its redirect lands on the same page. Say why and offer the log-in in the
     feed's place, so the page isn't left blank. Reddit's own sign-in check is
     the user-logged-in attribute on shreddit-app. */
  var SIGNED_OUT_HOME_ID = 'dull-reddit-signed-out-home';
  function showSignedOutHomePrompt() {
    var existing = document.getElementById(SIGNED_OUT_HOME_ID);
    var app = cfg.popular && document.querySelector('shreddit-app');
    var feed = app && !app.hasAttribute('user-logged-in') &&
      app.getAttribute('pagetype') === 'popular' && app.querySelector('.main-container');
    if (!feed) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.nextElementSibling === feed) return;
    if (existing) existing.remove();

    var box = document.createElement('div');
    box.id = SIGNED_OUT_HOME_ID;
    box.style.cssText = 'padding:48px 24px;text-align:center;' +
      'color:var(--color-neutral-content-strong, inherit);';
    var title = document.createElement('p');
    title.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:600;';
    title.textContent = copy('redditFilter.signedOutHome.title', 'log in to see your communities.');
    var detail = document.createElement('p');
    detail.style.cssText = 'margin:0 auto 20px;max-width:320px;font-size:14px;line-height:1.4;' +
      'color:var(--color-neutral-content-weak, inherit);';
    detail.textContent = copy('redditFilter.signedOutHome.detail',
      'dull hides reddit\'s popular feed, and signed out, that\'s all reddit\'s home shows. log in and home shows the communities you follow, or search for one above.');
    var login = document.createElement('a');
    login.href = '/login/';
    login.style.cssText = 'display:inline-block;padding:10px 20px;border-radius:999px;' +
      'font-size:14px;font-weight:600;text-decoration:none;' +
      'background:var(--color-brand-background, #d93900);color:var(--color-global-white, #fff);';
    login.textContent = copy('redditFilter.signedOutHome.login', 'log in to reddit');
    box.appendChild(title);
    box.appendChild(detail);
    box.appendChild(login);
    feed.parentNode.insertBefore(box, feed);
  }

  /* --- Deferred: Suggested communities and engagement bait --- */
  function hideSuggestedContent(root) {
    if (!cfg.suggested) return;
    var els = matchingWithin(root,
      'community-highlight-carousel, recent-posts, ' +
      '[aria-label="Popular Communities"], ' +
      'faceplate-tracker[noun="games_drawer"], ' +
      'faceplate-tracker[noun="discovery_unit"], ' +
      'shreddit-async-loader[bundlename="community_recs"], ' +
      'shreddit-async-loader[bundlename="onboarding_recs"], ' +
      'shreddit-async-loader[bundlename="trending_carousel"], ' +
      'chat-channel-recommendations-wrapper'
    );
    for (var i = 0; i < els.length; i++) hideEl(els[i]);
    /* Text-based headings: "Because you visited", "Suggested for you", etc. */
    var headings = matchingWithin(root, 'h2, h3, [role="heading"]');
    for (var j = 0; j < headings.length; j++) {
      var heading = headings[j];
      if (processed.has(heading)) continue;
      var text = (heading.textContent || '').toLowerCase().trim();
      if (text.includes('because you visited') || text.includes('communities you may like') ||
          text.includes('suggested for you') || text.includes('popular communities') ||
          text.includes('trending today') || text.includes('similar to')) {
        processed.add(heading);
        var section = heading.closest('section') || heading.closest('div[data-testid]');
        if (section) { collapseElement(section); }
        else { collapseElement(heading); }
      }
    }
  }

  /* --- Deferred: Open in App banners (always on — functional) --- */
  function hideOpenInAppBanners(root) {
    var overlays = matchingWithin(root,
      'shreddit-experience-tree, ' +
      'shreddit-async-loader[bundlename="xpromo_nsfw_blocking_modal"]'
    );
    for (var i = 0; i < overlays.length; i++) hideEl(overlays[i]);
    /* Reddit's blocking app wall for signed-out visitors ("Get the app to
       keep using Reddit"), shown after 30 s on a feed. It has no close
       button: <configured-xpromo-modal> portals a full-page sheet into
       div.configured-xpromo and locks body scrolling. CSS hides the sheet;
       dismissing it through Reddit's own event also lifts the scroll lock and
       focus trap. Dispatch when the sheet is attached, i.e. open, because a
       dismiss before Reddit opens it does not stop the opening. */
    if (matchingWithin(root, '.configured-xpromo').length) {
      var walls = document.querySelectorAll('configured-xpromo-modal');
      for (var w = 0; w < walls.length; w++) {
        walls[w].dispatchEvent(new CustomEvent('dismiss-configured-xpromo', { bubbles: true }));
      }
    }
    /* Selectively hide #bottom-sheet only when it contains app-promo, not login/settings */
    var bottomSheet = document.getElementById('bottom-sheet');
    if (bottomSheet && !processed.has(bottomSheet)) {
      var sheetText = (bottomSheet.textContent || '').toLowerCase();
      if ((sheetText.includes('get the app') || sheetText.includes('open in app') ||
           sheetText.includes('continue in app') || sheetText.includes('reddit app')) &&
          !sheetText.includes('log in') && !sheetText.includes('sign up')) {
        hideEl(bottomSheet);
      }
    }
    /* "Open App" header button */
    var appLinks = matchingWithin(root, 'a');
    for (var a = 0; a < appLinks.length; a++) {
      var link = appLinks[a];
      if (processed.has(link)) continue;
      var linkText = (link.textContent || '').trim().toLowerCase();
      if (linkText === 'open app' || linkText === 'use app' || linkText === 'get the app' || linkText === 'open') {
        /* For "Open" buttons, walk up to find the banner container */
        if (linkText === 'open') {
          var bar = link.closest('xpromo-app-selector') || link.closest('div[style*="position: fixed"]') || link.closest('div[style*="position: sticky"]');
          if (bar && !processed.has(bar)) { hideEl(bar); continue; }
        }
        hideEl(link);
      }
    }
    /* Dialog-based app promos */
    var dialogs = matchingWithin(root, 'div[role="dialog"], div[role="banner"]');
    for (var j = 0; j < dialogs.length; j++) {
      var el = dialogs[j];
      if (processed.has(el)) continue;
      var text = (el.textContent || '').toLowerCase();
      if (text.includes('get the app') || text.includes('open in app') ||
          text.includes('use app') || text.includes('continue in app') || text.includes('reddit app')) {
        hideEl(el);
      }
    }
    /* Unlock body scroll if dialog hidden */
    if (document.body && document.body.style.overflow === 'hidden') {
      var hasVisible = false;
      var allDialogs = document.querySelectorAll('div[role="dialog"]');
      for (var k = 0; k < allDialogs.length; k++) {
        if (allDialogs[k].style.display !== 'none') { hasVisible = true; break; }
      }
      if (!hasVisible) document.body.style.overflow = '';
    }
  }

  /* --- Critical: Google One Tap nag (always on — functional) ---
     The "Sign in to Reddit with Google" One Tap prompt that Google Identity
     Services drops on the feed. In an embedded WKWebView (no FedCM) it renders
     as the legacy iframe prompt — `#credential_picker_container` wrapping an
     `accounts.google.com/gsi/iframe` iframe. Hide it. This is NOT the in-app
     "Continue with Google" button on the login screen — that's a separate
     `gsi/button` iframe and is left fully working. */
  function hideGoogleOneTap(root) {
    var els = matchingWithin(root,
      '#credential_picker_container, #credential_picker_iframe, ' +
      'iframe[src*="accounts.google.com/gsi/iframe"], ' +
      'iframe[title="Sign in with Google Dialog"]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (processed.has(el)) continue;
      /* For a bare iframe match, hide its positioned container (the prompt
         wrapper / backdrop) rather than just the iframe. */
      var target = el;
      if (el.tagName === 'IFRAME') {
        var anc = el;
        for (var h = 0; h < 4; h++) {
          var p = anc.parentElement;
          if (!p || p === document.body) break;
          var pos = window.getComputedStyle(p).position;
          anc = p;
          if (pos === 'fixed' || pos === 'absolute') break;
        }
        target = anc;
      }
      hideEl(target);
    }
  }

  function processCritical(root) {
    root = root || document;
    hidePromotedPosts(root);
    hideRecommendedPosts(root);
    hidePopularAllTabs(root);
    showSignedOutHomePrompt();
    hideGoogleOneTap(root);
  }

  function processDeferred(root) {
    root = root || document;
    hideTextBasedPromoted(root);
    hideSuggestedContent(root);
    hideOpenInAppBanners(root);
  }

  function scheduleDeferred(roots) {
    var scanRoots = roots && roots.length ? roots.slice() : [document];
    var run = function() {
      for (var i = 0; i < scanRoots.length; i++) {
        try { processDeferred(scanRoots[i]); } catch(e) {}
      }
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 100);
    }
  }

  try { processCritical(); } catch(e) {}
  scheduleDeferred();

  /* --- MutationObserver with queued, subtree-scoped rAF processing --- */
  var rafPending = false;
  var pendingMutationRoots = [];

  function scanRootFor(node, fallback) {
    var el = node && node.nodeType === 1 ? node : fallback;
    if (!el || el.nodeType !== 1) return null;
    return el.closest && el.closest('article') || el;
  }

  function queueMutationRoot(root) {
    if (!root) return;
    for (var i = pendingMutationRoots.length - 1; i >= 0; i--) {
      var queued = pendingMutationRoots[i];
      if (queued === root || queued.contains(root)) return;
      if (root.contains(queued)) pendingMutationRoots.splice(i, 1);
    }
    pendingMutationRoots.push(root);
  }

  function scheduleMutationFlush() {
    if (rafPending || pendingMutationRoots.length === 0) return;
    rafPending = true;
    requestAnimationFrame(function() {
      rafPending = false;
      /* Keep queued roots until editing ends. This avoids the forced-layout
         keyboard dismissal that the old full-document pass could trigger. */
      if (isEditingFocused()) return;
      var roots = pendingMutationRoots.splice(0, pendingMutationRoots.length);
      for (var i = 0; i < roots.length; i++) {
        try { processCritical(roots[i]); } catch(e) {}
      }
      scheduleDeferred(roots);
    });
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      for (var j = 0; j < mutation.addedNodes.length; j++) {
        queueMutationRoot(scanRootFor(mutation.addedNodes[j], mutation.target));
      }
    }
    scheduleMutationFlush();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  /* Pause filter passes while user is typing in an input, password, OTP/2FA code,
     or contenteditable. Forced layouts (getComputedStyle/getBoundingClientRect)
     during input editing drop keyboard focus on iOS WKWebView. */
  function isEditingFocused() {
    var ae = document.activeElement;
    if (ae) {
      var tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable) return true;
    }
    var dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    for (var i = 0; i < dialogs.length; i++) {
      var dialog = dialogs[i];
      if (!dialog.querySelector('input:not([type="hidden"])')) continue;
      if (dialog.closest('[hidden], [aria-hidden="true"]')) continue;
      var dialogStyle = window.getComputedStyle(dialog);
      if (dialogStyle.display === 'none' || dialogStyle.visibility === 'hidden' ||
          dialogStyle.opacity === '0' || dialogStyle.contentVisibility === 'hidden') continue;
      return true;
    }
    var otp = document.querySelector(
      'input[autocomplete*="one-time-code"], input[inputmode="numeric"], ' +
      'input[name*="confirmationCode" i], input[name*="verificationCode" i], ' +
      'input[name*="code" i][maxlength], input[aria-label*="code" i]'
    );
    if (otp) {
      var os = window.getComputedStyle(otp);
      if (os.display !== 'none' && os.visibility !== 'hidden') return true;
    }
    return false;
  }

  window.addEventListener('dull-navigation', function() {
    if (isEditingFocused()) return;
    pendingMutationRoots.length = 0;
    lastRedirectedPath = '';  // Reset on SPA navigation so redirect works on new route
    try { processCritical(); } catch(e) {}
    scheduleDeferred();
  });
  document.addEventListener('focusout', scheduleMutationFlush, true);

  /* --- Scroll position preservation for back/forward navigation ---
     WKWebView's back-forward cache may not always restore Reddit's infinite-scroll
     state (WebSocket connections, heavy DOM). This saves scroll position to
     sessionStorage and restores it on back navigation, retrying as infinite-scroll
     loads content to reach the target offset. */
  var _dullSP = '__dull_sp_';
  function _dullSaveScroll() {
    try { sessionStorage.setItem(_dullSP + window.location.pathname, String(window.scrollY)); } catch(e) {}
  }
  function _dullRestoreScroll() {
    try {
      var raw = sessionStorage.getItem(_dullSP + window.location.pathname);
      if (!raw) return;
      var targetY = parseInt(raw, 10);
      if (!targetY || targetY <= 0) return;
      sessionStorage.removeItem(_dullSP + window.location.pathname);
      var attempts = 0;
      var lastScrollY = -1;
      function tryScroll() {
        window.scrollTo(0, targetY);
        // Retry as infinite-scroll loads more content to reach target offset.
        // Stop early if scrollY didn't change (page is shorter than target).
        if (Math.abs(window.scrollY - targetY) > 50 && attempts++ < 30) {
          if (window.scrollY === lastScrollY) return; // page can't scroll further
          lastScrollY = window.scrollY;
          setTimeout(tryScroll, 200);
        }
      }
      setTimeout(tryScroll, 100);
    } catch(e) {}
  }
  // Debounced save during scroll (passive — no jank)
  var _dullScrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(_dullScrollTimer);
    _dullScrollTimer = setTimeout(_dullSaveScroll, 300);
  }, { passive: true });
  // Save on page unload (belt-and-suspenders with scroll debounce)
  window.addEventListener('pagehide', _dullSaveScroll);
  // Restore on fresh back/forward loads (when bfcache doesn't activate)
  window.addEventListener('pageshow', function(e) {
    if (!e.persisted) {
      try {
        var nav = performance.getEntriesByType('navigation');
        if (nav.length && nav[0].type === 'back_forward') _dullRestoreScroll();
      } catch(err) {}
    }
  });
  // Restore on SPA back/forward (History API popstate)
  window.addEventListener('popstate', function() { setTimeout(_dullRestoreScroll, 50); });

  setInterval(function() {
    if (isEditingFocused()) return;
    if (!document.getElementById('dull-filter')) {
      try { window.webkit.messageHandlers.dullReinject.postMessage({ platform: 'reddit', reason: 'css_missing_periodic' }); } catch(e) {}
    }
  }, 30000);

  window.__dullPlatformInit_reddit = true;
})();
