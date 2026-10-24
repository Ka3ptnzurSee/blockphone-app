(function() {
  'use strict';
  // Only run on Facebook pages — skip auth/consent pages during sign-in
  if (!/facebook\.com$/i.test(window.location.hostname)) return;
  // Re-entry guard. See instagram/filter.js for rationale.
  if (window.__dullPlatformInit_facebook) return;
  var cfg = window.__dullConfig || {};
  var feedsOnly = !!cfg.feedsOnly;
  var feedVideoHomeRedirect = !!(cfg.reels && cfg.feedVideoHomeRedirect);
  var processed = new WeakSet();
  var REELS_TEXT = ['reels and short videos', 'reels', 'short videos', 'reel', 'suggested reels', 'more reels', 'related reels', '\u0631\u064a\u0644\u0632'];
  var REEL_SHELF_TEXT = [
    'reels and short videos', 'short videos', 'suggested reels',
    'more reels', 'related reels', 'meediumiklipid'
  ];
  var SUGGESTED_TEXT = ['suggested for you', 'people you may know', 'suggested groups', 'suggested pages'];
  var BLOCKED_MEDIA_LINK_SELECTOR = [
    'a[href*="/reel/" i]',
    'a[href*="/reels/" i]',
    'a[href*="/watch" i]',
    'a[href*="/share/r/" i]',
    'a[href*="/l.php" i]',
    'a[href*="%2fshare%2fr%2f" i]',
    '[data-lynx-uri*="/share/r/" i]',
    '[data-lynx-uri*="%2fshare%2fr%2f" i]'
  ].join(', ');
  var MANAGED_FEED_REASON_ATTRIBUTE = 'data-dull-facebook-feed-reasons';
  var __dullBlockedCount = 0;
  var __dullCountPending = false;

  function reportCount() {
    if (__dullCountPending) return;
    __dullCountPending = true;
    setTimeout(function() {
      __dullCountPending = false;
      try { window.webkit.messageHandlers.dullFilterCount.postMessage({ platform: 'facebook', count: __dullBlockedCount }); } catch(e) {}
    }, 500);
  }

  /* Facebook virtualizes its Home feed by reusing the same card elements for
     different content. Keep feed decisions reversible and CSS-backed rather
     than permanently caching a node in `processed`: a recommended card can
     later become a followed post, and Facebook can replace its inline style
     without replacing the node. */
  function managedFeedReasons(element) {
    if (!element || !element.getAttribute) return [];
    return (element.getAttribute(MANAGED_FEED_REASON_ATTRIBUTE) || '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function hasManagedFeedReason(element, reason) {
    return managedFeedReasons(element).indexOf(reason) !== -1;
  }

  function setManagedFeedReason(element, reason, shouldHide) {
    if (!element || !element.setAttribute) return;
    var reasons = managedFeedReasons(element);
    var index = reasons.indexOf(reason);
    var wasHidden = reasons.length > 0;
    if (shouldHide && index === -1) reasons.push(reason);
    if (!shouldHide && index !== -1) reasons.splice(index, 1);

    if (reasons.length > 0) {
      element.setAttribute(MANAGED_FEED_REASON_ATTRIBUTE, reasons.join(' '));
    } else {
      element.removeAttribute(MANAGED_FEED_REASON_ATTRIBUTE);
    }

    if (!wasHidden && reasons.length > 0) {
      __dullBlockedCount++;
      reportCount();
    }
  }

  function reconcileManagedFeedReason(reason, matchedElements) {
    var current = document.querySelectorAll(
      '[' + MANAGED_FEED_REASON_ATTRIBUTE + '~="' + reason + '"]'
    );
    for (var i = 0; i < current.length; i++) {
      if (!matchedElements.has(current[i])) setManagedFeedReason(current[i], reason, false);
    }
    matchedElements.forEach(function(element) {
      setManagedFeedReason(element, reason, true);
    });
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

  function maskWebLiteReelsTab(el) {
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();

    var screen = el.closest('[data-theme-color]');
    var themeColor = screen && screen.getAttribute('data-theme-color');
    if (!/^#[0-9a-f]{6}$/i.test(themeColor || '')) themeColor = '#ffffff';

    el.setAttribute('data-dull-weblite-reels-mask', '');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('tabindex', '-1');
    el.style.setProperty('--dull-facebook-tab-background', themeColor);
  }

  /* --- Critical: attribute-based Reels detection --- */
  function processAttributeElements() {
    if (!cfg.reels) return;
    var els = document.querySelectorAll('[aria-label*="reel" i], [aria-label*="Reel"], [data-pagelet*="reel" i], [data-pagelet*="Reel"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (processed.has(el)) continue;
      var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      var pagelet = (el.getAttribute('data-pagelet') || '').toLowerCase();
      if (pagelet.includes('reel') || isReelAriaLabel(ariaLabel)) {
        /* WebLite paints tab components into their own compositing slots.
           Removing/collapsing the DOM node leaves its old bg-s2 layer cached
           as a gray square. Mask the exact ordinal Reels slot with the screen
           theme while removing it from accessibility and hit testing. */
        if (el.getAttribute('role') === 'tab' && isReelsOrdinalAriaLabel(ariaLabel)) {
          maskWebLiteReelsTab(el);
        } else {
          hideEl(el);
        }
      }
    }
  }

  function isReelsOrdinalAriaLabel(value) {
    var label = (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return /^reels,\s*(?:\d+\+?\s+new,\s*)?\d+\s+of\s+\d+$/.test(label);
  }

  function isReelAriaLabel(value) {
    var label = (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (label === 'reel' || label === 'reels' || label === 'reels tray' ||
        label === 'short videos' || label === 'reel tile preview') return true;
    /* Facebook WebLite encodes header tabs as an accessible ordinal rather
       than a link. Example captured from the live mobile DOM:
       "reels, 100 new, 4 of 6". Keep the match count-shaped so ordinary
       labels containing the word "reels" are not removed. */
    if (isReelsOrdinalAriaLabel(label)) return true;
    var prefixes = [
      'reels player', 'suggested reels', 'more reels', 'related reels',
      'open reel', 'watch reel'
    ];
    for (var i = 0; i < prefixes.length; i++) {
      if (label.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }

  function hasSemanticReelAriaLabel(root) {
    if (!root) return false;
    if (isReelAriaLabel(root.getAttribute && root.getAttribute('aria-label'))) return true;
    if (!root.querySelectorAll) return false;
    var labelled = root.querySelectorAll('[aria-label]');
    for (var i = 0; i < labelled.length; i++) {
      if (isReelAriaLabel(labelled[i].getAttribute('aria-label'))) return true;
    }
    return false;
  }

  function isWatchNavigationLabel(value) {
    var label = (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label === 'video' || label === 'videos' || label === 'watch' ||
      label === 'reels & watch' || label === 'reels and watch';
  }

  function hasWatchNavigationLabel(root) {
    if (!root) return false;
    if (isWatchNavigationLabel(root.getAttribute && root.getAttribute('aria-label'))) return true;
    if (!root.querySelectorAll) return false;
    var labelled = root.querySelectorAll('[aria-label]');
    for (var i = 0; i < labelled.length; i++) {
      if (isWatchNavigationLabel(labelled[i].getAttribute('aria-label'))) return true;
    }
    return false;
  }

  function isTopNavigationControl(el) {
    if (!el || el.closest('article, [role="article"]')) return false;
    if (el.closest('nav, [role="navigation"], [role="tablist"], [role="banner"]')) return true;

    /* Facebook's current mobile header is an icon-only row without a stable
       navigation role. Keep the fallback geometric and label-exact so a
       normal feed video control is never hidden. */
    if (!hasWatchNavigationLabel(el) || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    return rect.top >= -8 && rect.top <= 120 && rect.height > 0 && rect.height <= 80;
  }

  /* --- Critical: Reels tab in navigation --- */
  function hideReelsTab() {
    if (!cfg.reels) return;
    var els = document.querySelectorAll(
      'nav a, nav [role="tab"], div[role="tablist"] a, div[role="tablist"] [role="tab"], ' +
      'div[role="navigation"] a, div[role="navigation"] [role="tab"], ' +
      'div[role="banner"] a, div[role="banner"] [role="tab"], ' +
      'a[aria-label], [role="tab"][aria-label]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (processed.has(el)) continue;
      var href = (el.getAttribute('href') || '').toLowerCase();
      var text = (el.textContent || '').toLowerCase().trim();
      var watchQuery = href.indexOf('sk=watch') !== -1 || href.indexOf('sk=video') !== -1;
      if (isTopNavigationControl(el) &&
          (href === '/watch' || href === '/watch/' || href.startsWith('/watch?') ||
           href.startsWith('/reel') || watchQuery || text === 'reels' ||
           hasWatchNavigationLabel(el))) {
        hideEl(el);
      }
    }
  }

  function isReelShelfHeadingText(value) {
    var text = normalizedControlValue(value);
    return REEL_SHELF_TEXT.indexOf(text) !== -1;
  }

  function isReelShelfHeadingElement(element, value) {
    if (!isReelShelfHeadingText(value)) return false;
    if (element.closest('h2, h3, h4, [role="heading"]')) return true;
    var card = findFeedCardForSignal(element);
    if (!card || card.matches('[role="article"], [data-pagelet^="FeedUnit"]')) return false;
    if (hasManagedFeedReason(card, 'reels')) return true;
    return containsWideFeedMedia(card, window.innerWidth || 375) &&
      isCardHeaderSignal(element, card);
  }

  /* Facebook's current feed aliases Reels through /share/r/ in addition to
     explicit /reel/ and /watch/ routes. Keep generic /share/v/, profile
     /videos/, and video.php posts intact; those are ordinary Facebook posts.
     A route-less Reel pager is handled from its semantic marker below.
     Marketplace details are excluded because listing media is functional.

     Feed roots use a reversible reason marker because WebLite recycles them
     while scrolling. The final reconciliation also restores a followed post
     when a previously blocked slot is repopulated with ordinary content. */
  function hideFeedReelCards() {
    var matchedCards = new Set();
    var path = (window.location.pathname || '').toLowerCase();
    if (!cfg.reels || path.indexOf('/marketplace') === 0) {
      reconcileManagedFeedReason('reels', matchedCards);
      return;
    }

    var cards = document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit"]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var mediaLink = firstBlockedMediaLink(card);
      var reelLabel = hasSemanticReelAriaLabel(card) ||
        card.matches('[data-pagelet*="reel" i]') || card.querySelector('[data-pagelet*="reel" i]');
      if (mediaLink || reelLabel) matchedCards.add(card);
    }

    /* WebLite recommendation shelves can be completely role-less and localize
       their heading (for example, "Meediumiklipid"). The destination remains
       a substantially more stable signal than visible copy. Walk from exact
       Reel/Watch destinations to the smallest visual card/shelf boundary. */
    var looseMediaLinks = document.querySelectorAll(BLOCKED_MEDIA_LINK_SELECTOR);
    for (var l = 0; l < looseMediaLinks.length; l++) {
      var link = looseMediaLinks[l];
      if (!isBlockedMediaElement(link)) continue;
      if (link.closest('nav, [role="navigation"], [role="tablist"], [role="banner"]')) continue;
      /* Inline anchors can report their text baseline below a tall thumbnail.
         Use the media box as the geometric signal when one is available. */
      var visualSignal = link.querySelector('img, video, [role="img"]') || link;
      var looseCard = findFeedCardForSignal(visualSignal);
      if (looseCard) matchedCards.add(looseCard);
    }

    /* Some live localized shelves expose only an ordinary /share/v/ click
       target. Their exact shelf heading is the remaining high-confidence
       signal; scan direct text so plain-div WebLite headings are covered. */
    visitDirectTextElements(document.body, isReelShelfHeadingText, function(heading, text) {
      if (!isReelShelfHeadingElement(heading, text)) return;
      var headingCard = findFeedCardForSignal(heading);
      if (headingCard) matchedCards.add(headingCard);
    });

    reconcileManagedFeedReason('reels', matchedCards);
  }

  function isFacebookFeedsSurface() {
    try {
      var url = new URL(window.location.href);
      var path = url.pathname.toLowerCase();
      if (path !== '/' && path !== '/home.php') return false;

      /* Facebook currently accepts the chronological `sk=h_chr` request and
         then canonicalizes the live SPA URL back to bare `/`. Keep filtering
         that Home DOM, but do not classify root-query post/photo/comment
         viewers as the feed. */
      var detailKeys = [
        'story_fbid', 'fbid', 'photo_id', 'video_id', 'post_id',
        'permalink_id', 'comment_id', 'reply_comment_id',
        'multi_permalinks', 'set', 'id'
      ];
      for (var d = 0; d < detailKeys.length; d++) {
        if (url.searchParams.has(detailKeys[d])) return false;
      }
      var ref = normalizedControlValue(url.searchParams.get('ref'));
      if (/(?:photo|viewer|story|permalink|comment|video)/.test(ref)) return false;
      var surface = url.searchParams.get('sk');
      return !surface || surface === 'h_chr';
    } catch(e) { return false; }
  }

  var UNFOLLOWED_FEED_ACTIONS = [
    'follow', 'join',
    'seguir', 'unirte', 'unirse', 'participar',
    'folgen', 'beitreten',
    'jälgi', 'liitu',
    'suivre', 'rejoindre',
    'segui', 'iscriviti',
    'volgen', 'lid worden',
    'подписаться', 'вступить'
  ];

  var FEEDS_ONLY_SUGGESTED_TEXT = SUGGESTED_TEXT.concat([
    'recommended for you', 'suggested posts', 'posts you may like',
    'sugerencias para ti', 'personas que quizá conozcas',
    'vorschläge für dich', 'personen, die du kennen könntest',
    'soovitused sulle', 'soovitatud sulle', 'soovitatud postitused',
    'inimesed, keda võid tunda'
  ]);

  /* The disclosure follows the account's language, not Dull's UI language.
     The second block is the localized "Sponsored" label set uBO matches on
     m.facebook.com (uAssets filters-mobile.txt); single, unambiguous labels
     only, exact-matched against a card-header text node like the rest. */
  var FACEBOOK_AD_TEXT = [
    'ad', 'sponsored', 'promoted', 'advertisement',
    'patrocinado', 'publicidad', 'gesponsert', 'anzeige',
    'sponsorisé', 'publicité', 'sponsorizzato', 'pubblicità',
    'gesponsord', 'advertentie', 'sponsitud', 'reklaam',
    'sponsorlu', 'sponsorowane', 'geborg', 'bersponsor', 'ditaja',
    'disponsori', 'giisponsoran', 'sponzorováno', 'sponzorované',
    'sponsoreret', 'may sponsor', 'sponzorirano', 'hirdetés', 'sponset',
    'sponsorizat', 'sponsoroitu', 'sponsrat', 'được tài trợ',
    'χορηγούμενη', 'спонсорирано', 'спонзорирано', 'спонзорисано',
    'реклама', 'במימון', 'प्रायोजित', 'স্পনসর্ড', '광고', '贊助', '赞助内容', '広告'
  ];

  function normalizedControlValue(value) {
    return (value || '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function visitDirectTextElements(root, matcher, visitor) {
    if (!root || !matcher || !visitor) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var seen = new WeakSet();
    while (walker.nextNode()) {
      var value = normalizedControlValue(walker.currentNode.nodeValue);
      if (!matcher(value)) continue;
      var element = walker.currentNode.parentElement;
      if (!element || seen.has(element)) continue;
      seen.add(element);
      visitor(element, value);
    }
  }

  function matchesExactValue(value, allowedValues) {
    return !!value && allowedValues.indexOf(normalizedControlValue(value)) !== -1;
  }

  function matchesUnfollowedActionText(value) {
    var text = normalizedControlValue(value);
    if (!text || text.length > 64) return false;
    for (var i = 0; i < UNFOLLOWED_FEED_ACTIONS.length; i++) {
      var action = UNFOLLOWED_FEED_ACTIONS[i];
      if (text === action || text.indexOf(action + ' ·') === 0 ||
          text.indexOf(action + ' •') === 0) {
        return true;
      }
    }
    return false;
  }

  function hasUnfollowedActionMetadata(control) {
    if (!control || !control.getAttribute) return false;
    var values = [
      control.getAttribute('href'),
      control.getAttribute('action'),
      control.getAttribute('data-testid'),
      control.getAttribute('data-sigil'),
      control.getAttribute('data-action-id'),
      control.getAttribute('name')
    ];
    for (var i = 0; i < values.length; i++) {
      var value = normalizedControlValue(values[i]);
      if (!value || /(?:unfollow|following|joined|subscribed)/.test(value)) continue;
      if (/(?:^|[\/_?.=&:\-])(follow|join|subscribe)(?:$|[\/_?.=&:\-])/.test(value) ||
          /\/a\/subscribe\.php(?:$|[?\/])/.test(value)) return true;
    }
    return false;
  }

  function isUnfollowedFeedAction(control) {
    if (hasUnfollowedActionMetadata(control)) return true;
    var values = [
      normalizedControlValue(control.getAttribute && control.getAttribute('aria-label')),
      normalizedControlValue(control.textContent)
    ];
    for (var v = 0; v < values.length; v++) {
      if (matchesUnfollowedActionText(values[v])) return true;
    }
    return false;
  }

  function isCardHeaderSignal(signal, card) {
    if (signal.closest('header')) return true;
    var managedCard = signal.closest && signal.closest(
      '[' + MANAGED_FEED_REASON_ATTRIBUTE + ']'
    );
    if (managedCard === card && hasManagedFeedReason(card, 'recommendation')) return true;
    if (!signal.getBoundingClientRect || !card.getBoundingClientRect) return false;
    var controlRect = signal.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    if (controlRect.height <= 0 || cardRect.height <= 0) return false;
    return controlRect.top >= cardRect.top - 4 &&
      controlRect.top <= cardRect.top + Math.min(180, cardRect.height * 0.4);
  }

  function isFeedCardBoundary(element) {
    if (!element || element === document.body || element === document.documentElement) return true;
    var role = (element.getAttribute && element.getAttribute('role') || '').toLowerCase();
    return element.tagName === 'MAIN' || role === 'main' || role === 'feed' ||
      role === 'dialog' || role === 'navigation';
  }

  function containsWideFeedMedia(element, viewportWidth) {
    var media = element.querySelectorAll('img, video, [role="img"]');
    for (var i = 0; i < media.length; i++) {
      if (!media[i].getBoundingClientRect) continue;
      var rect = media[i].getBoundingClientRect();
      if (rect.width >= viewportWidth * 0.48 || rect.height >= 180) return true;
    }
    return false;
  }

  function findFeedCardForSignal(signal) {
    if (!signal || !signal.closest) return null;
    var managed = signal.closest('[' + MANAGED_FEED_REASON_ATTRIBUTE + ']');
    if (managed) return managed;
    var semantic = signal.closest('[role="article"], [data-pagelet^="FeedUnit"]');
    if (semantic) return semantic;

    /* Current WebLite feed cards can omit article/FeedUnit semantics entirely.
       Walk up from the exact Follow/Suggested signal and select the smallest
       full-width wrapper containing substantial post content. A wide media
       descendant distinguishes the whole card from its narrow header row. */
    var signalRect = signal.getBoundingClientRect && signal.getBoundingClientRect();
    if (!signalRect) return null;
    var viewportWidth = window.innerWidth || 375;
    var viewportHeight = window.innerHeight || 667;
    var fallback = null;
    var cursor = signal;
    for (var depth = 0; depth < 14; depth++) {
      cursor = cursor.parentElement;
      if (isFeedCardBoundary(cursor)) break;
      if (!cursor.getBoundingClientRect) continue;
      var rect = cursor.getBoundingClientRect();
      var headerOffset = signalRect.top - rect.top;
      var plausibleCard = rect.width >= viewportWidth * 0.72 &&
        rect.height >= 140 &&
        rect.height <= Math.max(1600, viewportHeight * 2.5) &&
        headerOffset >= -4 && headerOffset <= 200;
      if (!plausibleCard) continue;
      if (cursor.tagName !== 'A' && !fallback) fallback = cursor;
      if (cursor.tagName !== 'A' && containsWideFeedMedia(cursor, viewportWidth)) return cursor;
      if (cursor.matches('[data-mcomponent="MContainer"], section, li')) return cursor;
    }
    return fallback;
  }

  function hasSuggestedFeedHeading(card) {
    var headings = card.querySelectorAll('h2, h3, h4, [role="heading"]');
    for (var i = 0; i < headings.length; i++) {
      var text = normalizedControlValue(headings[i].textContent);
      for (var s = 0; s < FEEDS_ONLY_SUGGESTED_TEXT.length; s++) {
        if (text === FEEDS_ONLY_SUGGESTED_TEXT[s] ||
            text.indexOf(FEEDS_ONLY_SUGGESTED_TEXT[s] + ' ') === 0) return true;
      }
    }
    return false;
  }

  function hasSuggestedFeedMetadata(card) {
    if (!card || !card.querySelectorAll) return false;
    var nodes = [card];
    var descendants = card.querySelectorAll('[data-pagelet], [data-testid]');
    for (var d = 0; d < descendants.length; d++) nodes.push(descendants[d]);
    for (var i = 0; i < nodes.length; i++) {
      var compact = normalizedControlValue([
        nodes[i].getAttribute('data-pagelet'),
        nodes[i].getAttribute('data-testid')
      ].join(' ')).replace(/[^a-z0-9]+/g, '');
      if (compact.indexOf('suggestedfor') !== -1 ||
          compact.indexOf('recommendedfor') !== -1 ||
          compact.indexOf('recommendationunit') !== -1 ||
          compact.indexOf('peopleyoumayknow') !== -1) return true;
    }
    return false;
  }

  /* Facebook's chronological Feeds route can still inject recommendation
     cards. In Feeds-only mode, remove only cards carrying an explicit
     recommendation heading or an exact Follow/Join action in their header.
     Body text and lower comment controls are deliberately ignored. */
  function hideUnfollowedFeedCards() {
    var matchedCards = new Set();
    if (!feedsOnly || !isFacebookFeedsSurface()) {
      reconcileManagedFeedReason('recommendation', matchedCards);
      return;
    }
    var cards = document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit"]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (hasSuggestedFeedHeading(card) || hasSuggestedFeedMetadata(card)) {
        matchedCards.add(card);
        continue;
      }

      var controls = card.querySelectorAll(
        'button, a, [role="button"], [role="link"], [data-sigil~="touchable"]'
      );
      for (var c = 0; c < controls.length; c++) {
        if (isUnfollowedFeedAction(controls[c]) && isCardHeaderSignal(controls[c], card)) {
          matchedCards.add(card);
          break;
        }
      }
    }

    var looseHeadings = document.querySelectorAll('h2, h3, h4, [role="heading"]');
    for (var h = 0; h < looseHeadings.length; h++) {
      var heading = looseHeadings[h];
      var headingText = normalizedControlValue(heading.textContent);
      var isSuggested = false;
      for (var s = 0; s < FEEDS_ONLY_SUGGESTED_TEXT.length; s++) {
        if (headingText === FEEDS_ONLY_SUGGESTED_TEXT[s] ||
            headingText.indexOf(FEEDS_ONLY_SUGGESTED_TEXT[s] + ' ') === 0) {
          isSuggested = true;
          break;
        }
      }
      if (!isSuggested) continue;
      var headingCard = findFeedCardForSignal(heading);
      if (headingCard) matchedCards.add(headingCard);
    }

    var looseControls = document.querySelectorAll(
      'button, a, [role="button"], [role="link"], [data-sigil~="touchable"], ' +
      '[href*="subscribe" i], [href*="action=follow" i], [href*="action=join" i], ' +
      '[data-testid*="follow" i], [data-testid*="join" i], ' +
      '[data-action-id*="follow" i], [data-action-id*="join" i]'
    );
    for (var a = 0; a < looseControls.length; a++) {
      var action = looseControls[a];
      if (!isUnfollowedFeedAction(action)) continue;
      var actionCard = findFeedCardForSignal(action);
      if (actionCard && isCardHeaderSignal(action, actionCard)) {
        matchedCards.add(actionCard);
      }
    }

    /* WebLite also renders short header actions as plain touchable divs with
       no role. Direct text nodes avoid treating a whole card's concatenated
       copy as an action, while the header/card geometry prevents body and
       lower-comment controls from becoming false positives. */
    visitDirectTextElements(document.body, matchesUnfollowedActionText, function(action) {
      var actionCard = findFeedCardForSignal(action);
      if (actionCard && isCardHeaderSignal(action, actionCard)) {
        matchedCards.add(actionCard);
      }
    });

    reconcileManagedFeedReason('recommendation', matchedCards);
  }

  function isFeedAdDisclosure(element, directText) {
    if (matchesExactValue(directText, FACEBOOK_AD_TEXT) ||
        matchesExactValue(element.textContent, FACEBOOK_AD_TEXT) ||
        matchesExactValue(element.getAttribute && element.getAttribute('aria-label'), FACEBOOK_AD_TEXT) ||
        matchesExactValue(element.getAttribute && element.getAttribute('title'), FACEBOOK_AD_TEXT)) {
      return true;
    }
    if (!element || !element.getAttribute) return false;
    var metadata = normalizedControlValue([
      element.getAttribute('data-testid'),
      element.getAttribute('data-sigil'),
      element.getAttribute('href')
    ].join(' '));
    return /(?:sponsor|promoted|ad-preview|adpreferences|\/ads\/about|\/about\/ads)/.test(metadata) ||
      element.hasAttribute('data-ad-preview') || element.hasAttribute('data-sponsored');
  }

  /* Ads are core filtered content, not a side effect of Feeds-only mode. Keep
     this Home-scoped so post/photo/comment viewers retain their complete DOM. */
  function hideFeedAds() {
    if (!isFacebookFeedsSurface()) return;

    var attributeSignals = document.querySelectorAll(
      '[data-ad-preview], [data-sponsored], [data-testid*="sponsor" i], ' +
      '[data-testid*="promoted" i], [href*="/ads/about" i], ' +
      '[href*="/about/ads" i], [href*="/adpreferences" i]'
    );
    for (var i = 0; i < attributeSignals.length; i++) {
      var attributeSignal = attributeSignals[i];
      if (!isFeedAdDisclosure(attributeSignal, '')) continue;
      var attributeCard = findFeedCardForSignal(attributeSignal);
      if (attributeCard && !processed.has(attributeCard) &&
          isCardHeaderSignal(attributeSignal, attributeCard)) {
        collapseElement(attributeCard);
      }
    }

    visitDirectTextElements(document.body, function(value) {
      return matchesExactValue(value, FACEBOOK_AD_TEXT);
    }, function(disclosure, directText) {
      if (!isFeedAdDisclosure(disclosure, directText)) return;
      var card = findFeedCardForSignal(disclosure);
      if (card && !processed.has(card) && isCardHeaderSignal(disclosure, card)) {
        collapseElement(card);
      }
    });
  }

  function isExplicitFacebookHomeLink(value) {
    try {
      var url = new URL(value, window.location.href);
      var host = url.hostname.toLowerCase();
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return false;
      var path = url.pathname.toLowerCase();
      if (path !== '/' && path !== '/home.php') return false;
      if (url.searchParams.get('sk') === 'h_chr') return false;

      /* Root-query permalinks are content, not Home. They must retain the
         viewer DOM and back-stack even when Feeds-only mode is enabled. */
      var detailKeys = [
        'story_fbid', 'fbid', 'photo_id', 'video_id', 'post_id',
        'permalink_id', 'comment_id', 'reply_comment_id',
        'multi_permalinks', 'set', 'id'
      ];
      for (var d = 0; d < detailKeys.length; d++) {
        if (url.searchParams.has(detailKeys[d])) return false;
      }
      return true;
    } catch(e) { return false; }
  }

  function routeExplicitHomeClickToFeeds(event) {
    if (!feedsOnly || event.defaultPrevented) return;
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    var link = target && target.closest && target.closest('a[href]');
    if (!link || !isExplicitFacebookHomeLink(link.href || link.getAttribute('href'))) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    window.location.assign('/?filter=all&sk=h_chr');
  }

  function isMessagesNavigationLabel(value) {
    var label = (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (label === 'messages' || label === 'messenger') return true;
    /* Facebook WebLite exposes its icon-only header as ordinal tabs. The live
       Messages control was captured as "messages, 3 of 6" on iPhone. */
    return /^(?:messages|messenger),\s*(?:\d+\+?\s+new,\s*)?\d+\s+of\s+\d+$/.test(label);
  }

  function facebookWebMessagesDestination(value) {
    try {
      var url = new URL(value || '', window.location.href);
      var host = url.hostname.toLowerCase();
      var isFacebookHost = host === 'facebook.com' || host.endsWith('.facebook.com');
      if (isFacebookHost && /^\/messages(?:\/|$)/i.test(url.pathname)) {
        return url.pathname + url.search + url.hash;
      }
    } catch(e) {}
    return '/messages/';
  }

  function routeMessengerClickToWeb(event) {
    if (window.__dullFacebookMessagesRouting) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      return;
    }
    if (event.defaultPrevented) return;
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    if (!target || !target.closest) return;

    var control = target.closest(
      '[role="tab"][aria-label], button[aria-label], [role="button"][aria-label], ' +
      'a[aria-label], a[href]'
    );
    if (!control || control.closest('article, [role="article"]')) return;

    var labelled = control;
    if (!isMessagesNavigationLabel(labelled.getAttribute('aria-label'))) {
      labelled = control.querySelector && control.querySelector('[aria-label]');
    }
    var hasMessagesLabel = labelled &&
      isMessagesNavigationLabel(labelled.getAttribute('aria-label'));
    var role = control.getAttribute('role');
    var inNavigation = role === 'tab' ||
      !!control.closest('nav, [role="navigation"], [role="tablist"], [role="banner"]');

    /* Current WebLite headers do not always expose a navigation landmark.
       Accept their exact ordinal label, but never generic controls such as
       Marketplace's "Message seller" button. */
    var isOrdinalLabel = hasMessagesLabel &&
      /,\s*(?:\d+\+?\s+new,\s*)?\d+\s+of\s+\d+$/.test(
        (labelled.getAttribute('aria-label') || '').toLowerCase()
      );
    if (!hasMessagesLabel || (!inNavigation && !isOrdinalLabel)) return;

    var link = control.closest('a[href]') || (control.matches('a[href]') ? control : null);
    var destination = facebookWebMessagesDestination(
      link && (link.href || link.getAttribute('href'))
    );
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    window.__dullFacebookMessagesRouting = true;
    window.location.assign(destination);
  }

  /* --- Critical: known Reels links and semantic pager escape hatch ---
     Ordinary Facebook videos use /share/v/, /videos/, and video.php. Those
     are normal posts and must remain usable. Only explicit Reel/Watch routes
     are blocked before navigation; a route-less vertical pager is handled
     later from its semantic Reels marker without reloading the feed.

     Known media routes are also guarded here because Facebook currently uses
     /share/r/ and /share/v/ aliases in addition to /reel/ and /watch/. The
     shared history interceptor dispatches `dull-navigation` after SPA route
     changes, which gives this guard a second chance if Facebook opens media
     without a normal link click. */
  function isBlockedMediaURL(value) {
    try {
      var url = new URL(value || window.location.href, window.location.href);
      var host = url.hostname.toLowerCase();
      var isFacebookHost = host === 'facebook.com' || host.endsWith('.facebook.com');
      if (!isFacebookHost) return false;

      /* Facebook's exit-link wrapper can be absolute (l.facebook.com) or a
         relative /l.php URL on the current mobile host. */
      if (url.pathname === '/l.php') {
        var wrapped = url.searchParams.get('u');
        return wrapped ? isBlockedMediaURL(wrapped) : false;
      }

      var path = url.pathname.toLowerCase();
      return /^\/reels?(?:\/|$)/.test(path) ||
        /^\/watch(?:\/|$)/.test(path) ||
        /^\/share\/r(?:\/|$)/.test(path);
    } catch(e) { return false; }
  }

  function isBlockedMediaElement(element) {
    if (!element || !element.getAttribute) return false;
    var values = [
      element.href,
      element.getAttribute('href'),
      element.getAttribute('data-lynx-uri')
    ];
    for (var i = 0; i < values.length; i++) {
      if (values[i] && isBlockedMediaURL(values[i])) return true;
    }
    return false;
  }

  function firstBlockedMediaLink(root) {
    if (!root || !root.querySelectorAll) return null;
    var candidates = root.querySelectorAll(BLOCKED_MEDIA_LINK_SELECTOR);
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (isBlockedMediaElement(candidate)) return candidate;
    }
    return null;
  }

  var __dullFacebookHomeRedirecting = false;
  function returnToFacebookHome() {
    if (__dullFacebookHomeRedirecting) return;
    __dullFacebookHomeRedirecting = true;
    window.location.replace(feedsOnly ? '/?filter=all&sk=h_chr' : window.location.origin + '/');
  }

  function blockFeedMediaClick(event) {
    if (!feedVideoHomeRedirect || event.defaultPrevented) return;
    var target = event.target;
    if (!target) return;
    if (target.nodeType !== 1) target = target.parentElement;
    if (!target || !target.closest) return;

    var link = target.closest('a[href]');
    var blockedLink = !!(link && isBlockedMediaURL(link.href || link.getAttribute('href')));
    if (!blockedLink) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    /* Stay on the current feed DOM. Replacing the page with Facebook Home
       destroyed scroll position and looked like every media tap refreshed the
       app. Direct media routes and full-screen chained viewers are still
       handled by the guards below. */
  }

  function guardBlockedMediaRoute() {
    if (!feedVideoHomeRedirect || !isBlockedMediaURL(window.location.href)) return false;
    returnToFacebookHome();
    return true;
  }

  /* Live Facebook (2026-07-16) renders the scrollable viewer as a full-screen
     dialog containing data-pagelet="Reels" / "ReelsUFIBar". Older mobile DOM
     used VideoChastityControlledMediaChainingFeed. These semantic markers are
     substantially safer than treating any scrollable dialog with videos as a
     Reels pager. The marker itself may already be display:none from filter.css,
     so visibility must be checked on its outer dialog to avoid a blank modal. */
  var BLOCKED_VIEWER_MARKER =
    '[data-pagelet="Reels"], [aria-label*="Reels player" i]';
  var VIEWER_ROOT_SELECTOR = '[role="dialog"], [aria-modal="true"]';
  var viewerRootObservers = new WeakMap();

  function isVisibleBlockedViewerRoot(root) {
    if (!root || !root.isConnected || root.hidden || root.getAttribute('aria-hidden') === 'true') return false;
    var style = window.getComputedStyle(root);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        parseFloat(style.opacity || '1') === 0) return false;
    var rect = root.getBoundingClientRect();
    var viewportWidth = window.innerWidth || 375;
    var viewportHeight = window.innerHeight || 667;
    var visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    var visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return visibleWidth >= viewportWidth * 0.65 && visibleHeight >= viewportHeight * 0.55;
  }

  function checkBlockedViewerRoot(root) {
    if (!feedVideoHomeRedirect || !isVisibleBlockedViewerRoot(root)) return false;
    /* This viewer was opened on top of an existing feed. Collapse just the
       Reel surface and restore scrolling; replacing window.location here was
       the source of the disruptive full-page refresh. */
    collapseElement(root);
    root.setAttribute('aria-hidden', 'true');
    if (document.body) document.body.style.overflow = '';
    return true;
  }

  function observeBlockedViewerRoot(root) {
    if (!root || viewerRootObservers.has(root)) return;
    var rootObserver = new MutationObserver(function() {
      try { checkBlockedViewerRoot(root); } catch(e) {}
    });
    rootObserver.observe(root, {
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'class', 'style']
    });
    viewerRootObservers.set(root, rootObserver);
  }

  function registerBlockedViewerMarker(marker) {
    if (!marker || !marker.closest) return false;
    var root = marker.closest(VIEWER_ROOT_SELECTOR);
    if (!root) return false;
    observeBlockedViewerRoot(root);
    return checkBlockedViewerRoot(root);
  }

  function guardBlockedMediaViewer(scope) {
    if (!feedVideoHomeRedirect || !scope) return false;
    if (scope.nodeType === 1 && scope.matches && scope.matches(BLOCKED_VIEWER_MARKER)) {
      if (registerBlockedViewerMarker(scope)) return true;
    }
    if (!scope.querySelectorAll) return false;
    var markers = scope.querySelectorAll(BLOCKED_VIEWER_MARKER);
    for (var i = 0; i < markers.length; i++) {
      if (registerBlockedViewerMarker(markers[i])) return true;
    }
    return false;
  }

  /* Window capture runs before Facebook's document/root click delegation. */
  window.addEventListener('pointerdown', routeMessengerClickToWeb, true);
  window.addEventListener('touchstart', routeMessengerClickToWeb, { capture: true, passive: false });
  window.addEventListener('click', routeMessengerClickToWeb, true);
  if (feedVideoHomeRedirect) window.addEventListener('click', blockFeedMediaClick, true);
  if (feedsOnly) window.addEventListener('click', routeExplicitHomeClickToFeeds, true);

  /* --- Critical: Top app-install banner (runs early before deferred) --- */
  function hasAppStoreDestination(el) {
    var href = (el && el.getAttribute && el.getAttribute('href') || '').toLowerCase();
    return href.includes('itunes') || href.includes('apps.apple.com') || href.includes('play.google');
  }

  function isLikelyTopAppBannerElement(el) {
    if (!el || !el.getBoundingClientRect || el.closest('article, [role="article"]')) return false;
    var rect = el.getBoundingClientRect();
    var viewportWidth = window.innerWidth || 375;
    return rect.top >= -12 && rect.top <= 120 && rect.height > 0 && rect.height <= 140 &&
      rect.width >= viewportWidth * 0.55;
  }

  function hideTopAppBanner() {
    /* Use TreeWalker to find the banner text node regardless of element structure */
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var text = (walker.currentNode.textContent || '').toLowerCase();
      if (text.includes('get facebook for') || text.includes('browse faster') ||
          text.includes('download the facebook app')) {
        /* Walk up while the subtree still contains only prompt copy. Current
           m.facebook.com uses nested plain divs rather than a banner role; the
           outermost shallow, full-width node removes its 42px reserved band. */
        var el = walker.currentNode.parentElement;
        var candidate = null;
        for (var u = 0; u < 8; u++) {
          if (!el || el === document.body) break;
          if (el.tagName === 'ARTICLE' || el.getAttribute('role') === 'article' ||
              el.getAttribute('role') === 'dialog') break;
          var elText = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (elText.length > 240) break;
          if (isLikelyTopAppBannerElement(el) || hasAppStoreDestination(el)) candidate = el;
          el = el.parentElement;
        }
        if (candidate && !processed.has(candidate)) {
          hideEl(candidate);
          return;
        }
      }
    }
  }

  function processCritical() {
    processAttributeElements();
    hideReelsTab();
    hideFeedReelCards();
    hideFeedAds();
    hideUnfollowedFeedCards();
    hideTopAppBanner();
  }

  /* --- Deferred: text-based scanning (expensive, run during idle) --- */
  function scanForTextBasedHiding() {
    var hasReels = cfg.reels;
    var hasSuggested = cfg.suggested !== undefined ? cfg.suggested : false;
    if (!hasReels && !hasSuggested) return;
    /* Only scan headings and UI labels — NOT post body text.
       This prevents false positives like "fishing reels" in user posts. */
    var allElements = document.querySelectorAll('h2, h3, h4, [role="heading"], [data-pagelet] > div > span:first-child');
    for (var i = 0; i < allElements.length; i++) {
      var span = allElements[i];
      if (processed.has(span)) continue;
      var text = (span.textContent || '').toLowerCase().trim();
      /* Home shelves are reconciled reversibly in hideFeedReelCards(). */
      if (hasReels && isFacebookFeedsSurface() && isReelShelfHeadingText(text)) continue;
      var isTarget = false;
      /* Reels text — only scan if reels config is enabled */
      if (hasReels) {
        for (var r = 0; r < REELS_TEXT.length; r++) {
          if (REELS_TEXT[r].indexOf(' ') !== -1) {
            if (text.includes(REELS_TEXT[r])) { isTarget = true; break; }
          } else {
            if (text === REELS_TEXT[r]) { isTarget = true; break; }
          }
        }
      }
      /* Suggested text — only scan if suggested config is enabled */
      if (!isTarget && hasSuggested) {
        for (var s = 0; s < SUGGESTED_TEXT.length; s++) {
          if (text === SUGGESTED_TEXT[s] || text.includes(SUGGESTED_TEXT[s])) { isTarget = true; break; }
        }
      }
      if (isTarget) {
        processed.add(span);
        var container = span;
        for (var j = 0; j < 4; j++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          if (container.getAttribute('data-pagelet') || container.getAttribute('role') === 'article' || container.getAttribute('role') === 'feed' || container.getAttribute('data-mcomponent') === 'MContainer') break;
        }
        /* Guard against collapsing root-level elements (body/html/main) */
        if (container === document.body || container === document.documentElement ||
            container.tagName === 'MAIN' || container.getAttribute('role') === 'feed') {
          collapseElement(span);
        } else {
          collapseElement(container);
        }
      }
    }
  }

  /* --- Deferred: Open in App banners (always on — functional, not content filtering) --- */
  function hideOpenInAppBanners() {
    /* Facebook sigils are space-separated tokens. Match only known app-promo
       tokens; substring matching also catches legitimate event_banner and
       promote-post controls on groups and Pages. */
    var promos = document.querySelectorAll(
      '[data-sigil~="m-promo-jewel"], [data-sigil~="app_banner"], [data-sigil~="m-promo"]'
    );
    for (var i = 0; i < promos.length; i++) hideEl(promos[i]);
    /* Top "Get Facebook for iOS" banner — a link/div at the top of the page */
    var topLinks = document.querySelectorAll('a, div[role="link"]');
    for (var t = 0; t < topLinks.length; t++) {
      var link = topLinks[t];
      if (processed.has(link)) continue;
      var linkText = (link.textContent || '').toLowerCase();
      if (linkText.includes('get facebook for') || linkText.includes('download the facebook app')) {
        if (isLikelyTopAppBannerElement(link) || hasAppStoreDestination(link)) hideEl(link);
      }
    }
    var APP_TEXTS = ['open app', 'use app', 'get the app', 'use the app', 'open in app', 'continue in app'];

    function isAppPromptControl(control) {
      var value = (control.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      for (var a = 0; a < APP_TEXTS.length; a++) {
        if (value === APP_TEXTS[a]) return true;
      }
      if (value.length <= 160 && (
          value.includes('use the facebook app') || value.includes('download the facebook app') ||
          value.includes('open in app') ||
          value.includes('continue in app') || value.includes('best experience on the app')
      )) return true;
      var href = (control.getAttribute && control.getAttribute('href') || '').toLowerCase();
      return href.includes('itunes') || href.includes('apps.apple.com') || href.includes('play.google');
    }

    function isPromptOnlySurface(surface) {
      var path = (window.location.pathname || '').toLowerCase();
      if (path.indexOf('/marketplace') === 0) return false;
      if (surface.querySelector('h1, h2, article, [data-pagelet*="Marketplace" i], a[href*="/marketplace/item/"]')) {
        return false;
      }
      var text = (surface.textContent || '').replace(/\s+/g, ' ').trim();
      return text.length <= 240;
    }

    function hidePromptWithoutHidingContent(control, surface) {
      if (surface && isPromptOnlySurface(surface)) {
        hideEl(surface);
        return;
      }

      var target = control;
      var controlLength = (control.textContent || '').trim().length;
      for (var depth = 0; depth < 3; depth++) {
        var parent = target.parentElement;
        if (!parent || parent === surface || parent === document.body ||
            parent.tagName === 'MAIN' || parent.tagName === 'ARTICLE') break;
        var parentText = (parent.textContent || '').replace(/\s+/g, ' ').trim();
        if (parentText.length > controlLength + 120) break;
        target = parent;
      }
      hideEl(target);
    }

    /* Marketplace details often render the app CTA as a fixed bottom button,
       not inside a semantic dialog/banner. Match the exact CTA and remove only
       its small wrapper so the listing and seller controls remain untouched. */
    var currentPath = (window.location.pathname || '').toLowerCase();
    if (currentPath.indexOf('/marketplace') === 0) {
      var marketplaceControls = document.querySelectorAll(
        'button, a, [role="button"], [role="link"]'
      );
      for (var m = 0; m < marketplaceControls.length; m++) {
        var marketplaceControl = marketplaceControls[m];
        if (!processed.has(marketplaceControl) && isAppPromptControl(marketplaceControl)) {
          hidePromptWithoutHidingContent(
            marketplaceControl,
            marketplaceControl.closest('[role="dialog"], [role="banner"]')
          );
        }
      }
    }

    /* A content dialog can contain a small nested "Open in app" prompt. Never
       classify the whole dialog from descendant text: doing so blanked some
       Marketplace listing sheets. */
    var dialogs = document.querySelectorAll('div[role="dialog"], div[role="banner"]');
    for (var j = 0; j < dialogs.length; j++) {
      var surface = dialogs[j];
      if (processed.has(surface)) continue;
      var candidates = surface.querySelectorAll('button, a, [role="button"], [role="link"], p, span');
      for (var c = 0; c < candidates.length; c++) {
        if (!isAppPromptControl(candidates[c])) continue;
        hidePromptWithoutHidingContent(candidates[c], surface);
        break;
      }
    }

    /* Handle standalone sticky/fixed app prompts. Stop at content/dialog
       boundaries, and only trust promo-specific sigils rather than every
       data-sigil attribute Facebook uses for normal controls. */
    var buttons = document.querySelectorAll('div[role="button"], a[role="button"], button, a, [data-sigil*="touchable"]');
    for (var f = 0; f < buttons.length; f++) {
      var btn = buttons[f];
      if (processed.has(btn) || !isAppPromptControl(btn)) continue;
      if (btn.closest('[role="dialog"], [role="banner"]')) continue;
      if (btn.closest('article, [role="article"]')) continue;

      /* Text alone is not enough here: ordinary posts and help links can
         discuss downloading Facebook. Require app-store, top-banner, promo,
         or sticky/fixed positioning evidence before removing anything. */
      var target = (hasAppStoreDestination(btn) || isLikelyTopAppBannerElement(btn)) ? btn : null;
      var cursor = btn;
      for (var u = 0; u < 4; u++) {
        var parent = cursor.parentElement;
        if (!parent || parent === document.body || parent.tagName === 'MAIN' ||
            parent.tagName === 'ARTICLE' || parent.getAttribute('role') === 'dialog') break;
        var sigil = (parent.getAttribute('data-sigil') || '').toLowerCase();
        var position = parent.style && parent.style.position;
        var sigilTokens = sigil.split(/\s+/);
        if (sigilTokens.indexOf('m-promo-jewel') !== -1 ||
            sigilTokens.indexOf('app_banner') !== -1 ||
            sigilTokens.indexOf('m-promo') !== -1 ||
            position === 'fixed' || position === 'sticky' ||
            isLikelyTopAppBannerElement(parent)) {
          target = parent;
          break;
        }
        cursor = parent;
      }
      if (target) hideEl(target);
    }
    if (document.body && document.body.style.overflow === 'hidden') {
      var hasVisible = false;
      var allDialogs = document.querySelectorAll('div[role="dialog"]');
      for (var k = 0; k < allDialogs.length; k++) { if (allDialogs[k].style.display !== 'none') { hasVisible = true; break; } }
      if (!hasVisible) document.body.style.overflow = '';
    }
  }

  function hideMarketplaceAds() {
    var path = (window.location.pathname || '').toLowerCase();
    if (path.indexOf('/marketplace') !== 0) return;

    var sponsoredLabels = [
      'ad', 'sponsored', 'sponsored listing', 'promoted', 'advertisement',
      'patrocinado', 'publicidad', 'gesponsert', 'anzeige',
      'sponsorisé', 'publicité', 'sponsorizzato', 'pubblicità',
      'gesponsord', 'advertentie', 'sponsitud', 'reklaam',
      'sponsoroitu', 'mainos', 'sponsrad', 'annons',
      'sponset', 'annonse', 'sponsoreret', 'annonce',
      'sponsorowane', 'reklama', 'sponzorováno'
    ];

    function normalizeDisclosure(value) {
      return (value || '')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function matchesSponsoredLabel(value) {
      var normalized = normalizeDisclosure(value);
      if (!normalized || normalized.length > 180) return false;
      for (var i = 0; i < sponsoredLabels.length; i++) {
        var term = sponsoredLabels[i];
        if (term === 'ad') {
          if (normalized === 'ad' ||
              normalized.indexOf('ad ·') === 0 ||
              normalized.indexOf('ad •') === 0 ||
              normalized.indexOf('ad |') === 0 ||
              normalized.indexOf('ad:') === 0) return true;
          continue;
        }
        if (normalized === term ||
            normalized.indexOf(term + ' ·') === 0 ||
            normalized.indexOf(term + ' •') === 0 ||
            normalized.indexOf(term + ' |') === 0 ||
            normalized.indexOf(term + ':') === 0 ||
            normalized.indexOf(term + ' -') === 0 ||
            normalized.indexOf(term + ' ') === 0) return true;
      }
      return false;
    }

    function isSponsoredDisclosure(element) {
      if (matchesSponsoredLabel(element.textContent) ||
          matchesSponsoredLabel(element.getAttribute && element.getAttribute('aria-label')) ||
          matchesSponsoredLabel(element.getAttribute && element.getAttribute('title'))) return true;

      var testID = normalizeDisclosure(element.getAttribute && element.getAttribute('data-testid'));
      if (testID.indexOf('sponsor') !== -1 || testID.indexOf('promoted') !== -1) return true;
      if (element.hasAttribute && (element.hasAttribute('data-ad-preview') ||
          element.hasAttribute('data-sponsored'))) return true;

      var href = normalizeDisclosure(element.getAttribute && element.getAttribute('href'));
      return href.indexOf('/ads/about') !== -1 ||
        href.indexOf('/about/ads') !== -1 ||
        href.indexOf('/adpreferences') !== -1;
    }

    function marketplaceItemLinkCount(root) {
      if (!root || !root.querySelectorAll) return 0;
      var links = root.querySelectorAll('a[href*="/marketplace/item/"]');
      var unique = Object.create(null);
      var count = 0;
      for (var i = 0; i < links.length; i++) {
        var href = (links[i].getAttribute('href') || '').split('?')[0];
        if (!href || unique[href]) continue;
        unique[href] = true;
        count++;
      }
      return count;
    }

    function hasSubstantialMarketplaceMedia(root) {
      if (!root || !root.querySelectorAll || !root.getBoundingClientRect) return false;
      var rootRect = root.getBoundingClientRect();
      var media = root.querySelectorAll('img, video, [role="img"]');
      for (var i = 0; i < media.length; i++) {
        if (!media[i].getBoundingClientRect) continue;
        var rect = media[i].getBoundingClientRect();
        if (rect.width >= Math.max(96, rootRect.width * 0.55) && rect.height >= 96) return true;
      }
      return false;
    }

    function isPlausibleMarketplaceAdCell(element, disclosure) {
      if (!element || !disclosure || !element.getBoundingClientRect ||
          !disclosure.getBoundingClientRect) return false;
      var rect = element.getBoundingClientRect();
      var signalRect = disclosure.getBoundingClientRect();
      var viewportWidth = window.innerWidth || 375;
      var viewportHeight = window.innerHeight || 667;
      var headerOffset = signalRect.top - rect.top;
      return rect.width >= viewportWidth * 0.28 &&
        rect.width <= viewportWidth * 0.72 &&
        rect.height >= 160 &&
        rect.height <= Math.max(1400, viewportHeight * 2.2) &&
        headerOffset >= -4 && headerOffset <= Math.min(140, rect.height * 0.4) &&
        hasSubstantialMarketplaceMedia(element);
    }

    function isMarketplaceHeaderSignal(signal, card) {
      if (!signal || !card || !signal.getBoundingClientRect || !card.getBoundingClientRect) {
        return false;
      }
      var signalRect = signal.getBoundingClientRect();
      var cardRect = card.getBoundingClientRect();
      if (signalRect.height <= 0 || cardRect.height <= 0) return false;
      var offset = signalRect.top - cardRect.top;
      return offset >= -4 && offset <= Math.min(140, cardRect.height * 0.4);
    }

    function isMarketplaceBoundary(element) {
      if (!element || element === document.body || element === document.documentElement) return true;
      if (element.tagName === 'MAIN' || element.getAttribute('role') === 'main' ||
          element.getAttribute('role') === 'dialog') return true;
      return false;
    }

    function findSponsoredContainer(disclosure) {
      var semantic = disclosure.closest(
        'article, [role="article"], [data-testid*="marketplace_feed_item" i], ' +
        '[data-testid*="sponsor" i], [data-testid*="promoted" i], ' +
        '[data-ad-preview], [data-sponsored], [data-mcomponent="MContainer"]'
      );
      if (semantic && !isMarketplaceBoundary(semantic) &&
          (marketplaceItemLinkCount(semantic) > 0 ||
           semantic.hasAttribute('data-ad-preview') || semantic.hasAttribute('data-sponsored') ||
           isPlausibleMarketplaceAdCell(semantic, disclosure))) {
        return semantic;
      }

      /* Current Marketplace grids frequently omit article/role markers and
         nest the disclosure many levels below the product link. Select the
         smallest common wrapper containing the disclosure and a listing. */
      var cursor = disclosure;
      for (var depth = 0; depth < 14; depth++) {
        cursor = cursor.parentElement;
        if (isMarketplaceBoundary(cursor)) break;
        if (isPlausibleMarketplaceAdCell(cursor, disclosure)) return cursor;
        var itemCount = marketplaceItemLinkCount(cursor);
        if (itemCount === 1 && cursor.tagName !== 'A') return cursor;
        if (itemCount > 1) {
          var role = (cursor.getAttribute('role') || '').toLowerCase();
          var testID = normalizeDisclosure(cursor.getAttribute('data-testid'));
          if (cursor.tagName === 'SECTION' || role === 'region' || role === 'list' ||
              testID.indexOf('sponsor') !== -1 || testID.indexOf('promoted') !== -1) {
            return cursor;
          }
          break;
        }
      }
      return null;
    }

    function hideMarketplaceDisclosure(label, directText) {
      var ancestor = label;
      while (ancestor && ancestor !== document.body) {
        if (processed.has(ancestor)) return;
        ancestor = ancestor.parentElement;
      }
      if (!matchesSponsoredLabel(directText) && !isSponsoredDisclosure(label)) return;
      var card = findSponsoredContainer(label);
      if (!card || processed.has(card)) return;
      if (normalizeDisclosure(directText) === 'ad' && !isMarketplaceHeaderSignal(label, card)) return;
      collapseElement(card);
    }

    var labels = document.querySelectorAll(
      'span, p, a, [role="text"], [aria-label], [title], ' +
      '[data-ad-preview], [data-sponsored], ' +
      '[data-testid*="sponsor" i], [data-testid*="promoted" i]'
    );
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (processed.has(label)) continue;
      hideMarketplaceDisclosure(label, '');
    }


    /* WebLite's load-more grid uses plain divs for the short "Ad" disclosure.
       Read direct text nodes so a parent grid's concatenated copy cannot turn
       the entire Marketplace surface into an ad candidate. */
    visitDirectTextElements(document.body, matchesSponsoredLabel, function(label, directText) {
      hideMarketplaceDisclosure(label, directText);
    });
  }

  function processDeferred() {
    scanForTextBasedHiding();
    hideOpenInAppBanners();
    hideMarketplaceAds();
  }

  function scheduleDeferred() {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(function() { try { processDeferred(); } catch(e) {} });
    } else {
      setTimeout(function() { try { processDeferred(); } catch(e) {} }, 100);
    }
  }

  try { guardBlockedMediaRoute(); } catch(e) {}
  try { guardBlockedMediaViewer(document); } catch(e) {}
  try { processCritical(); } catch(e) {}
  scheduleDeferred();
  /* Early retries for app-install banner (may render after initial parse) */
  setTimeout(function() { try { hideTopAppBanner(); } catch(e) {} }, 500);
  setTimeout(function() { try { hideTopAppBanner(); } catch(e) {} }, 1500);

  /* --- MutationObserver with rAF debounce --- */
  var rafPending = false;
  var deferredWhileEditing = false;

  function scheduleFilterPass() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() {
      rafPending = false;
      if (isEditingFocused()) {
        deferredWhileEditing = true;
        return;
      }
      deferredWhileEditing = false;
      try { processCritical(); } catch(e) {}
      scheduleDeferred();
    });
  }

  function isRelevantCharacterMutation(mutation) {
    var parent = mutation.target && mutation.target.parentElement;
    if (!parent) return false;
    if (parent.closest('[' + MANAGED_FEED_REASON_ATTRIBUTE + ']')) return true;
    var value = normalizedControlValue(mutation.target.nodeValue);
    if (feedsOnly && (matchesUnfollowedActionText(value) ||
        FEEDS_ONLY_SUGGESTED_TEXT.indexOf(value) !== -1)) return true;
    return !!cfg.reels && isReelShelfHeadingText(value);
  }

  var observer = new MutationObserver(function(mutations) {
    var shouldSchedule = false;
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === 'attributes') {
        try { guardBlockedMediaViewer(mutation.target); } catch(e) {}
        shouldSchedule = true;
        continue;
      }
      if (mutation.type === 'characterData') {
        if (isRelevantCharacterMutation(mutation)) shouldSchedule = true;
        continue;
      }
      if (mutation.addedNodes.length > 0) {
        shouldSchedule = true;
        if (feedVideoHomeRedirect) {
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            var added = mutation.addedNodes[j];
            if (added.nodeType !== 1) continue;
            try { guardBlockedMediaViewer(added); } catch(e) {}
          }
        }
      }
    }
    if (shouldSchedule) scheduleFilterPass();
  });
  var observerOptions = {
    childList: true,
    subtree: true
  };
  if (feedVideoHomeRedirect || feedsOnly || cfg.reels) {
    observerOptions.attributes = true;
    observerOptions.characterData = true;
    observerOptions.attributeFilter = [
      'href', 'data-lynx-uri', 'data-pagelet', 'data-testid', 'data-sigil',
      'data-action-id', 'action', 'name', 'aria-label', 'role', 'aria-modal',
      'aria-hidden', 'hidden'
    ];
  }
  observer.observe(document.body || document.documentElement, observerOptions);

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
      if (dialog.getClientRects && dialog.getClientRects().length === 0) continue;
      return true;
    }
    var otpFields = document.querySelectorAll(
      'input[autocomplete*="one-time-code"], input[inputmode="numeric"], ' +
      'input[name*="confirmationCode" i], input[name*="verificationCode" i], ' +
      'input[name*="code" i][maxlength], input[aria-label*="code" i]'
    );
    for (var o = 0; o < otpFields.length; o++) {
      var otp = otpFields[o];
      if (otp.closest('[hidden], [aria-hidden="true"]')) continue;
      var os = window.getComputedStyle(otp);
      if (os.display !== 'none' && os.visibility !== 'hidden' && os.opacity !== '0' &&
          os.contentVisibility !== 'hidden' &&
          (!otp.getClientRects || otp.getClientRects().length > 0)) return true;
    }
    return false;
  }

  var lastScrollScanAt = 0;
  var trailingScrollTimer = 0;
  function scheduleScrollReconcile() {
    var now = Date.now();
    if (now - lastScrollScanAt >= 250) {
      lastScrollScanAt = now;
      scheduleFilterPass();
    }
    clearTimeout(trailingScrollTimer);
    trailingScrollTimer = setTimeout(function() {
      lastScrollScanAt = Date.now();
      scheduleFilterPass();
    }, 120);
  }

  document.addEventListener('scroll', scheduleScrollReconcile, true);
  window.addEventListener('scroll', scheduleScrollReconcile, { passive: true });
  document.addEventListener('focusout', function() {
    if (deferredWhileEditing) scheduleFilterPass();
  }, true);

  window.addEventListener('dull-navigation', function() {
    try { if (guardBlockedMediaRoute()) return; } catch(e) {}
    try { if (guardBlockedMediaViewer(document)) return; } catch(e) {}
    if (isEditingFocused()) return;
    try { processCritical(); } catch(e) {}
    scheduleDeferred();
  });

  setInterval(function() {
    if (isEditingFocused()) return;
    if (!document.getElementById('dull-filter')) {
      try { window.webkit.messageHandlers.dullReinject.postMessage({ platform: 'facebook', reason: 'css_missing_periodic' }); } catch(e) {}
    }
  }, 30000);

  window.__dullPlatformInit_facebook = true;
})();
