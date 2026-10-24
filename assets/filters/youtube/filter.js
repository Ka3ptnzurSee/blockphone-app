(function() {
  'use strict';
  // Only run on YouTube pages — skip Google auth/consent pages during sign-in
  if (!/youtube\.com$/i.test(window.location.hostname)) return;
  // Re-entry guard. See instagram/filter.js for rationale.
  if (window.__dullPlatformInit_youtube) return;
  var cfg = window.__dullConfig || {};
  var __dullBlockedCount = 0;
  var __dullCountPending = false;

  function reportCount() {
    if (__dullCountPending) return;
    __dullCountPending = true;
    setTimeout(function() {
      __dullCountPending = false;
      try { window.webkit.messageHandlers.dullFilterCount.postMessage({ platform: 'youtube', count: __dullBlockedCount }); } catch(e) {}
    }, 500);
  }

  /* === Ad blocking helpers ===
     Strip ad keys from any playerResponse-shaped object. Mirrors uBO's json-prune rules
     for m.youtube.com: playerResponse.{adPlacements,playerAds,adSlots} and the Shorts
     reel_watch_sequence entries. Mutates in place. Cheap if `v` has no ad keys. */
  function stripAdsFromPlayerResponse(v) {
    if (!v || typeof v !== 'object') return;
    /* /youtubei/v1/get_watch answers with an array that carries the player
       response and the watch-next response side by side. uBO prunes it as
       [].playerResponse.adPlacements (uAssets quick-fixes.txt). */
    if (Array.isArray(v)) {
      for (var a = 0; a < v.length; a++) stripAdsFromPlayerResponse(v[a]);
      return;
    }
    if (v.adPlacements) delete v.adPlacements;
    if (v.playerAds) delete v.playerAds;
    if (v.adSlots) delete v.adSlots;
    var pr = v.playerResponse;
    if (pr && typeof pr === 'object') {
      if (pr.adPlacements) delete pr.adPlacements;
      if (pr.playerAds) delete pr.playerAds;
      if (pr.adSlots) delete pr.adSlots;
    }
    /* Reel watch sequence: splice out any entry flagged isAd */
    var entries = v.entries || (v.reelWatchSequenceResponse && v.reelWatchSequenceResponse.entries);
    if (Array.isArray(entries)) {
      for (var i = entries.length - 1; i >= 0; i--) {
        var e = entries[i];
        var ad = e && e.command && e.command.reelWatchEndpoint && e.command.reelWatchEndpoint.adClientParams;
        if (ad && ad.isAd) entries.splice(i, 1);
      }
    }
  }

  /* Watch-next feed ads arrive as adSlotRenderer entries inside an
     itemSectionRenderer's contents. Port of uBO's m.youtube.com rule
     json-edit-fetch-response(..itemSectionRenderer.contents.*[?.adSlotRenderer])
     on /get_watch (uAssets filters.txt). Walks the whole response because the
     section sits at different depths in /next and /get_watch payloads. Depth is
     capped so a malformed or cyclic object cannot run away. */
  function stripAdSlotsFromSections(node, depth) {
    if (!node || typeof node !== 'object' || depth > 48) return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) stripAdSlotsFromSections(node[i], depth + 1);
      return;
    }
    var section = node.itemSectionRenderer;
    if (section && Array.isArray(section.contents)) {
      for (var j = section.contents.length - 1; j >= 0; j--) {
        var item = section.contents[j];
        if (item && item.adSlotRenderer) section.contents.splice(j, 1);
      }
    }
    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var child = node[key];
      if (child && typeof child === 'object') stripAdSlotsFromSections(child, depth + 1);
    }
  }

  /* Intercept ytInitialPlayerResponse to strip upsell dialog + ads before YouTube renders */
  try {
    /* This script is installed at document end, so YouTube may already have
       populated the response. Preserve and sanitize that value before replacing
       the property with a setter for later SPA/player updates. */
    var _ytIPR = window.ytInitialPlayerResponse;
    if (_ytIPR && _ytIPR.auxiliaryUi && _ytIPR.auxiliaryUi.messageRenderers) {
      delete _ytIPR.auxiliaryUi.messageRenderers.upsellDialogRenderer;
    }
    if (cfg.ads) { try { stripAdsFromPlayerResponse(_ytIPR); } catch(e) {} }
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: function() { return _ytIPR; },
      set: function(v) {
        if (v && v.auxiliaryUi && v.auxiliaryUi.messageRenderers) {
          delete v.auxiliaryUi.messageRenderers.upsellDialogRenderer;
        }
        if (cfg.ads) { try { stripAdsFromPlayerResponse(v); } catch(e) {} }
        _ytIPR = v;
      }
    });
  } catch(e) {}

  /* Hook fetch for /youtubei/v1/player (regular videos) and /reel_watch_sequence (Shorts metadata).
     YouTube's mobile Polymer client makes these calls on every SPA nav between videos — the setter
     trap above only catches the initial cold load. Clone the response, prune ad keys, reserialize. */
  if (cfg.ads && typeof window.fetch === 'function') {
    try {
      var __origFetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch(e) {}
        /* get_watch is the combined player + watch-next call that m.youtube.com
           now uses on SPA navigation; uBO targets it for both playerResponse ads
           and feed ad slots. */
        var isWatchFeed = url.indexOf('/youtubei/v1/next') !== -1 ||
                          url.indexOf('/youtubei/v1/get_watch') !== -1;
        var isAdBearing = isWatchFeed ||
                          url.indexOf('/youtubei/v1/player') !== -1 ||
                          url.indexOf('/reel_watch_sequence') !== -1;
        var promise = __origFetch(input, init);
        if (!isAdBearing) return promise;
        return promise.then(function(resp) {
          if (!resp || !resp.ok) return resp;
          var ct = resp.headers && resp.headers.get && resp.headers.get('content-type');
          if (ct && ct.indexOf('json') === -1) return resp;
          return resp.clone().json().then(function(data) {
            stripAdsFromPlayerResponse(data);
            if (isWatchFeed) stripAdSlotsFromSections(data, 0);
            var body = JSON.stringify(data);
            return new Response(body, {
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers
            });
          }).catch(function() { return resp; });
        });
      };
    } catch(e) {}
  }

  /* Fallback for a pre/mid-roll that still slips through (usually means YouTube
     changed the player-response shape): end the break, and mute the player for
     the moments before it ends. Runs from the MutationObserver tick (no separate timer).

     The element ref in __dullAdMutedVideo lets us restore audio when the ad overlay clears.
     YT reuses the same <video> for ads and content, and YT's chrome mute button drives a
     separate state model — without restoration, the real video plays stuck-muted until refresh.
     Assumes a single primary <video> (true on YT mobile web today). */
  var __dullAdMutedVideo = null;
  var __dullAdMuteOverrideVideo = null;
  var __dullExpectedMuteEventVideo = null;

  /* An ad break often cannot be ended on the first look: the ad video's duration
     is still NaN while its metadata loads, and a skip control may not be live
     yet. The MutationObserver cannot be relied on to bring us back, because a
     video playing inside an otherwise static player produces no mutations. Retry
     on a short timer for as long as the player says an ad is running, and stop
     as soon as it is over so nothing ticks during normal playback. */
  var __dullAdRetryTimer = null;
  var __dullAdRetryCount = 0;
  var DULL_AD_RETRY_INTERVAL_MS = 250;
  var DULL_AD_RETRY_LIMIT = 40;

  function clearAdRetry() {
    if (__dullAdRetryTimer) {
      clearTimeout(__dullAdRetryTimer);
      __dullAdRetryTimer = null;
    }
    __dullAdRetryCount = 0;
  }

  function scheduleAdRetry() {
    if (__dullAdRetryTimer) return;
    if (__dullAdRetryCount >= DULL_AD_RETRY_LIMIT) return;
    __dullAdRetryCount++;
    __dullAdRetryTimer = setTimeout(function() {
      __dullAdRetryTimer = null;
      dismissVisibleAds();
    }, DULL_AD_RETRY_INTERVAL_MS);
  }

  /* A mute that Dull applies is a temporary lease, not a permanent preference.
     Relinquish that lease if the player changes mute state again while the ad is
     visible. This preserves a user's explicit choice instead of unconditionally
     unmuting them when the overlay disappears. */
  document.addEventListener('volumechange', function(e) {
    var video = e.target;
    if (!video || video.tagName !== 'VIDEO') return;
    if (__dullExpectedMuteEventVideo === video) {
      __dullExpectedMuteEventVideo = null;
      return;
    }
    if (__dullAdMutedVideo === video) {
      __dullAdMutedVideo = null;
      __dullAdMuteOverrideVideo = video;
    }
  }, true);

  /* YouTube marks an ad break by putting `ad-showing` / `ad-interrupting` on the
     player container. That is the signal to trust for anything destructive:
     Dull's own CSS sets the ad overlay to `display: none`, so overlay presence
     or visibility cannot tell a live ad apart from a leftover node. Seeking on
     the strength of an overlay alone once sent real content to its end. */
  function adPlayerElement() {
    return document.querySelector('.ad-showing, .ad-interrupting');
  }

  function adBreakActive() {
    return !!adPlayerElement() ||
           !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
  }

  /* End the break outright rather than only silencing it. Clicking a live skip
     button is the polite route, but it is not always available: bumpers and
     other unskippable formats never render one, and a skip control that has not
     finished its countdown ignores the click. Seeking the ad to its end works in
     every one of those cases.

     Muting without ending is what produced the September 2026 report: the ad
     played on, silent, with its overlay and skip button hidden by Dull's own
     CSS, so the viewer had no indication and no way out. */
  function endAdBreak() {
    var skip = document.querySelector(
      '.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-ad-skip-ad-button, .ytp-skip-ad-button'
    );
    if (skip) { try { skip.click(); } catch(e) {} }

    var player = adPlayerElement();
    if (!player) return;
    var vid = player.querySelector('video') || document.querySelector('video');
    if (!vid) return;
    var duration = vid.duration;
    if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) return;
    /* Already at the end: the seek has landed and the player is switching back
       to content. Repeating it would fight YouTube's own transition. */
    if (vid.currentTime >= duration - 0.5) return;
    try { vid.currentTime = duration; } catch(e) {}
  }

  function dismissVisibleAds() {
    if (!cfg.ads) return;
    endAdBreak();
    /* Retry only while the player itself reports an ad. An orphaned overlay is
       not something we can end, so it must never start a timer. */
    if (adPlayerElement()) {
      scheduleAdRetry();
    } else {
      clearAdRetry();
    }
    var adShowing = adBreakActive();
    var vid = document.querySelector('video');
    if (adShowing && vid) {
      /* Skip if user pre-muted — we won't own a mute we didn't set, so we won't unmute it later. */
      if (__dullAdMutedVideo !== vid && __dullAdMuteOverrideVideo !== vid && !vid.muted) {
        try {
          __dullAdMutedVideo = vid;
          __dullExpectedMuteEventVideo = vid;
          vid.muted = true;
        } catch(e) {}
      }
    } else if (!adShowing) {
      var dullMutedVideo = __dullAdMutedVideo;
      __dullAdMutedVideo = null;
      __dullAdMuteOverrideVideo = null;
      __dullExpectedMuteEventVideo = null;
      if (dullMutedVideo) {
        try { dullMutedVideo.muted = false; } catch(e) {}
      }
    }
  }

  var processed = new WeakSet();

  function hideEl(el) {
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();
    el.style.setProperty('display', 'none', 'important');
  }

  /* --- Critical: hide Shorts elements --- */
  function hideShortElements() {
    if (!cfg.shorts) return;
    var links = document.querySelectorAll('a[href*="/shorts/"]');
    for (var i = 0; i < links.length; i++) {
      var container = links[i].closest('ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-compact-video-renderer, ytm-grid-video-renderer, ytm-video-renderer');
      if (container) { hideEl(container); continue; }
      /* Search results: Shorts in item-section-renderer that contain ONLY shorts links */
      var section = links[i].closest('ytm-item-section-renderer');
      if (section && !section.querySelector('a[href*="/watch?"]')) hideEl(section);
    }
    var dataShorts = document.querySelectorAll('[data-style="SHORTS"]');
    for (var j = 0; j < dataShorts.length; j++) {
      var container2 = dataShorts[j].closest('ytm-video-with-context-renderer, ytm-rich-item-renderer');
      if (container2) hideEl(container2);
    }
    /* Shorts lockup models — hide individual lockups and dedicated shelves (not mixed sections) */
    var lockups = document.querySelectorAll('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2');
    for (var k = 0; k < lockups.length; k++) {
      var shelf = lockups[k].closest('ytm-reel-shelf-renderer');
      if (shelf) { hideEl(shelf); continue; }
      var gridShelf = lockups[k].closest('grid-shelf-view-model');
      if (gridShelf && !gridShelf.querySelector('a[href*="/watch?"]')) { hideEl(gridShelf); continue; }
      /* Home-feed Shorts section without a reel shelf (gijsdev/ublock-hide-yt-shorts 2026-04) */
      var richSection = lockups[k].closest('ytm-rich-section-renderer');
      if (richSection && !richSection.querySelector('a[href*="/watch?"]')) { hideEl(richSection); continue; }
      var section = lockups[k].closest('ytm-item-section-renderer');
      if (section && !section.querySelector('a[href*="/watch?"]')) { hideEl(section); continue; }
      hideEl(lockups[k]);
    }
  }

  /* --- Subscriptions lockdown: only on /feed/subscriptions, toggle body class so CSS can scope. --- */
  function applySubscriptionsLockdown() {
    if (!document.body) return;
    var shouldLock = !!cfg.subscriptionsLockdown && window.location.pathname === '/feed/subscriptions';
    var has = document.body.classList.contains('dull-subs-lockdown');
    if (shouldLock && !has) document.body.classList.add('dull-subs-lockdown');
    else if (!shouldLock && has) document.body.classList.remove('dull-subs-lockdown');
  }

  /* --- Watch-page recommendations: rail + load-more sentinel --- */
  function hideWatchRecommendations() {
    if (!cfg.watchRecommendations) return;
    if (window.location.pathname !== '/watch') return;
    var container = document.querySelector('ytm-single-column-watch-next-results-renderer');
    if (!container) return;
    var sections = container.querySelectorAll('ytm-item-section-renderer');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].querySelector('ytm-video-with-context-renderer')) hideEl(sections[i]);
    }
    var cont = container.querySelector(':scope > ytm-continuation-item-renderer');
    if (cont) hideEl(cont);
  }

  /* --- Deferred: text-based checks and banners (run via requestIdleCallback) --- */
  function processDeferredContent() {
    if (cfg.shorts) {
      var chips = document.querySelectorAll('ytm-chip-cloud-chip-renderer');
      for (var i = 0; i < chips.length; i++) {
        if ((chips[i].textContent || '').trim() === 'Shorts' ||
            chips[i].querySelector('[aria-label="Shorts"]')) hideEl(chips[i]);
      }
      var tabs = document.querySelectorAll('.single-column-browse-results-tabs a, yt-tab-shape');
      for (var j = 0; j < tabs.length; j++) {
        var text = (tabs[j].textContent || tabs[j].getAttribute('tab-title') || '').trim();
        if (text === 'Shorts') hideEl(tabs[j]);
      }
      var wrappers = document.querySelectorAll('.reel-shelf-title-wrapper');
      for (var k = 0; k < wrappers.length; k++) {
        var wText = (wrappers[k].textContent || '').toLowerCase();
        if (wText.includes('shorts') || wText.includes('remix')) {
          var shelf = wrappers[k].closest('ytm-reel-shelf-renderer');
          if (shelf) hideEl(shelf);
        }
      }
    }
    var prompts = document.querySelectorAll('ytm-open-in-app-prompt-renderer');
    for (var m = 0; m < prompts.length; m++) hideEl(prompts[m]);
    /* Mealbar "Get the App" persistent banner */
    var mealbars = document.querySelectorAll('ytm-mealbar-renderer, ytm-mealbar.mealbar-promo-renderer, #mealbar\\:3');
    for (var n = 0; n < mealbars.length; n++) hideEl(mealbars[n]);
    /* Upsell dialog popup after watching videos */
    var upsellPopups = document.querySelectorAll('ytd-popup-container [position-type="OPEN_POPUP_POSITION_BOTTOMLEFT"]');
    for (var p = 0; p < upsellPopups.length; p++) hideEl(upsellPopups[p]);
  }

  function scheduleDeferred() {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(function() { try { processDeferredContent(); } catch(e) {} });
    } else {
      setTimeout(function() { try { processDeferredContent(); } catch(e) {} }, 100);
    }
  }

  applySubscriptionsLockdown();
  hideShortElements();
  hideWatchRecommendations();
  dismissVisibleAds();
  scheduleDeferred();

  /* --- MutationObserver: coalesce via setTimeout(0) on search, rAF elsewhere --- */
  var isSearchPage = window.location.pathname === '/results';
  var rafPending = false;
  var searchFilterPending = false;
  /* Class tokens that change what the ad handler should do: the overlay, the
     player's own ad state, and the skip control's slot. The slot matters because
     YouTube reveals a skip button by reclassing that slot, never the overlay,
     so watching the overlay alone missed the moment a skip became available. */
  function hasAdStateClass(value) {
    return /(?:^|\s)(?:ytp-ad-player-overlay(?:-layout)?|ad-showing|ad-interrupting|ytp-ad-skip-button-slot)(?:\s|$)/
      .test(value || '');
  }

  function mutationNeedsFilterPass(mutation) {
    if (mutation.type !== 'attributes') {
      return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
    }
    /* YouTube changes classes throughout the page continuously. Only an ad-state
       class gaining or losing a token can change what the ad handler should do;
       ignoring all other class churn avoids a full-document filter pass per UI
       animation. */
    var currentClass = mutation.target && mutation.target.getAttribute
      ? mutation.target.getAttribute('class')
      : '';
    return hasAdStateClass(mutation.oldValue) || hasAdStateClass(currentClass);
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutationNeedsFilterPass(mutation)) {
        if (isSearchPage) {
          /* On search pages, use microtask coalescing — faster than rAF but avoids
             calling hideShortElements() synchronously on every single mutation. */
          if (!searchFilterPending) {
            searchFilterPending = true;
            setTimeout(function() {
              searchFilterPending = false;
              applySubscriptionsLockdown();
              hideShortElements();
              hideWatchRecommendations();
              dismissVisibleAds();
              scheduleDeferred();
            }, 0);
          }
        } else {
          if (rafPending) return;
          rafPending = true;
          requestAnimationFrame(function() {
            rafPending = false;
            applySubscriptionsLockdown();
            hideShortElements();
            hideWatchRecommendations();
            dismissVisibleAds();
            scheduleDeferred();
          });
        }
        return;
      }
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: true
  });

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
    isSearchPage = window.location.pathname === '/results';
    applySubscriptionsLockdown();
    hideShortElements();
    hideWatchRecommendations();
    dismissVisibleAds();
    scheduleDeferred();
  });

  setInterval(function() {
    if (isEditingFocused()) return;
    if (!document.getElementById('dull-filter')) {
      try { window.webkit.messageHandlers.dullReinject.postMessage({ platform: 'youtube', reason: 'css_missing_periodic' }); } catch(e) {}
    }
  }, 30000);

  window.__dullPlatformInit_youtube = true;
})();
