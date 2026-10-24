(function() {
  'use strict';
  if (!/(?:x\.com|twitter\.com)$/i.test(window.location.hostname)) return;
  // Re-entry guard. See instagram/filter.js for rationale.
  if (window.__dullPlatformInit_x) return;
  var cfg = window.__dullConfig || {};
  var processed = new WeakSet();
  var __dullBlockedCount = 0;
  var __dullCountPending = false;

  function reportCount() {
    if (__dullCountPending) return;
    __dullCountPending = true;
    setTimeout(function() {
      __dullCountPending = false;
      try { window.webkit.messageHandlers.dullFilterCount.postMessage({ platform: 'x', count: __dullBlockedCount }); } catch(e) {}
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

  /* --- Auto-switch to Following tab on home (MutationObserver-based) --- */
  var followingTabObserver = null;
  var followingTabTimeout = null;
  var homeForYouStyleEl = null;

  /* Inject a dedicated <style> element that hides the first tab in any tablist.
     Only injected while on /home — removed on navigation away — so it cannot
     affect profile/notifications/search tablists on other pages. CSS is
     stateless so it survives React re-renders that wipe inline styles. */
  function injectHomeForYouStyle() {
    if (homeForYouStyleEl && homeForYouStyleEl.isConnected) return;
    try {
      var style = document.createElement('style');
      style.id = 'dull-x-home-foryou';
      style.textContent = 'div[role="tablist"] > div:first-child { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
      homeForYouStyleEl = style;
    } catch(e) {}
  }

  function removeHomeForYouStyle() {
    if (homeForYouStyleEl) {
      try { homeForYouStyleEl.remove(); } catch(e) {}
      homeForYouStyleEl = null;
    }
  }

  function switchToFollowingTab() {
    if (!cfg.forYou) return false;
    var path = window.location.pathname;
    if (path !== '/' && path !== '/home') {
      removeHomeForYouStyle();
      stopFollowingWatch();
      return true;
    }
    /* CSS-based hiding is persistent across React re-renders, unlike inline style */
    injectHomeForYouStyle();
    var tabs = document.querySelectorAll('div[role="tablist"] [role="tab"]');
    if (tabs.length < 2) return false; /* tabs not rendered yet */
    /* Find and click the "Following" tab by text content, not index position */
    var followingTab = null;
    for (var i = 0; i < tabs.length; i++) {
      var tabText = (tabs[i].textContent || '').toLowerCase().trim();
      if (tabText.includes('following')) { followingTab = tabs[i]; break; }
    }
    if (followingTab && followingTab.getAttribute('aria-selected') !== 'true') {
      followingTab.click();
    }
    var selected = document.querySelector('div[role="tablist"] [role="tab"][aria-selected="true"]');
    if (selected && (selected.textContent || '').toLowerCase().includes('following')) {
      stopFollowingWatch();
      return true;
    }
    return false;
  }

  function startFollowingWatch() {
    if (!cfg.forYou) return;
    stopFollowingWatch();
    /* Inject CSS immediately — hiding survives even if tabs haven't rendered yet */
    injectHomeForYouStyle();
    /* Try immediately first */
    if (switchToFollowingTab()) return;
    /* Use MutationObserver with rAF debounce to avoid synchronous DOM queries on every mutation */
    var followingRafPending = false;
    followingTabObserver = new MutationObserver(function() {
      if (followingRafPending) return;
      followingRafPending = true;
      requestAnimationFrame(function() {
        followingRafPending = false;
        try { if (switchToFollowingTab()) stopFollowingWatch(); } catch(e) {}
      });
    });
    var target = document.body || document.documentElement;
    followingTabObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    /* Safety: stop the click-to-Following observer after 10s. CSS hiding stays — it's
       tied to page URL, not this observer. */
    followingTabTimeout = setTimeout(stopFollowingWatch, 10000);
  }

  function stopFollowingWatch() {
    if (followingTabObserver) { followingTabObserver.disconnect(); followingTabObserver = null; }
    if (followingTabTimeout) { clearTimeout(followingTabTimeout); followingTabTimeout = null; }
  }

  /* --- Critical: Promoted content via data-testid (fast attribute lookup) --- */
  function hidePromotedContent() {
    if (!cfg.ads) return;
    var pixels = document.querySelectorAll('[data-testid="top-impression-pixel"]');
    for (var i = 0; i < pixels.length; i++) {
      var cell = pixels[i].closest('[data-testid="cellInnerDiv"]');
      if (cell) collapseElement(cell);
    }
    var tracking = document.querySelectorAll('[data-testid="placementTracking"]');
    for (var j = 0; j < tracking.length; j++) {
      var cell2 = tracking[j].closest('[data-testid="cellInnerDiv"]');
      if (cell2) collapseElement(cell2);
    }
  }

  /* --- Critical: Inline suggestions with UserCell --- */
  function hideUserCellSuggestions() {
    if (!cfg.suggestions) return;
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    for (var i = 0; i < cells.length; i++) {
      if (processed.has(cells[i])) continue;
      if (cells[i].querySelector('[data-testid="UserCell"]')) collapseElement(cells[i]);
    }
  }

  /* --- Critical: Grok elements --- */
  function hideGrokElements() {
    if (!cfg.grok) return;
    var grokLinks = document.querySelectorAll('a[href*="/i/grok"]');
    for (var i = 0; i < grokLinks.length; i++) {
      var navItem = grokLinks[i].closest('nav > div > div, div[role="link"], li');
      if (navItem) hideEl(navItem); else hideEl(grokLinks[i]);
    }
    var grokEls = document.querySelectorAll('[data-testid="grok"], [data-testid="grokInPost"], [data-testid="grok_compose"], [data-testid="GrokDrawer"], [aria-label*="Grok"]');
    for (var j = 0; j < grokEls.length; j++) hideEl(grokEls[j]);
  }

  /* --- Critical: Google One Tap nag (always on — functional) ---
     The "Sign in with Google" One Tap prompt that Google Identity Services drops
     on the page. In an embedded WKWebView (no FedCM) it renders as the legacy
     iframe prompt — `#credential_picker_container` wrapping an
     `accounts.google.com/gsi/iframe` iframe. Hide it. This is NOT the in-app
     "Continue with Google" button on the login screen — that's a separate
     `gsi/button` iframe and is left fully working. */
  function hideGoogleOneTap() {
    var els = document.querySelectorAll(
      '#credential_picker_container, #credential_picker_iframe, ' +
      'iframe[src*="accounts.google.com/gsi/iframe"], ' +
      'iframe[title="Sign in with Google Dialog"]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (processed.has(el)) continue;
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

  function processCritical() {
    hidePromotedContent();
    hideUserCellSuggestions();
    hideGrokElements();
    hideGoogleOneTap();
  }

  /* --- Deferred: text-based promoted content scan (expensive) --- */
  function hideTextBasedPromotedContent() {
    if (!cfg.ads) return;
    var articles = document.querySelectorAll('article');
    for (var i = 0; i < articles.length; i++) {
      var article = articles[i];
      if (processed.has(article)) continue;
      var spans = article.querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        var t = (spans[j].textContent || '').trim();
        if (t === 'Promoted' || t === 'Ad' || t === 'Sponsored' || t === 'Promoted Post') {
          var cell = article.closest('[data-testid="cellInnerDiv"]');
          if (cell) collapseElement(cell); else collapseElement(article);
          break;
        }
      }
    }
  }

  /* A promoted unit can carry its label as a cell heading outside any article:
     h2 > div[style^="-webkit-line-clamp"] > span "Promoted Post". Port of uBO
     uAssets filters.txt (x.com, :upward(3) from that span). */
  function hidePromotedPostHeadings() {
    if (!cfg.ads) return;
    var spans = document.querySelectorAll('[data-testid="cellInnerDiv"] h2 span');
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].textContent || '').trim();
      if (t !== 'Promoted Post') continue;
      var cell = spans[i].closest('[data-testid="cellInnerDiv"]');
      if (cell && !processed.has(cell)) collapseElement(cell);
    }
  }

  /* --- Deferred: heading-based suggestions --- */
  function hideHeadingBasedSuggestions() {
    if (!cfg.suggestions) return;
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    for (var i = 0; i < cells.length; i++) {
      if (processed.has(cells[i])) continue;
      var headings = cells[i].querySelectorAll('h2, span[dir="auto"]');
      for (var j = 0; j < headings.length; j++) {
        var t = (headings[j].textContent || '').trim().toLowerCase();
        if (t.length < 50 && (t === 'who to follow' || t === 'suggested for you' || t === 'you might like' || t === 'discover more' || t === 'more tweets' || t === 'more replies')) {
          collapseElement(cells[i]); break;
        }
      }
    }
  }

  /* --- Deferred: Premium upsells --- */
  function hidePremiumUpsells() {
    if (!cfg.premium) return;
    var els = document.querySelectorAll('a[href*="premium_sign_up"], a[href*="twitter_blue"]');
    for (var i = 0; i < els.length; i++) {
      var container = els[i].closest('[data-testid="cellInnerDiv"]') || els[i].closest('div[role="dialog"]');
      if (container) collapseElement(container); else hideEl(els[i]);
    }
  }

  /* --- Deferred: Open in App banners and login walls (always on — functional) --- */
  function isExplicitInstallOrLoginWall(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return false;

    var appLink = el.querySelector(
      'a[href*="apps.apple.com"], a[href*="play.google.com"], ' +
      'a[href*="/download"], a[href^="twitter://"], a[href^="x://"]'
    );
    var hasInstallCopy = text.includes('get the x app') ||
                         text.includes('download the x app') ||
                         text.includes('open in the x app') ||
                         text.includes('continue in the x app');
    if (hasInstallCopy && appLink) return true;

    var authLink = el.querySelector('a[href*="/i/flow/signup"], a[href*="/i/flow/login"]');
    var hasLoginWallCopy = text.includes("don't miss what's happening") ||
                           text.includes('create your account to see more');
    return !!(hasLoginWallCopy && authLink);
  }

  function hideOpenInAppBanners() {
    var bars = document.querySelectorAll('[data-testid="BottomBar"]');
    for (var i = 0; i < bars.length; i++) hideEl(bars[i]);
    /* "Get the app" links (footer, banners) */
    var links = document.querySelectorAll('a');
    for (var m = 0; m < links.length; m++) {
      var link = links[m];
      if (processed.has(link)) continue;
      var linkText = (link.textContent || '').trim().toLowerCase();
      if (linkText === 'get the app' || linkText === 'download the x app') {
        hideEl(link);
      }
    }
    var sheets = document.querySelectorAll('[data-testid="sheetDialog"], [data-testid="bottomSheet"]');
    for (var j = 0; j < sheets.length; j++) {
      if (processed.has(sheets[j])) continue;
      // X reuses these generic containers for the legitimate post overflow
      // and Share menus. Only remove a sheet when its own contents prove that
      // it is an app-install or account wall.
      if (isExplicitInstallOrLoginWall(sheets[j])) hideEl(sheets[j]);
    }
    var layers = document.querySelectorAll('#layers > div[role="dialog"], #layers > div[data-testid="sheetDialog"]');
    for (var k = 0; k < layers.length; k++) {
      var el = layers[k];
      if (processed.has(el)) continue;
      if (isExplicitInstallOrLoginWall(el)) {
        hideEl(el);
        if (document.body && document.body.style.overflow === 'hidden') {
          document.body.style.overflow = '';
        }
      }
    }
  }

  /* --- Deferred: Trending topics --- */
  function hideTrending() {
    if (!cfg.trending) return;
    var trends = document.querySelectorAll('[data-testid="trend"]');
    for (var i = 0; i < trends.length; i++) {
      var cell = trends[i].closest('[data-testid="cellInnerDiv"]');
      if (cell) collapseElement(cell); else hideEl(trends[i]);
    }
  }

  function processDeferred() {
    hideTextBasedPromotedContent();
    hidePromotedPostHeadings();
    hideHeadingBasedSuggestions();
    hidePremiumUpsells();
    hideOpenInAppBanners();
    hideTrending();
  }

  function scheduleDeferred() {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(function() { try { processDeferred(); } catch(e) {} });
    } else {
      setTimeout(function() { try { processDeferred(); } catch(e) {} }, 100);
    }
  }

  /* Initial run — run critical pass immediately, defer expensive scans */
  try { processCritical(); } catch(e) {}
  scheduleDeferred();

  /* Start Following tab polling on home page */
  if (window.location.pathname === '/' || window.location.pathname === '/home') {
    startFollowingWatch();
  }

  /* --- MutationObserver: rAF-debounced on all pages --- */
  var rafPending = false;
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length > 0) {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function() {
          rafPending = false;
          try { processCritical(); } catch(e) {}
          scheduleDeferred();
        });
        return;
      }
    }
  });
  if (document.body) { observer.observe(document.body, { childList: true, subtree: true }); }
  else { document.addEventListener('DOMContentLoaded', function() { observer.observe(document.body, { childList: true, subtree: true }); }); }

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
      if (dialogs[i].querySelector('input:not([type="hidden"])')) return true;
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
    try { processCritical(); } catch(e) {}
    scheduleDeferred();
    /* Restart Following tab polling on navigation to home */
    var path = window.location.pathname;
    if (path === '/' || path === '/home') {
      startFollowingWatch();
    } else {
      removeHomeForYouStyle();
      stopFollowingWatch();
    }
  });

  setInterval(function() {
    if (isEditingFocused()) return;
    if (!document.getElementById('dull-filter')) {
      try { window.webkit.messageHandlers.dullReinject.postMessage({ platform: 'x', reason: 'css_missing_periodic' }); } catch(e) {}
    }
  }, 30000);

  window.__dullPlatformInit_x = true;
})();
