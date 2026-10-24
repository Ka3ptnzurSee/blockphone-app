(function() {
  'use strict';
  if (!/instagram\.com$/i.test(window.location.hostname)) return;
  // Re-entry guard. FilterService.reinjectScript re-evals this IIFE on the
  // live page during health-check auto-recovery; without the guard each call
  // installs a fresh MutationObserver + setInterval, leaking observers. The
  // guard is SET at the very end of the IIFE so a partial-init crash leaves
  // the flag unset and the next reinject can recover.
  if (window.__dullPlatformInit_instagram) return;
  var cfg = window.__dullConfig || {};
  var processed = new WeakSet();
  var __dullBlockedCount = 0;
  var __dullCountPending = false;

  /* --- Keyboard-aware layout viewport ---
     IG's reply input on stories/DMs is position:fixed; bottom:0. WebKit's default
     `interactive-widget=resizes-visual` keeps the layout viewport full-size when
     the keyboard opens, so the input anchors below the keyboard and is unreachable.
     Override to `resizes-content` so the layout viewport shrinks with the keyboard
     and bottom-fixed inputs naturally land above it. iOS 16.4+ honors this. */
  function overrideViewportMeta() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    var content = meta.getAttribute('content') || 'width=device-width, initial-scale=1';
    var next = /interactive-widget=/.test(content)
      ? content.replace(/interactive-widget=[^,]+/, 'interactive-widget=resizes-content')
      : content + ', interactive-widget=resizes-content';
    if (meta.getAttribute('content') !== next) meta.setAttribute('content', next);
  }
  overrideViewportMeta();
  if (document.head) {
    new MutationObserver(overrideViewportMeta).observe(document.head, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['content']
    });
  }
  window.addEventListener('dull-navigation', overrideViewportMeta);

  function reportCount() {
    if (__dullCountPending) return;
    __dullCountPending = true;
    setTimeout(function() {
      __dullCountPending = false;
      try { window.webkit.messageHandlers.dullFilterCount.postMessage({ platform: 'instagram', count: __dullBlockedCount }); } catch(e) {}
    }, 500);
  }

  /* Dull's own injected controls (story compose entry and bar) sit among
     Instagram's nodes and must never be swept up by a sibling walk. */
  function isDullOwned(el) {
    return !!(el && el.id && el.id.indexOf('dull-story-compose') === 0);
  }

  /* Collapsed elements are also tagged with data-dull-collapsed, which
     filter.css hides with a stylesheet rule. Instagram's React tree rewrites
     inline style on re-render; the element then stayed in `processed` and was
     never collapsed again, so the same post could be hidden on one load and
     back on the next. The attribute survives a style rewrite. */
  function collapseElement(el, reason) {
    if (isDullOwned(el)) return;
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();
    try { el.setAttribute('data-dull-collapsed', reason || 'filtered'); } catch(e) {}
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
    if (isDullOwned(el)) return;
    if (processed.has(el)) return;
    processed.add(el);
    __dullBlockedCount++;
    reportCount();
    el.style.setProperty('display', 'none', 'important');
  }

  /* --- Reel articles in feed --- */
  /* --- Single-post routes ---
     A reel shared into Dull from outside (share sheet, Safari, a text
     message) lands on /reel/<id>/ or /p/<id>/, which Instagram renders as
     one <article> full of /reel/ links under a "Post" header. The feed-card
     collapse rules, here and in filter.css, were written for Home and
     matched that article too, so the page was a black body. The DM overlay
     never hit this because it is not an <article>. Mark the route on <html>
     so those rules stand down there; the reel itself stays governed by
     enforceSingleReel() and lockReelsPager(). Reported on UserJot
     2026-09-01, reproduced logged in on 2026-09-08. */
  var SINGLE_POST_ROUTE = /^\/(?:reel|reels|p)\/[^\/]+/;
  function isSinglePostRoute() {
    return SINGLE_POST_ROUTE.test(window.location.pathname);
  }
  function markSinglePostRoute() {
    var root = document.documentElement;
    if (!root) return;
    if (isSinglePostRoute()) root.setAttribute('data-dull-single-post', '');
    else root.removeAttribute('data-dull-single-post');
  }

  function processArticles() {
    if (!cfg.reels) return;
    if (isSinglePostRoute()) return;
    var articles = document.querySelectorAll('article');
    for (var a = 0; a < articles.length; a++) {
      var article = articles[a];
      if (processed.has(article)) continue;
      var links = article.querySelectorAll('a[href*="/reel"]');
      if (links.length > 0) {
        collapseElement(article);
        try { var vids = article.querySelectorAll('video'); for (var v = 0; v < vids.length; v++) vids[v].pause(); } catch(e) {}
        continue;
      }
      var ariaLabel = (article.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('reel')) collapseElement(article);
    }
  }

  /* --- Labelled feed cards: sponsored and suggested posts ---

     Instagram marks an ad with a short "Sponsored" label, and a recommended
     post from an account you do not follow with "Suggested for you", both in
     the post header above the media. Neither carries a durable attribute.

     What broke before (2026-10, two UserJot reports, one on iOS 26.7.1, "ads
     seem to be the only thing I see"): detection only looked at
     `header span`, `header a` and `span[dir="auto"]`, and only trusted the
     label if it came before the first <img>/<video> outside a <header>. The
     current feed renders the post header as plain <div>s, the label as a
     plain <span> (dir="auto" is for user text such as usernames, not for UI
     copy), and the advertiser's avatar <img> sits in that header. So the
     candidate query missed the label, and even when it found one, the avatar
     counted as "the first media", the label came after it, and the ad was
     ruled out. Suggested posts were worse: the text scan matched the
     per-post label, collapsed only the label's parent span and a few header
     siblings, and left the post itself on screen, English only.

     Detection now walks the article's own nodes in document order up to the
     post's main media, skipping avatars, and accepts a label anywhere in that
     header region regardless of tag. The before-media rule is unchanged in
     spirit: a caption, which always sits below the media, can still never
     collapse a post. Labels are matched whole, or as "label · ..." heads. */

  /* Kept in step with FACEBOOK_AD_TEXT in facebook/filter.js. Instagram
     localizes this label to the *account's* language, which is independent of
     Dull's UI language, so the table has to cover more locales than the app
     ships in. Arrays, not object literals: a plain object inherits
     'constructor', 'toString' and friends, so a lookup on one of those keys
     returns a truthy prototype member and misreads ordinary text as an ad. */
  var sponsoredMarkers = [
    'sponsored', 'promoted',
    'gesponsert', 'anzeige', 'werbung',
    'publicidad', 'patrocinado', 'patrocinada', 'anuncio',
    'sponsorisé', 'publicité',
    'sponsorizzato', 'pubblicità',
    'gesponsord', 'advertentie',
    'sponsitud', 'reklaam',
    /* uBO uAssets filters-mobile.txt, the m.facebook.com sponsored rules;
       Meta uses the same strings on Instagram. Same set as FACEBOOK_AD_TEXT
       minus the bare 'ad', which is too easily a username or a word. */
    'sponsorlu', 'sponsorowane', 'geborg', 'bersponsor', 'ditaja',
    'disponsori', 'giisponsoran', 'sponzorováno', 'sponzorované',
    'sponsoreret', 'may sponsor', 'sponzorirano', 'hirdetés', 'sponset',
    'sponsorizat', 'sponsoroitu', 'sponsrat', 'được tài trợ',
    'χορηγούμενη', 'спонсорирано', 'спонзорирано', 'спонзорисано',
    'реклама', 'במימון', 'प्रायोजित', 'স্পনসর্ড', '광고', '贊助', '赞助内容', '広告'
  ];

  /* Per-post recommendation labels. English, plus the languages Dull ships
     in (de, es) and the ones the ads table already covers. */
  var suggestedPostMarkers = [
    'suggested for you', 'suggested post', 'suggested posts', 'suggested',
    'recommended for you', 'recommended',
    'vorschläge für dich', 'vorschlag für dich', 'vorgeschlagen für dich',
    'für dich vorgeschlagen', 'vorgeschlagener beitrag', 'vorgeschlagene beiträge',
    'vorgeschlagen', 'empfohlen für dich', 'empfohlen',
    'sugerencias para ti', 'sugerencia para ti', 'sugerido para ti', 'sugerida para ti',
    'publicaciones sugeridas', 'publicación sugerida', 'sugerido', 'sugerida',
    'recomendado para ti', 'recomendado',
    'suggestions pour vous', 'suggestion pour vous', 'suggéré pour vous',
    'publications suggérées', 'publication suggérée', 'suggéré', 'suggérée',
    'suggeriti per te', 'suggerito per te', 'suggerimenti per te', 'post suggeriti', 'suggerito',
    'voorgesteld voor jou', 'suggesties voor jou', 'voorgestelde berichten', 'voorgesteld',
    'soovitused sulle', 'soovitatud sulle', 'soovitatud postitused', 'soovitatud',
    'sugestões para você', 'sugerido para você', 'publicações sugeridas'
  ];

  /* Section headings for recommendation blocks that are not themselves a
     post: the "Suggested for you" accounts carousel and the "Suggested posts"
     run after "You're all caught up". */
  var suggestedSectionMarkers = [
    'suggested for you', 'suggested posts', 'suggested accounts', 'suggested',
    'recommended for you', 'people you may know', 'discover people',
    'vorschläge für dich', 'vorgeschlagene beiträge', 'vorgeschlagene konten',
    'personen, die du kennen könntest',
    'sugerencias para ti', 'publicaciones sugeridas', 'cuentas sugeridas',
    'personas que quizá conozcas',
    'suggestions pour vous', 'publications suggérées',
    'suggeriti per te', 'post suggeriti',
    'suggesties voor jou', 'voorgestelde berichten',
    'soovitused sulle', 'soovitatud sulle', 'soovitatud postitused',
    'sugestões para você', 'publicações sugeridas'
  ];

  /* The subset of section headings that open the end-of-feed run, after
     which every post is a recommendation. "Suggested for you" is not in it:
     that heading also heads the accounts carousel in the middle of the feed,
     and treating it as a boundary would hide real posts below it. */
  var suggestedPostsBoundaryMarkers = [
    'suggested posts', 'vorgeschlagene beiträge', 'publicaciones sugeridas',
    'publications suggérées', 'post suggeriti', 'voorgestelde berichten',
    'soovitatud postitused', 'publicações sugeridas'
  ];

  function normalizeLabel(value) {
    return (value || '')
      .replace(/[​-‍⁠﻿]/g, '')
      .replace(/ /g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Whole string, or the separator-delimited head ("Sponsored · ..."),
     never a substring: an ordinary caption that merely contains the word
     must not collapse the post. Mirrors matchesUnfollowedActionText in the
     Facebook filter. */
  function matchesLabel(text, markers) {
    if (!text || text.length > 96) return false;
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i];
      if (text === marker ||
          text.indexOf(marker + ' ·') === 0 ||
          text.indexOf(marker + ' •') === 0 ||
          text.indexOf(marker + ' |') === 0) {
        return true;
      }
    }
    return false;
  }

  var PROFILE_PATH = /^\/[A-Za-z0-9._]{1,30}\/?$/;
  var NON_PROFILE_ROOTS = /^\/(?:p|reel|reels|explore|direct|accounts|stories|tv|about|legal|developer|challenge|auth_platform)\/?$/;

  function isProfileHref(href) {
    if (!href) return false;
    var path = href;
    if (/^https?:/i.test(href)) {
      try {
        var url = new URL(href);
        if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return false;
        path = url.pathname;
      } catch(e) { return false; }
    }
    return PROFILE_PATH.test(path) && !NON_PROFILE_ROOTS.test(path);
  }

  /* Avatars are the small round images in the post header. Recognised by
     being inside <header>, linking to a profile, carrying a "profile
     picture" alt, or rendering small. Anything else counts as post media. */
  var AVATAR_ALT = /profile (?:picture|photo)|profilbild|foto (?:de|del) perfil|photo de profil|immagine del profilo|foto del profilo|profielfoto|profiilipilt|foto do perfil/i;
  function isAvatarMedia(media) {
    if (media.closest('header')) return true;
    var alt = media.getAttribute && media.getAttribute('alt');
    if (alt && AVATAR_ALT.test(alt)) return true;
    var link = media.closest('a[href]');
    if (link && isProfileHref(link.getAttribute('href'))) return true;
    var w = parseInt(media.getAttribute('width') || '', 10);
    var h = parseInt(media.getAttribute('height') || '', 10);
    if (w > 0 && h > 0 && w <= 64 && h <= 64) return true;
    if (media.getBoundingClientRect) {
      var rect = media.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < 96 && rect.height < 96) return true;
    }
    return false;
  }

  function mainPostMedia(article) {
    var media = article.querySelectorAll('img, video');
    for (var i = 0; i < media.length; i++) {
      if (!isAvatarMedia(media[i])) return media[i];
    }
    return null;
  }

  /* Visit every element in the article's header region, in document order,
     and return the first whose label matches. The region is everything
     before the main media, or only <header> while the media has not
     rendered yet. Checks direct text, aria-label/title, and short
     textContent (a label split across child spans still reads whole). */
  function isInsideNonLabelLink(node) {
    var link = node.closest('a[href]');
    if (!link) return false;
    var href = link.getAttribute('href') || '';
    /* The username and location lines share the header with the label. An
       account or place literally named "Sponsored" must not read as one. */
    return isProfileHref(href) || href.indexOf('/explore/') === 0 || href.indexOf('/reels/audio') === 0;
  }

  function containsNonLabelLink(node) {
    var links = node.getElementsByTagName('a');
    for (var i = 0; i < links.length; i++) {
      if (isInsideNonLabelLink(links[i])) return true;
    }
    return false;
  }

  function findHeaderLabel(article, markers) {
    var media = mainPostMedia(article);
    var walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT, null, false);
    var visited = 0;
    for (var node = walker.nextNode(); node && visited < 400; node = walker.nextNode()) {
      visited++;
      if (media) {
        /* Pre-order traversal: everything before the media that is not one
           of its ancestors is header region. Stop at the media itself. */
        if (node === media) break;
        if (node.contains(media)) continue;
      } else if (!node.closest('header')) {
        continue;
      }
      if (isInsideNonLabelLink(node)) continue;
      /* A wrapper around the username link reads as the username. Its
         children are visited on their own. */
      if (containsNonLabelLink(node)) continue;
      var label = node.getAttribute('aria-label') || node.getAttribute('title');
      if (label && matchesLabel(normalizeLabel(label), markers)) return node;
      var text = node.textContent || '';
      if (text.length <= 96 && matchesLabel(normalizeLabel(text), markers)) return node;
    }
    return null;
  }

  /* Second ad signal, not text: an outbound call-to-action link. Instagram
     does not linkify URLs in captions or comments, so an organic feed post
     has no link off Instagram. A sponsored post's "Learn more" / "Shop now"
     bar does, usually through the l.instagram.com or l.facebook.com shim.
     Home feed only. */
  var META_HOST = /(^|\.)(instagram\.com|facebook\.com|fbcdn\.net|cdninstagram\.com|threads\.net|threads\.com|meta\.com|meta\.ai|whatsapp\.com)$/i;
  var LINK_SHIM_HOST = /^l\.(instagram|facebook)\.com$/i;
  function hasOutboundAdLink(article) {
    var links = article.querySelectorAll('a[href^="http"], a[href*="/ads/about"], a[href*="adpreferences"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (/\/ads\/about|adpreferences/i.test(href)) return true;
      try {
        var host = new URL(href, window.location.href).hostname;
        if (LINK_SHIM_HOST.test(host) || !META_HOST.test(host)) return true;
      } catch(e) {}
    }
    return false;
  }

  function isHomeFeedRoute() {
    return window.location.pathname === '/';
  }

  function pauseVideos(el) {
    try {
      var videos = el.querySelectorAll('video');
      for (var v = 0; v < videos.length; v++) videos[v].pause();
    } catch(e) {}
  }

  /* Articles that scanned clean are skipped until their content changes, so
     the per-frame pass stays cheap on a long feed. */
  var cleanArticleSignature = new WeakMap();
  function articleSignature(article) {
    return (article.textContent || '').length + ':' + article.getElementsByTagName('*').length;
  }

  function hideLabelledFeedCards() {
    if (!cfg.ads && !cfg.suggested) return;
    if (isSinglePostRoute()) return;
    var articles = document.querySelectorAll('article');
    for (var a = 0; a < articles.length; a++) {
      var article = articles[a];
      if (processed.has(article)) continue;
      var signature = articleSignature(article);
      if (cleanArticleSignature.get(article) === signature) continue;

      var reason = null;
      if (cfg.ads && (findHeaderLabel(article, sponsoredMarkers) ||
                      (isHomeFeedRoute() && hasOutboundAdLink(article)))) {
        reason = 'ad';
      } else if (cfg.suggested && findHeaderLabel(article, suggestedPostMarkers)) {
        reason = 'suggested';
      }
      if (reason) {
        collapseElement(article, reason);
        pauseVideos(article);
      } else {
        cleanArticleSignature.set(article, signature);
      }
    }
  }


  /* --- Suggested sections (not posts) --- */
  function isSuggestedSectionRoute() {
    var path = window.location.pathname;
    /* DMs list "Suggested" people when composing a new message, and search
       lists them under the search box. Both are tools, not feed. */
    return !(path.indexOf('/direct') === 0 || path.indexOf('/explore/search') === 0 ||
      path.indexOf('/accounts/') === 0 || path.indexOf('/challenge/') === 0 ||
      path.indexOf('/checkpoint/') === 0 || path.indexOf('/auth_platform/') === 0 ||
      path.indexOf('/stories/') === 0);
  }

  function isSectionBoundary(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    var tag = el.tagName;
    var role = (el.getAttribute('role') || '').toLowerCase();
    return tag === 'MAIN' || tag === 'NAV' || tag === 'ARTICLE' ||
      role === 'main' || role === 'feed' || role === 'navigation' || role === 'dialog';
  }

  /* Smallest ancestor of the heading that holds a list of account cards:
     two or more distinct profile links plus two or more controls (the
     Follow buttons). Climbing stops before anything holding a post, an
     input, or a page landmark, so the carousel goes and nothing around it. */
  function findSuggestionListContainer(heading) {
    var node = heading.parentElement;
    for (var depth = 0; node && depth < 8; depth++) {
      if (isSectionBoundary(node)) return null;
      if (node.querySelector('article, input, textarea, nav, [role="dialog"]')) return null;
      var links = node.querySelectorAll('a[href]');
      var profiles = {};
      var profileCount = 0;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href');
        if (isProfileHref(href) && !profiles[href]) {
          profiles[href] = true;
          profileCount++;
        }
      }
      var controls = node.querySelectorAll('button, [role="button"]').length;
      if (profileCount >= 2 && controls >= 2) return node;
      if (node.querySelector('a[href^="/explore/people"]') && profileCount >= 1) return node;
      node = node.parentElement;
    }
    return null;
  }

  var suggestedPostsBoundaries = [];

  function hideSuggestedSections() {
    if (!cfg.suggested) return;
    if (!isSuggestedSectionRoute()) return;
    var candidates = document.querySelectorAll('span, h1, h2, h3, h4, [role="heading"], div[dir="auto"]');
    for (var i = 0; i < candidates.length; i++) {
      var heading = candidates[i];
      if (processed.has(heading)) continue;
      if (heading.childElementCount > 3) continue;
      var text = normalizeLabel(heading.textContent);
      if (!matchesLabel(text, suggestedSectionMarkers)) continue;
      /* A label inside a post is that post's own header; the article pass
         owns it. */
      if (heading.closest('article')) continue;
      processed.add(heading);

      if (isHomeFeedRoute() && matchesLabel(text, suggestedPostsBoundaryMarkers)) {
        suggestedPostsBoundaries.push(heading);
      }

      var container = findSuggestionListContainer(heading);
      if (container) {
        collapseElement(container, 'suggested');
        continue;
      }

      /* No account list around it: collapse the heading row and the
         non-post siblings that follow it (the "See all" row, a lone card). */
      var row = heading.closest('[role="separator"], [role="heading"]') ||
        heading.closest('main header') || heading.parentElement;
      if (!row || isSectionBoundary(row) || row.querySelector('article, input, textarea')) continue;
      collapseElement(row, 'suggested');
      var sibling = row.nextElementSibling;
      var maxSiblings = 15;
      while (sibling && maxSiblings-- > 0) {
        if (isSectionBoundary(sibling) || sibling.tagName === 'FOOTER' || sibling.tagName === 'HEADER' ||
            sibling.querySelector('article, input, textarea')) break;
        collapseElement(sibling, 'suggested');
        sibling = sibling.nextElementSibling;
      }
    }

    hideSuggestedPostsAfterBoundary();
  }

  /* Everything after the end-of-feed "Suggested posts" heading is a
     recommendation. Runs on every critical pass, because infinite scroll keeps
     appending posts there long after the heading was found. */
  function hideSuggestedPostsAfterBoundary() {
    if (!cfg.suggested) return;
    if (!suggestedPostsBoundaries.length || !isHomeFeedRoute()) return;
    var live = [];
    for (var b = 0; b < suggestedPostsBoundaries.length; b++) {
      if (document.contains(suggestedPostsBoundaries[b])) live.push(suggestedPostsBoundaries[b]);
    }
    suggestedPostsBoundaries = live;
    if (!live.length) return;
    var boundary = live[0];
    var articles = document.querySelectorAll('article');
    for (var a = 0; a < articles.length; a++) {
      if (processed.has(articles[a])) continue;
      if (boundary.compareDocumentPosition(articles[a]) & 4) {
        collapseElement(articles[a], 'suggested');
        pauseVideos(articles[a]);
      }
    }
  }


  /* --- Reels navigation --- */
  function hideReelsNavigation() {
    if (!cfg.reels) return;
    var svgs = document.querySelectorAll('svg[aria-label="Reels"], svg[aria-label="Reel"]');
    for (var i = 0; i < svgs.length; i++) {
      var navItem = svgs[i].closest('a') || svgs[i].closest('div[role="tab"]') || svgs[i].closest('div[role="tablist"] > div');
      if (navItem) hideEl(navItem);
    }
    var links = document.querySelectorAll('a[href="/reels/"], a[href*="/reels"]');
    for (var j = 0; j < links.length; j++) {
      var navItem2 = links[j].closest('div[role="tablist"] > div') || links[j].closest('div[role="tab"]') || links[j];
      hideEl(navItem2);
    }
  }

  /* --- Stories tray (home feed) --- */
  var STORY_LABEL_PREFIXES = ['story by ', 'historia de ', 'story von ', 'geschichte von '];

  /* Other people's story tiles, recognized by their localized aria-label. */
  function labelledStoryButtons() {
    var labelledButtons = document.querySelectorAll('div[role="button"][aria-label]');
    var btns = [];
    for (var b = 0; b < labelledButtons.length; b++) {
      var label = (labelledButtons[b].getAttribute('aria-label') || '').toLowerCase();
      for (var pfx = 0; pfx < STORY_LABEL_PREFIXES.length; pfx++) {
        if (label.indexOf(STORY_LABEL_PREFIXES[pfx]) === 0) {
          btns.push(labelledButtons[b]);
          break;
        }
      }
    }
    return btns;
  }

  function hideStoriesTray() {
    if (!cfg.stories) return;
    /* The native stories tray only exists on Home (including Following).
       Keeping the structural fallback off profiles, DMs, post details, and
       the story viewer prevents unrelated canvas-backed controls from being
       mistaken for a localized tray. */
    if (window.location.pathname !== '/') return;
    /* As of May 2026 each avatar is <div role="button"
       aria-label="Story by <user>, ..."> — there are no /stories/ href links
       on the home feed anymore. "Your story" is a sibling role=button without
       an aria-label, sharing the horizontal scroller as parent. Strategy: find
       all Story-by buttons, walk up to the smallest ancestor that contains all
       of them. That's the horizontal scroller, and hiding it collapses Your
       story too. */
    var btns = labelledStoryButtons();

    /* Locale-independent fallback for Instagram languages we do not list:
       story tiles render a canvas ring inside sibling role=button elements.
       Find the smallest nearby ancestor with at least two such buttons so
       unrelated canvas-backed controls elsewhere on the page are excluded. */
    if (btns.length < 2) {
      var canvasButtons = document.querySelectorAll('div[role="button"] canvas');
      for (var c = 0; c < canvasButtons.length && btns.length < 2; c++) {
        var storyButton = canvasButtons[c].closest('div[role="button"]');
        var cluster = storyButton && storyButton.parentElement;
        for (var depth = 0; cluster && cluster !== document.body && depth < 4; depth++) {
          var clusterCanvases = cluster.querySelectorAll('div[role="button"] canvas');
          if (clusterCanvases.length >= 2) {
            btns = [];
            for (var cc = 0; cc < clusterCanvases.length; cc++) {
              var clusteredButton = clusterCanvases[cc].closest('div[role="button"]');
              if (clusteredButton && btns.indexOf(clusteredButton) === -1) btns.push(clusteredButton);
            }
            break;
          }
          cluster = cluster.parentElement;
        }
      }
    }
    if (btns.length < 2) return;
    var tray = btns[0].parentElement;
    while (tray && tray !== document.body) {
      var allInside = true;
      for (var i = 0; i < btns.length; i++) {
        if (!tray.contains(btns[i])) { allInside = false; break; }
      }
      if (allInside) break;
      tray = tray.parentElement;
    }
    if (!tray || tray === document.body || processed.has(tray)) return;
    /* Walk up while every parent has only this subtree as content. IG
       hard-codes height: 124px on a class on a wrapper above the scrollbox
       (e.g. .x1njnjl6) — hiding only the inner scroller leaves a 124px empty
       band above the feed. Continue collapsing single-child wrappers until
       we hit a multi-child container (the feed itself) or run out of room. */
    while (tray.parentElement
        && tray.parentElement !== document.body
        && tray.parentElement.children.length === 1) {
      tray = tray.parentElement;
    }
    hideEl(tray);
  }

  function isBareExplorePath() {
    var path = window.location.pathname;
    return path === '/explore/' || path === '/explore';
  }

  /* --- Explore filter keeps search ---
     Instagram's mobile web has one search entry point: the magnifier tab,
     a[href="/explore/"]. That route opens the algorithmic Explore grid with
     a search field above it; the field leads to /explore/search/. The
     Explore filter used to hide the tab and bounce /explore/ to Home, which
     removed search entirely (UserJot, 2026-10: "no search functionality
     seems to be accessible"). Now the tab stays, and both a tap on it and
     any arrival on bare /explore/ go straight to /explore/search/, which has
     the field and no grid. */
  var EXPLORE_SEARCH_PATH = '/explore/search/';

  function blockExploreRoute() {
    if (!cfg.explore || !isBareExplorePath()) return false;
    if (cfg.messagesOnly) return false;
    window.location.replace(EXPLORE_SEARCH_PATH);
    return true;
  }

  function markExploreRoute() {
    var root = document.documentElement;
    if (!root) return;
    if (cfg.explore && isBareExplorePath()) root.setAttribute('data-dull-bare-explore', '');
    else root.removeAttribute('data-dull-bare-explore');
  }

  function isExploreEntryLink(link) {
    if (!link) return false;
    var href = link.getAttribute('href') || '';
    try {
      var url = new URL(href, window.location.href);
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return false;
      return url.pathname === '/explore/' || url.pathname === '/explore';
    } catch(e) {
      return false;
    }
  }

  var __dullExploreSearchTapAttached = false;
  function attachExploreSearchRedirect() {
    if (__dullExploreSearchTapAttached) return;
    __dullExploreSearchTapAttached = true;
    document.addEventListener('click', function(e) {
      if (!cfg.explore || cfg.messagesOnly) return;
      var el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      var link = el && el.closest ? el.closest('a[href]') : null;
      if (!isExploreEntryLink(link)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      window.location.assign(EXPLORE_SEARCH_PATH);
    }, true);
  }

  function closestMatching(el, selector) {
    while (el && el !== document.documentElement) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function isExploreSearchSurface(target) {
    var el = target && (target.nodeType === 1 ? target : target.parentElement);
    if (!el) return false;
    if (closestMatching(el, 'input, textarea, select, button, [contenteditable="true"], [role="search"], [role="searchbox"], form')) return true;
    if (closestMatching(el, '[aria-label*="Search" i], [placeholder*="Search" i], [data-testid*="search" i]')) return true;
    return false;
  }

  function isExplorePostLink(target) {
    var el = target && (target.nodeType === 1 ? target : target.parentElement);
    if (!el) return null;
    return closestMatching(el, 'a[href^="/p/"], a[href^="/reel/"]');
  }

  function shouldBlockExploreInteraction(target) {
    if (!cfg.explore || !isBareExplorePath()) return false;
    if (isExploreSearchSurface(target) || isEditingFocused()) return false;
    return true;
  }

  var __dullExploreGuardsAttached = false;
  function attachExploreInteractionGuards() {
    if (__dullExploreGuardsAttached) return;
    __dullExploreGuardsAttached = true;

    var stopExplorePostClick = function(e) {
      if (!cfg.explore || !isBareExplorePath()) return;
      if (isExploreSearchSurface(e.target)) return;
      if (!isExplorePostLink(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };

    var stopExploreScroll = function(e) {
      if (!shouldBlockExploreInteraction(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      resetExploreScroll();
    };

    document.addEventListener('click', stopExplorePostClick, true);
    document.addEventListener('auxclick', stopExplorePostClick, true);
    document.addEventListener('touchmove', stopExploreScroll, { capture: true, passive: false });
    document.addEventListener('wheel', stopExploreScroll, { capture: true, passive: false });
    window.addEventListener('scroll', function() {
      if (shouldBlockExploreInteraction(document.activeElement || document.body)) resetExploreScroll();
    }, true);
  }

  function resetExploreScroll() {
    if (!cfg.explore || !isBareExplorePath() || isEditingFocused()) return;
    var scroller = document.scrollingElement || document.documentElement || document.body;
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
  }

  /* --- Explore feed grid fallback.
     Bare /explore/ is redirected before this runs; this remains as a defensive
     cleanup if Instagram mutates into an Explore grid before navigation completes.
     Strategy: find any container whose direct children are mostly anchors to /p/ or
     /reel/ posts (6+ such links). That's the algorithmic grid. Hide just that.
     A capture-phase guard also blocks fallback taps/scrolling on bare Explore if
     Instagram changes the grid DOM faster than our hide selector can recognize it. */
  function hideExploreGrid() {
    if (!cfg.explore) return;
    /* Only the bare explore page has the algorithmic grid. /explore/search/* shows
       search results (accounts, hashtags, places) — leave it untouched. */
    if (!isBareExplorePath()) return;
    resetExploreScroll();
    var main = document.querySelector('main');
    if (!main) return;
    /* Walk every div in main and hide any that contains 6+ direct/near-direct post
       links. Use a generous descendant query (not just direct children) since IG
       wraps each tile in 1-2 layers of divs. */
    var candidates = main.querySelectorAll('div');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (processed.has(el)) continue;
      var postLinks = el.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]');
      if (postLinks.length < 6) continue;
      /* Don't hide ancestors that also contain the search input (we'd nuke the page).
         The grid lives in a sibling subtree of the search UI. */
      if (el.querySelector('input[type="text"], input[type="search"], input:not([type])')) continue;
      hideEl(el);
    }
  }

  /* --- Bottom navigation bar (JS fallback when CSS selectors miss) --- */
  function hideBottomNav() {
    if (!cfg.bottomNav) return;
    /* Skip on story viewer — the reply pill is fixed/sticky at the bottom and its
       container holds an a[href*="/direct"] for the send-as-DM action, which would
       otherwise match our bottom-nav heuristic below and hide the reply input. */
    if (window.location.pathname.indexOf('/stories/') === 0) return;
    /* Strategy: find all elements that are fixed/sticky at the bottom of the viewport.
       Instagram's nav uses CSS classes (not inline styles), so we must use getComputedStyle. */
    var candidates = document.querySelectorAll('div, nav, section');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (processed.has(el)) continue;
      /* Only check elements that contain navigation links */
      if (!el.querySelector('a[href="/"]') && !el.querySelector('a[href*="/direct"]')) continue;
      var style = window.getComputedStyle(el);
      var pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      var rect = el.getBoundingClientRect();
      /* Must be at the bottom of the viewport and short (nav bar height) */
      if (rect.bottom >= window.innerHeight - 10 && rect.height < 80) {
        hideEl(el);
      }
    }
  }

  /* --- Open in App banners and login walls (always on) --- */
  function hideOpenInAppBanners() {
    /* Skip on auth/login/signup/2FA pages — these contain "log in" / "sign up" text legitimately.
       /auth_platform/ is the newer Accounts Center 2FA flow (incl. WhatsApp code entry). */
    var path = window.location.pathname;
    if (path.startsWith('/accounts/') || path.startsWith('/challenge/') ||
        path.startsWith('/checkpoint/') || path.startsWith('/auth_platform/')) return;
    var els = document.querySelectorAll('div[role="dialog"], div[role="banner"], div[role="presentation"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (processed.has(el)) continue;
      var text = (el.textContent || '').toLowerCase();
      /* Only hide dialogs that explicitly promote the app download — not any dialog
         containing "sign up" / "log in to" (too broad: hides highlight edit modals,
         story reply sheets, and other legitimate Instagram UI). */
      var hasAppLink = !!el.querySelector('a[href*="apps.apple.com"], a[href*="itunes.apple.com"], a[href*="play.google.com"]');
      if (hasAppLink || text.includes('open in app') || text.includes('use the app') || text.includes('get the app')) {
        /* Don't hide containers that hold form inputs — those are interactive flows
           (login, OTP, 2FA, DM compose), not promo banners. Hiding kills focus and
           dismisses the keyboard mid-entry. */
        if (el.querySelector('input, textarea')) continue;
        hideEl(el);
      }
    }
    /* Inline "Use the app" banners on posts (not in dialogs — appear as clickable bars) */
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var nodeText = (walker.currentNode.textContent || '').trim().toLowerCase();
      if (nodeText === 'use the app' || nodeText === 'open in app' || nodeText === 'get the app') {
        var banner = walker.currentNode.parentElement;
        if (banner && !processed.has(banner)) {
          /* Walk up to find the banner container (typically 2-3 levels) */
          var container = banner;
          for (var w = 0; w < 3; w++) {
            if (!container.parentElement || container.parentElement === document.body) break;
            if (container.tagName === 'A' || container.getAttribute('role') === 'button' ||
                container.style.position === 'fixed' || container.style.position === 'sticky') break;
            container = container.parentElement;
          }
          /* Same input-protection rule as above — never collapse a form. */
          if (container.querySelector('input, textarea')) continue;
          hideEl(container);
        }
      }
    }
    if (document.body && document.body.style.overflow === 'hidden') {
      /* Skip the body-overflow reset when our reels pager lock owns the
         lock — clearing here would let the user scroll through reels
         before maintainPreEmptiveLock re-asserts on the next pass. */
      if (!__dullEmergencyBodyLocked) {
        var hasVisibleDialog = false;
        var dialogs = document.querySelectorAll('div[role="dialog"]');
        for (var j = 0; j < dialogs.length; j++) { if (dialogs[j].style.display !== 'none') { hasVisibleDialog = true; break; } }
        if (!hasVisibleDialog) document.body.style.overflow = '';
      }
    }
  }

  /* --- Friends-Only Mode: redirect home feed to Following on SPA navigation.
     The initial /?variant=following redirect runs at document-start in
     FilterService.instagramFriendsOnlyEarlyRedirectScript so it fires before
     IG's bundle. This handler catches client-side route changes (taps on the
     IG logo, History API back/forward, Back link if it slips through CSS)
     and re-applies the variant. */
  function enforceFriendsOnly() {
    if (!cfg.friendsOnly) return;
    var path = window.location.pathname;
    /* Never hijack auth flows. */
    if (path.indexOf('/accounts/') === 0 || path.indexOf('/challenge/') === 0 ||
        path.indexOf('/checkpoint/') === 0 || path.indexOf('/auth_platform/') === 0) {
      return;
    }
    /* Only the home feed has the variant switcher. Profile/explore/search/DM
       pages all have a non-"/" pathname and are left untouched. */
    if (path !== '/') return;
    var search = window.location.search || '';
    if (search.indexOf('variant=following') !== -1) return;
    /* Story compose owns For-You Home while it lasts, with the feed hidden. */
    if (isStoryComposePage()) return;
    window.location.replace('/?variant=following');
  }

  /* --- Friends-Only story compose ---
     UserJot, 2026-10: "Post to story in friends-only mode". Two separate
     things were missing, and only one of them is Dull's to fix.

     1. "Add to story" in the share sheet of someone else's post exists only
        in Instagram's native app. instagram.com does not offer resharing a
        post to your story on any surface, so there is nothing to un-hide;
        Dull never removed it. The fixture test keeps it visible in case
        Instagram ever ships it on the web.

     2. Posting a story of your own. The mobile website does support this
        (photos, with text), and its entry is the "Your story" tile at the
        start of the Home stories tray. Friends-Only sends Home to
        /?variant=following, and Instagram renders no stories tray on that
        variant, so Friends-Only removed the only way to start a story.

     For (2): on Following, when no usable native tray is on screen, a Dull
     button opens Home in compose mode. The document-start redirect lets `/`
     through while the sessionStorage stamp is fresh and marks <html> before
     first paint; filter.css hides the whole page except the elements this
     code marks: the tray, Instagram's dialogs and full-screen overlays, and
     Dull's bar. The For-You feed loads underneath but is never visible,
     tappable or scrollable, and its videos are paused. Leaving `/` (the
     composer route, a story viewer) ends compose, so Instagram's return to
     Home after posting lands back on Following. */
  var STORY_COMPOSE_KEY = '__dullStoryCompose';
  var STORY_COMPOSE_MAX_MS = 600000;
  var STORY_COMPOSE_GIVE_UP_MS = 8000;
  var YOUR_STORY_TEXT = ['your story', 'tu historia', 'deine story'];
  var __dullStoryComposeSeenAt = 0;
  var __dullStoryComposeExpiryTimer = null;

  function storyComposeStamp() {
    try { return Number(sessionStorage.getItem(STORY_COMPOSE_KEY)) || 0; } catch(e) { return 0; }
  }

  function clearStoryComposeStamp() {
    try { sessionStorage.removeItem(STORY_COMPOSE_KEY); } catch(e) {}
  }

  function isStoryComposeAllowed() {
    return !!cfg.friendsOnly && !cfg.messagesOnly;
  }

  function isStoryComposePage() {
    if (!isStoryComposeAllowed()) return false;
    if (window.location.pathname !== '/') return false;
    if ((window.location.search || '').indexOf('variant=following') !== -1) return false;
    var started = storyComposeStamp();
    if (!started) return false;
    var age = Date.now() - started;
    if (age < 0) return false;
    if (age < STORY_COMPOSE_MAX_MS) return true;
    /* Out of time, but never pull the page out from under an open
       Instagram dialog or composer overlay. */
    return isStoryOverlayOnScreen();
  }

  function startStoryCompose() {
    try { sessionStorage.setItem(STORY_COMPOSE_KEY, String(Date.now())); } catch(e) { return; }
    window.location.assign('/');
  }

  function leaveStoryCompose() {
    clearStoryComposeStamp();
    window.location.replace('/?variant=following');
  }

  function endStoryCompose() {
    var root = document.documentElement;
    if (root) root.removeAttribute('data-dull-story-compose');
    var bar = document.getElementById('dull-story-compose-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    var marked = document.querySelectorAll('[data-dull-story-tray], [data-dull-story-friend], [data-dull-story-overlay]');
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute('data-dull-story-tray');
      marked[i].removeAttribute('data-dull-story-friend');
      marked[i].removeAttribute('data-dull-story-overlay');
    }
    if (__dullStoryComposeExpiryTimer) {
      clearTimeout(__dullStoryComposeExpiryTimer);
      __dullStoryComposeExpiryTimer = null;
    }
    __dullStoryComposeSeenAt = 0;
    __dullStoryTrayTappedAt = 0;
    __dullStoryPreTapLayers = new WeakSet();
  }

  function findYourStoryButton() {
    var buttons = document.querySelectorAll('div[role="button"]:not([aria-label])');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (YOUR_STORY_TEXT.indexOf(text) !== -1) return buttons[i];
    }
    return null;
  }

  function smallestCommonAncestor(nodes) {
    var node = nodes[0].parentElement;
    while (node && node !== document.body) {
      var all = true;
      for (var i = 1; i < nodes.length; i++) {
        if (!node.contains(nodes[i])) { all = false; break; }
      }
      if (all) return node;
      node = node.parentElement;
    }
    return null;
  }

  /* The element to spotlight: the tray scroller when Instagram labelled any
     story tiles, otherwise the bare "Your story" tile. */
  function findStoryComposeTarget() {
    var tiles = labelledStoryButtons();
    var yours = findYourStoryButton();
    var nodes = yours ? tiles.concat([yours]) : tiles;
    if (nodes.length >= 2) return { target: smallestCommonAncestor(nodes), tiles: tiles };
    if (tiles.length === 1) {
      /* Tray markup is scroller > wrapper > tile (see filter.css). */
      var wrapper = tiles[0].parentElement;
      return { target: (wrapper && wrapper.parentElement) || wrapper, tiles: tiles };
    }
    return { target: yours, tiles: tiles };
  }

  /* Instagram's own layers: dialogs and menus it opens from the tray, and a
     full-viewport fixed composer if it renders one in place instead of on its
     own route. Only layers that appear after the user taps inside the tray
     count; Instagram pre-mounts dialogs, and anything already in the page
     before that tap stays hidden. Anything holding the feed, <main> or the
     tray is refused too, so an app-shell wrapper can never be mistaken for
     an overlay. */
  var __dullStoryPreTapLayers = new WeakSet();
  var __dullStoryTrayTappedAt = 0;
  function noteStoryTrayTap(e) {
    if (!document.documentElement.hasAttribute('data-dull-story-compose')) return;
    var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    if (t && t.closest && t.closest('[data-dull-story-tray]')) __dullStoryTrayTappedAt = Date.now();
  }
  document.addEventListener('pointerdown', noteStoryTrayTap, true);
  document.addEventListener('click', noteStoryTrayTap, true);

  /* Before the tap, remember the layer; after it, accept only new ones. */
  function acceptStoryLayer(el) {
    if (!__dullStoryTrayTappedAt) {
      __dullStoryPreTapLayers.add(el);
      return false;
    }
    return !__dullStoryPreTapLayers.has(el);
  }

  function isStoryOverlayCandidate(el, tray) {
    if (el.id === 'dull-story-compose-bar') return false;
    if (el.querySelector('article, main')) return false;
    if (tray && (el === tray || el.contains(tray) || tray.contains(el))) return false;
    return true;
  }

  /* No layout reads, so it also runs while an input is focused: a dialog
     that holds a text field pauses the layout-reading passes, and it must
     still be revealed. */
  function markStoryDialogs() {
    var tray = document.querySelector('[data-dull-story-tray]');
    var found = false;
    var dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]');
    for (var i = 0; i < dialogs.length; i++) {
      if (dialogs[i].hasAttribute('data-dull-story-overlay')) {
        if (!dialogs[i].closest('[hidden], [aria-hidden="true"]')) found = true;
        continue;
      }
      if (!acceptStoryLayer(dialogs[i])) continue;
      if (!isStoryOverlayCandidate(dialogs[i], tray)) continue;
      dialogs[i].setAttribute('data-dull-story-overlay', '');
      /* Instagram pre-mounts some dialogs; only count ones not parked in a
         hidden subtree. spotlightStoryComposer() refines this with layout. */
      if (!dialogs[i].closest('[hidden], [aria-hidden="true"]')) found = true;
    }
    return found;
  }

  function isStoryOverlayOnScreen() {
    var overlays = document.querySelectorAll('[data-dull-story-overlay]');
    for (var i = 0; i < overlays.length; i++) {
      var r = overlays[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }

  function markStoryOverlays(tray) {
    markStoryDialogs();
    var vw = window.innerWidth || 390;
    var vh = window.innerHeight || 800;
    var layer = document.body ? Array.prototype.slice.call(document.body.children) : [];
    for (var depth = 0; depth < 4 && layer.length; depth++) {
      var next = [];
      for (var j = 0; j < layer.length; j++) {
        var el = layer[j];
        if (el.hasAttribute('data-dull-story-overlay')) continue;
        if (window.getComputedStyle(el).position === 'fixed') {
          var r = el.getBoundingClientRect();
          if (r.width >= vw * 0.9 && r.height >= vh * 0.8 &&
              acceptStoryLayer(el) && isStoryOverlayCandidate(el, tray)) {
            el.setAttribute('data-dull-story-overlay', '');
            continue;
          }
        }
        for (var k = 0; k < el.children.length; k++) next.push(el.children[k]);
      }
      layer = next;
    }
    return isStoryOverlayOnScreen();
  }

  function isInsideStorySpotlight(el) {
    return !!(el && el.closest && el.closest('[data-dull-story-tray], [data-dull-story-overlay]'));
  }

  function silenceComposeBackground() {
    var videos = document.getElementsByTagName('video');
    for (var i = 0; i < videos.length; i++) {
      if (isInsideStorySpotlight(videos[i])) continue;
      try { videos[i].muted = true; videos[i].pause(); } catch(e) {}
    }
  }

  document.addEventListener('play', function(e) {
    var t = e.target;
    if (!t || t.tagName !== 'VIDEO') return;
    if (!document.documentElement.hasAttribute('data-dull-story-compose')) return;
    if (isInsideStorySpotlight(t)) return;
    try { t.muted = true; t.pause(); } catch(err) {}
  }, true);

  function ensureStoryComposeBar() {
    var bar = document.getElementById('dull-story-compose-bar');
    if (bar) return bar;
    if (!document.body) return null;
    bar = document.createElement('div');
    bar.id = 'dull-story-compose-bar';
    bar.setAttribute('role', 'status');
    var message = document.createElement('span');
    message.textContent = 'looking for your story...';
    var back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'back to following';
    back.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      leaveStoryCompose();
    });
    bar.appendChild(message);
    bar.appendChild(back);
    document.body.appendChild(bar);
    return bar;
  }

  function setStoryComposeMessage(bar, text) {
    var span = bar && bar.firstChild;
    if (span && span.textContent !== text) span.textContent = text;
  }

  /* Cheap part: runs on every pass, including while typing. Returns whether
     compose owns this page. */
  function maintainStoryComposeMode() {
    var root = document.documentElement;
    if (!isStoryComposePage()) {
      if (root && root.hasAttribute('data-dull-story-compose')) endStoryCompose();
      /* Any route away from Home ends compose for good, so Instagram's
         return to Home after posting is Following again. Following itself
         is left alone: the entry button stamps and then navigates, and a
         pass in between must not erase the stamp. */
      var stamp = storyComposeStamp();
      if (stamp && (window.location.pathname !== '/' ||
                    Date.now() - stamp >= STORY_COMPOSE_MAX_MS)) {
        clearStoryComposeStamp();
      }
      return false;
    }
    root.setAttribute('data-dull-story-compose', '');
    if (!__dullStoryComposeSeenAt) {
      __dullStoryComposeSeenAt = Date.now();
      var remaining = STORY_COMPOSE_MAX_MS - (Date.now() - storyComposeStamp());
      __dullStoryComposeExpiryTimer = setTimeout(function() {
        __dullStoryComposeExpiryTimer = null;
        try { processCritical(); } catch(e) {}
      }, Math.max(0, remaining) + 500);
      try { window.scrollTo(0, 0); } catch(e) {}
    }
    silenceComposeBackground();
    if (markStoryDialogs()) {
      var bar = document.getElementById('dull-story-compose-bar');
      if (bar) bar.setAttribute('hidden', '');
    }
    return true;
  }

  /* Layout-reading part: skipped while an input is focused. */
  function spotlightStoryComposer() {
    var bar = ensureStoryComposeBar();
    var found = findStoryComposeTarget();
    var tray = found.target;
    var previous = document.querySelector('[data-dull-story-tray]');
    if (previous && previous !== tray) previous.removeAttribute('data-dull-story-tray');
    if (tray) {
      tray.setAttribute('data-dull-story-tray', '');
      /* Hide Stories still means hide other people's stories. Only tiles
         with a recognized label are touched, never "Your story". */
      for (var i = 0; i < found.tiles.length; i++) {
        if (cfg.stories) found.tiles[i].setAttribute('data-dull-story-friend', '');
        else found.tiles[i].removeAttribute('data-dull-story-friend');
      }
    }
    var overlayOpen = markStoryOverlays(tray);
    if (bar) {
      /* Step out of the way of Instagram's own sheet or composer. */
      if (overlayOpen) bar.setAttribute('hidden', '');
      else bar.removeAttribute('hidden');
      if (tray) {
        setStoryComposeMessage(bar, 'tap your story to post one. the feed stays hidden.');
      } else if (Date.now() - __dullStoryComposeSeenAt > STORY_COMPOSE_GIVE_UP_MS) {
        setStoryComposeMessage(bar, "instagram isn't showing a story button for this account right now.");
      }
    }
  }

  /* Entry point on Following. Shown only when Instagram's own "Your story"
     is not on screen: the variant omitted the tray, or Hide Stories hid it. */
  function renderStoryComposeEntry() {
    var existing = document.getElementById('dull-story-compose-entry');
    var onFollowing = isStoryComposeAllowed()
      && window.location.pathname === '/'
      && (window.location.search || '').indexOf('variant=following') !== -1;
    var nativeEntryVisible = onFollowing && !cfg.stories
      && (labelledStoryButtons().length > 0 || !!findYourStoryButton());
    if (!onFollowing || nativeEntryVisible) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var main = document.querySelector('main');
    /* Wait for the feed: Instagram renders a tray, when it renders one, no
       later than the first post, so this avoids a button that flashes and
       then gives way to the native tile. */
    if (!main || !main.querySelector('article')) return;
    if (existing && main.contains(existing)) return;
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'dull-story-compose-entry';
    button.textContent = '+ add to your story';
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      startStoryCompose();
    });
    if (main.firstChild) main.insertBefore(button, main.firstChild);
    else main.appendChild(button);
  }

  /* --- Single-reel mode ---
     Goal: a reel a friend shared in DM plays normally, but the pager that
     advances to the next reel is dead.

     Two layers, because IG's reel viewer prefetches ~15 reel slots into one
     scroll-snap container and updates the URL (via replaceState — NOT
     pushState; verified live) only when a slot becomes the active one. So a
     URL-only defense always loses a frame to whatever's already in the DOM.

     Layer 1 — enforceSingleReel: records the first reel id seen on a
     /reels?/<id>/ path. Any later replaceState to a different id triggers a
     redirect to /direct/inbox/. Catches background URL changes.

     Layer 2 — lockReelsPager: when on /reels?/<id>/, finds the snap-scroll
     container by signature (overflow-y auto/scroll + scroll-snap-type starts
     with 'y' + clientHeight > 600), hides every child after the first, and
     locks overflow + touch-action on the container itself. Verified
     non-destructive — the visible reel keeps playing.

     URL form note: friends share /reel/<id>/ but IG 302-redirects every reel
     URL to /reels/<id>/ (plural). Regex must match both. blockedURLPatterns
     is empty for this platform — single-reel enforcement is entirely
     JS-side because a network-level block kills the first reel too. */
  function reelIdFromPath(path) {
    var m = path.match(/^\/reels?\/([^\/?#]+)/);
    return m ? m[1] : null;
  }

  function enforceSingleReel() {
    if (!cfg.reels) return;
    var path = window.location.pathname;
    var currentId = reelIdFromPath(path);
    if (!currentId) {
      window.__dullReelLockedId = undefined;
      return;
    }
    if (!window.__dullReelLockedId) {
      window.__dullReelLockedId = currentId;
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.has('next') || params.has('next_media_id')) {
          params.delete('next');
          params.delete('next_media_id');
          var qs = params.toString();
          var clean = path + (qs ? '?' + qs : '');
          history.replaceState(history.state, '', clean);
        }
      } catch(e) {}
      return;
    }
    if (currentId !== window.__dullReelLockedId) {
      window.location.replace('/direct/inbox/');
    }
  }

  /* DOM-level pager lock — re-runs on every mutation. URL-gating removed
     because IG opens reels from a DM as a fullscreen overlay layered on top
     of /direct/t/<thread>/ with NO URL change at all (verified live). The
     overlay's pager is also structurally different from the standalone
     /reels/<id>/ viewer:

     | aspect             | standalone /reels/<id>/ | DM-overlay              |
     |--------------------|-------------------------|-------------------------|
     | scroller position  | fixed                   | static                  |
     | overflow-y         | scroll                  | scroll                  |
     | touch-action       | none                    | auto                    |
     | direct children    | one per reel slot       | 2 (active + wrapper)    |
     | snap mechanism     | JS (no CSS scroll-snap) | JS (no CSS scroll-snap) |
     | URL                | /reels/<id>/            | /direct/t/<thread>/     |

     Common signature: an ancestor of <video> elements that has 5+ video
     descendants, at least two viewport-sized portrait videos, and overflow-y
     scroll or auto. The size check separates a prefetched Reel pager from a
     normal DM history that happens to contain several small video messages.
     We don't gate on URL or scroll-snap-type — both lie about when the pager
     exists.

     Slot hiding: we walk pager.children. The active reel is whichever child
     contains the video whose rect is at the top of the visible area. Every
     non-active direct child is hidden. If the active direct child is itself
     a wrapper holding multiple slots (the DM case — wrapper has 9 nested
     slots), recurse one level: hide every slot in the wrapper that doesn't
     contain the active video. */
  /* --- Pre-emptive body scroll lock ---
     Closes the brief window between "user taps reel preview" and
     "lockReelsPager finds a pager with 5+ video descendants". The pager
     needs ~150-300 ms to populate; in that window IG's overlay opens and
     a fast swipe can advance one reel. By locking html/body overflow as
     soon as a single full-viewport portrait video appears in DOM, that
     window closes (<50 ms). Body lock is lifted as soon as the reel
     overlay closes. Gated on /direct/ or /reels?/ paths so it never fires
     on /stories/ or other portrait-video contexts that aren't reel
     overlays. */
  var __dullEmergencyBodyLocked = false;
  function maintainPreEmptiveLock() {
    if (!cfg.reels) return;

    var path = window.location.pathname;
    var inReelsContext = path.indexOf('/direct/') === 0 || /^\/reels?\//i.test(path);
    var hasFullscreenReelVideo = false;
    if (inReelsContext) {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var r = vids[i].getBoundingClientRect();
        if (r.height > 500 && r.width >= 200 && r.width < r.height) {
          hasFullscreenReelVideo = true;
          break;
        }
      }
    }

    if (hasFullscreenReelVideo) {
      /* Re-apply every pass — hideOpenInAppBanners (later in processCritical)
         resets body.style.overflow when no dialog is open, which would
         otherwise clear our lock between passes. Idempotent re-set is cheap. */
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      if (document.body) {
        document.body.style.setProperty('overflow', 'hidden', 'important');
        document.body.style.setProperty('touch-action', 'pan-x', 'important');
      }
      __dullEmergencyBodyLocked = true;
    } else if (__dullEmergencyBodyLocked) {
      document.documentElement.style.removeProperty('overflow');
      if (document.body) {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('touch-action');
      }
      __dullEmergencyBodyLocked = false;
    }
  }

  /* --- Swipe-interrupt overlay ---
     Fires when the user attempts to scroll a locked reel pager. Visual
     feedback that the lock is intentional, not a bug. Pointer-events:none
     so the back gesture and reel UI underneath stay interactive. One-shot
     per pager-open (resets when pager goes away). Friend's reel keeps
     playing through the fade; only the swipe-to-advance gesture triggers
     this. */
  var __dullSwipeListenerAttached = null;
  var __dullReelInterruptShown = false;
  function attachSwipeInterruptListener() {
    if (!cfg.reels) return;
    if (!__dullCachedPager || __dullSwipeListenerAttached === __dullCachedPager) return;
    var pager = __dullCachedPager;
    __dullSwipeListenerAttached = pager;

    var startY = null;
    var onStart = function(e) {
      if (e.touches && e.touches.length) startY = e.touches[0].clientY;
    };
    var onMove = function(e) {
      if (startY === null || !e.touches || !e.touches.length) return;
      var dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > 30) {
        startY = null;
        showReelInterruption();
      }
    };
    var onEnd = function() { startY = null; };
    var onWheel = function(e) {
      if (Math.abs(e.deltaY) > 20) showReelInterruption();
    };
    pager.addEventListener('touchstart', onStart, { passive: true, capture: true });
    pager.addEventListener('touchmove', onMove, { passive: true, capture: true });
    pager.addEventListener('touchend', onEnd, { passive: true, capture: true });
    pager.addEventListener('wheel', onWheel, { passive: true, capture: true });
  }

  function showReelInterruption() {
    if (__dullReelInterruptShown) return;
    __dullReelInterruptShown = true;
    if (document.getElementById('dull-reel-interrupt')) return;

    /* Overlay covers the middle band only — leaves the top ~72 px and
       bottom ~100 px transparent so IG's back button (top-left) and the
       composer / send-to-chat row (bottom) remain visible and tappable.
       pointer-events:none on the overlay means even where it does cover
       UI, taps pass through (e.g. action rail). */
    var overlay = document.createElement('div');
    overlay.id = 'dull-reel-interrupt';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText =
      'position:fixed;left:0;right:0;' +
      'top:max(48px, env(safe-area-inset-top, 0px) + 32px);' +
      'bottom:max(80px, env(safe-area-inset-bottom, 0px) + 64px);' +
      'z-index:2147483647;' +
      'background:rgba(0,0,0,0.55);' +
      'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'pointer-events:none;' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:0 32px;' +
      /* Mask the dim+blur with a gradient so the top and bottom 40 px fade
         smoothly into the unblurred top/bottom UI bands. Without this the
         band has a hard edge that looks like a UI bug. */
      'mask-image:linear-gradient(to bottom, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);' +
      '-webkit-mask-image:linear-gradient(to bottom, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);' +
      'opacity:0;transition:opacity 240ms ease-out;';

    var inner = document.createElement('div');
    inner.style.cssText =
      'font-family:"Space Mono",ui-monospace,monospace;' +
      'font-size:18px;line-height:1.5;color:#fff;' +
      'text-align:center;max-width:280px;letter-spacing:0.01em;';
    var line1 = document.createElement('div');
    line1.style.cssText = 'font-weight:700;margin-bottom:14px;';
    line1.textContent = "no scrolling past this reel.";
    var line2 = document.createElement('div');
    line2.style.cssText = 'opacity:0.85;';
    line2.textContent = "that's the whole point of dull.";
    inner.appendChild(line1);
    inner.appendChild(line2);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    requestAnimationFrame(function() { overlay.style.opacity = '1'; });
    setTimeout(function() {
      overlay.style.opacity = '0';
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    }, 4000);
  }

  function resetSwipeInterruptIfPagerGone() {
    if (!__dullCachedPager || !document.contains(__dullCachedPager)) {
      __dullSwipeListenerAttached = null;
      __dullReelInterruptShown = false;
    }
  }

  var __dullReelsPagerLocked = false;
  var __dullCachedPager = null;
  function lockReelsPager() {
    if (!cfg.reels) return;

    /* URL gate. Only lock on contexts where IG actually shows the reel
       pager: /direct/<thread>/ (DM-overlay opens on top, URL stays put)
       and /reels?/<id>/ (standalone reels viewer). On the home feed,
       profile, search, stories, etc — there are <video> elements but no
       reel pager, and matching one of those scroll containers as the
       "pager" would lock real feed scrolling. The DM-overlay still
       resolves correctly because we're on /direct/<thread>/ when the
       overlay opens. */
    var path = window.location.pathname;
    if (path.indexOf('/direct/') !== 0 && !/^\/reels?\//i.test(path)) {
      __dullCachedPager = null;
      __dullReelsPagerLocked = false;
      return;
    }

    /* Fast path: re-use the cached pager if it's still in the DOM and our
       inline overflow lock is intact. Avoids re-running findReelsPager
       (querySelectorAll + tree-walk) at 60 Hz. We still re-apply slot hiding
       below, since IG can lazy-load more reel slots into the same pager. */
    var pager = __dullCachedPager;
    if (!pager || !document.contains(pager) || pager.style.overflow !== 'hidden') {
      pager = findReelsPager();
    }
    if (!pager) {
      __dullCachedPager = null;
      __dullReelsPagerLocked = false;
      return;
    }

    __dullCachedPager = pager;
    pager.style.setProperty('overflow', 'hidden', 'important');
    pager.style.setProperty('overflow-y', 'hidden', 'important');
    pager.style.setProperty('touch-action', 'none', 'important');
    pager.style.setProperty('scroll-snap-type', 'none', 'important');
    if (pager.scrollTop > 0) pager.scrollTop = 0;
    __dullReelsPagerLocked = true;

    var videos = pager.querySelectorAll('video');
    if (!videos.length) return;

    /* Pick the active reel — the video whose rect.top is closest to 0 and
       within a viewport. Fall back to first video if nothing visible. */
    var active = null;
    var bestDist = Infinity;
    for (var i = 0; i < videos.length; i++) {
      var r = videos[i].getBoundingClientRect();
      if (r.height < 100) continue;
      var dist = Math.abs(r.top);
      if (r.top >= -50 && r.top < (window.innerHeight || 800) && dist < bestDist) {
        bestDist = dist;
        active = videos[i];
      }
    }
    if (!active) active = videos[0];

    /* Hide every direct child of the pager that doesn't contain the active
       video, then recurse into the active child if it's a wrapper. */
    var activeChild = null;
    for (var k = 0; k < pager.children.length; k++) {
      var kid = pager.children[k];
      if (kid.contains(active)) { activeChild = kid; }
      else { kid.style.setProperty('display', 'none', 'important'); }
    }
    if (activeChild && activeChild.children.length > 1 && activeChild.querySelectorAll('video').length > 1) {
      for (var s = 0; s < activeChild.children.length; s++) {
        var slot = activeChild.children[s];
        if (!slot.contains(active)) slot.style.setProperty('display', 'none', 'important');
      }
    }
  }

  function hasMultipleViewportReelVideos(videos, pager) {
    var viewportHeight = window.innerHeight || 800;
    var minimumHeight = Math.max(360, Math.min(500, viewportHeight * 0.55));
    /* A Reel viewer renders media close to the pager's full width. Shared
       video cards in a DM can be tall enough to pass the portrait/height
       checks when the keyboard shrinks the visual viewport, but remain
       substantially narrower than the conversation scroller. */
    var pagerWidth = (pager && pager.clientWidth) || window.innerWidth || 390;
    var minimumWidth = Math.max(180, Math.min(340, pagerWidth * 0.72));
    var matches = 0;
    for (var i = 0; i < videos.length; i++) {
      var rect = videos[i].getBoundingClientRect();
      if (rect.height >= minimumHeight && rect.width >= minimumWidth && rect.height > rect.width * 1.1) {
        matches++;
        if (matches >= 2) return true;
      }
    }
    return false;
  }

  function isMessagingHistoryContainer(el) {
    /* role=log is the durable accessibility semantic for a live conversation
       transcript. Inspect only the candidate and its two
       nearest wrappers so an unrelated page-level live region cannot exempt
       a real Reel overlay rendered through a portal. */
    var cursor = el;
    var hops = 0;
    while (cursor && cursor !== document.body && hops < 3) {
      var role = (cursor.getAttribute && cursor.getAttribute('role') || '').toLowerCase();
      if (role === 'log') return true;
      cursor = cursor.parentElement;
      hops++;
    }
    return false;
  }

  /* Walk up from any <video> looking for an ancestor that is *the* reels
     pager. Signature: 5+ video descendants, 2+ viewport-sized portrait
     videos, overflow-y scroll or auto, and clientHeight ≥ 400. Works for
     both /reels/<id>/ (fixed) and DM-overlay (static) without treating a
     normal video-heavy conversation as a pager. */
  function findReelsPager() {
    var videos = document.querySelectorAll('video');
    var inspected = new WeakSet();
    for (var v = 0; v < videos.length; v++) {
      var p = videos[v].parentElement;
      var hops = 0;
      while (p && p !== document.documentElement && hops < 16) {
        /* Never accept <body> or <html> as the pager — locking those would
           kill normal IG-page scrolling. The pager is always a div/main/
           section nested inside body. */
        if (p === document.body) break;
        if (!inspected.has(p)) {
          inspected.add(p);
          if (p.clientHeight >= 400 && p.clientHeight <= (window.innerHeight || 900) * 1.2) {
            var descendantVideos = p.querySelectorAll('video');
            if (descendantVideos.length >= 5 && !isMessagingHistoryContainer(p) &&
                hasMultipleViewportReelVideos(descendantVideos, p)) {
              var cs = window.getComputedStyle(p);
              if (cs.overflowY === 'scroll' || cs.overflowY === 'auto') return p;
            }
          }
        }
        p = p.parentElement;
        hops++;
      }
    }
    return null;
  }

  /* --- Messages-only mode: redirect to DMs and hide non-DM content --- */
  function enforceMessagesOnly() {
    if (!cfg.messagesOnly) return;
    var path = window.location.pathname;
    /* Never hijack Instagram's auth, recovery, or challenge flows.
       On logged-out sessions, redirecting these pages to /direct/inbox/
       creates a server-side bounce straight back to /accounts/login/.
       /auth_platform/ is the newer Accounts Center 2FA flow (incl. WhatsApp). */
    if (path.startsWith('/accounts/') || path.startsWith('/challenge/') ||
        path.startsWith('/checkpoint/') || path.startsWith('/auth_platform/')) {
      return;
    }
    /* If not on a /direct/ page, redirect to inbox */
    if (!path.startsWith('/direct')) {
      window.location.replace('/direct/inbox/');
      return;
    }
    /* Hide feed content that might leak through on /direct/ pages */
    var feed = document.querySelector('main > section');
    if (feed) hideEl(feed);
    /* Hide non-DM navigation items (keep DM icon) */
    var navLinks = document.querySelectorAll('nav a, div[role="tablist"] a');
    for (var i = 0; i < navLinks.length; i++) {
      var href = (navLinks[i].getAttribute('href') || '');
      if (href && !href.startsWith('/direct') && href !== '/') {
        var navItem = navLinks[i].closest('div[role="tab"]') || navLinks[i].closest('div[role="tablist"] > div') || navLinks[i];
        if (!processed.has(navItem)) hideEl(navItem);
      }
    }
  }

  /* --- Audio persistence ---
     IG's mobile web mutes every new <video> by default and tapping the unmute
     button only affects that one element — swipe to the next post/story and
     you're back to silent, which forces a tap per item. We remember the user's
     last *deliberate* mute/unmute and apply it to every video that appears.

     Persistence: sessionStorage so it survives SPA navigation but resets on a
     fresh app cold-launch (matches user expectation — they don't want sound
     blasting unexpectedly the next time they open IG).

     Deliberate-vs-programmatic detection: record the timestamp of the last
     touch/pointer event; a volumechange that fires within ~250 ms of one is
     treated as user-initiated and updates the preference. Anything outside
     that window is IG's own code (e.g. new-post defaults) and is overridden
     to match the stored preference. 250 ms is tight enough that the cross-
     post swipe (touchstart fires at the start of the gesture, then there's
     scroll, layout, network, and finally the new video) doesn't bleed into
     IG's programmatic mute on the next element. */
  var __dullAudioLastTouchTs = 0;
  function audioPrefOn() {
    try { return sessionStorage.getItem('__dullAudioOn') === '1'; } catch(e) { return false; }
  }
  function setAudioPref(on) {
    try { sessionStorage.setItem('__dullAudioOn', on ? '1' : '0'); } catch(e) {}
  }

  function applyAudioPreference() {
    if (!audioPrefOn()) return;
    if (document.documentElement.hasAttribute('data-dull-story-compose')) return;
    var videos = document.getElementsByTagName('video');
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (v.muted) {
        try { v.muted = false; } catch(e) {}
      }
    }
  }

  function initAudioPersistence() {
    var markTouch = function() { __dullAudioLastTouchTs = Date.now(); };
    document.addEventListener('touchstart', markTouch, { capture: true, passive: true });
    document.addEventListener('pointerdown', markTouch, { capture: true, passive: true });
    document.addEventListener('mousedown', markTouch, { capture: true, passive: true });

    /* Capture-phase volumechange so we see every video's transition, even
       inside React-managed subtrees that stopPropagation on bubble. */
    document.addEventListener('volumechange', function(e) {
      var t = e.target;
      if (!t || t.tagName !== 'VIDEO') return;
      var sinceTouch = Date.now() - __dullAudioLastTouchTs;
      if (sinceTouch < 250) {
        /* User just tapped — they meant this. Record it. */
        setAudioPref(!t.muted);
        return;
      }
      /* IG flipped it programmatically. If it contradicts the user's
         preference (audio on, IG muted it), flip it back. Setting muted to
         a value it already has is a no-op and does not re-fire volumechange,
         so no loop. */
      if (audioPrefOn() && t.muted) {
        try { t.muted = false; } catch(e) {}
      }
    }, true);
  }
  initAudioPersistence();

  /* --- Critical filters (run on every mutation) ---
     lockReelsPager runs unconditionally — sets inline styles only, no layout
     reads, safe during input/keyboard focus. The remaining filters do
     getComputedStyle / getBoundingClientRect passes on hundreds of nodes,
     which on iOS WKWebView dismisses the keyboard mid-2FA. They get gated
     behind isEditingFocused. Previously the gate was at the rAF callback
     level, which blocked lockReelsPager too — and the IG reel overlay
     autofocuses a contentEditable message input the moment it opens, so the
     gate was always tripped on /direct/ reels. */
  function processCritical() {
    markSinglePostRoute();
    markExploreRoute();
    enforceMessagesOnly();
    var composing = maintainStoryComposeMode();
    enforceFriendsOnly();
    if (blockExploreRoute()) return;
    enforceSingleReel();
    maintainPreEmptiveLock();
    lockReelsPager();
    attachSwipeInterruptListener();
    resetSwipeInterruptIfPagerGone();
    applyAudioPreference();
    attachExploreInteractionGuards();
    attachExploreSearchRedirect();
    if (isEditingFocused()) return;
    if (composing) spotlightStoryComposer();
    else renderStoryComposeEntry();
    hideLabelledFeedCards();
    hideSuggestedPostsAfterBoundary();
    processArticles();
    if (!composing) hideStoriesTray();
    hideReelsNavigation();
    hideExploreGrid();
    hideBottomNav();
  }

  /* --- Non-critical filters (run via requestIdleCallback) --- */
  function processDeferred() {
    hideOpenInAppBanners();
    hideSuggestedSections();
  }

  function scheduleDeferred() {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(function() { try { processDeferred(); } catch(e) {} });
    } else {
      setTimeout(function() { try { processDeferred(); } catch(e) {} }, 100);
    }
  }

  try { processCritical(); } catch(e) {}
  scheduleDeferred();

  /* Programmatic focus-input scrollIntoView removed — it competed with
     WKWebView's built-in scroll-on-focus and the BrowserView keyboard-spacer
     (build 132). The 400ms smooth scroll fired mid-typing in OTP/2FA inputs
     (WhatsApp/SMS code entry), dismissing the keyboard. iOS now handles the
     scroll itself; the keyboard-height spacer covers position:fixed inputs. */

  /* While the user is typing in an input (login password, 2FA/WhatsApp OTP, DM
     compose, story reply, post caption), our filter passes do `querySelectorAll`
     + `getComputedStyle` + `getBoundingClientRect` on every mutation. On iOS
     WKWebView the resulting forced layout can drop focus from the active input
     and dismiss the keyboard. Skip processing while an editable element is
     focused — the next mutation after blur (or on SPA navigation) catches up. */
  function isEditingFocused() {
    var ae = document.activeElement;
    if (ae) {
      var tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable) return true;
    }
    /* Also pause when a dialog containing an input is present but not yet focused.
       Instagram auto-focuses OTP/2FA inputs right after rendering them — our
       getBoundingClientRect/getComputedStyle calls in hideBottomNav force a layout
       pass that interrupts that programmatic focus on WKWebView, closing the dialog.
       Pausing here gives Instagram time to establish focus before we run anything. */
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
    /* Belt-and-suspenders: pause whenever an OTP/verification-code field exists anywhere
       in the DOM, regardless of dialog markup. Catches the WhatsApp/SMS code entry even
       when Instagram wraps it in a role="presentation" or unmarked container, and covers
       the newer /auth_platform/ flow. Also handles cases where the input exists but
       activeElement hasn't been updated yet (iOS WKWebView timing). */
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

  /* --- MutationObserver with rAF debounce ---
     Child additions can introduce any filterable surface, so they still queue
     one coalesced pass. Attribute churn is different: Instagram continuously
     animates unrelated style/class values. Treating every one of those as a
     filter change ran all document-wide scans and layout reads once per frame.

     The one attribute-only transition Dull must observe is a Reels pager being
     activated inside a DM or standalone viewer. Scope those records to Reels
     routes and media-bearing elements; delayed video insertion is covered by
     the childList branch. */
  function isRelevantReelsAttributeMutation(mutation) {
    if (!cfg.reels || mutation.type !== 'attributes') return false;
    if (mutation.attributeName !== 'style' && mutation.attributeName !== 'class') return false;

    var path = window.location.pathname;
    if (path.indexOf('/direct/') !== 0 && !/^\/reels?\//i.test(path)) return false;

    var target = mutation.target;
    if (!target || target.nodeType !== 1) return false;
    if (__dullCachedPager) {
      if (target === __dullCachedPager || __dullCachedPager.contains(target)) {
        /* lockReelsPager writes these styles itself. Ignore the observer
           records once the lock is intact or they schedule a redundant pass. */
        return __dullCachedPager.style.overflow !== 'hidden' ||
          __dullCachedPager.style.overflowY !== 'hidden';
      }
      if (target === document.body || target === document.documentElement) {
        return false;
      }
      /* A non-root wrapper can show/hide the existing overlay using only a
         class/style transition. Re-run so the emergency body lock follows it. */
      if (target.contains(__dullCachedPager)) return true;
    }
    if (target === document.body || target === document.documentElement) return false;
    if (target.tagName === 'VIDEO') return true;
    return !!(target.querySelectorAll && target.querySelectorAll('video').length >= 5);
  }

  var rafPending = false;
  function scheduleRun() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() {
      rafPending = false;
      try { processCritical(); } catch(e) {}
      if (!isEditingFocused()) scheduleDeferred();
    });
  }
  var observer = new MutationObserver(function(mutations) {
    if (rafPending) return;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if ((m.type === 'childList' && m.addedNodes.length > 0) ||
          isRelevantReelsAttributeMutation(m)) {
        scheduleRun();
        return;
      }
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });

  /* Belt-and-suspenders: poll processCritical for ~21 s after init/navigation.
     The mutation observer can miss late state transitions: e.g. when the user
     taps a reel preview in a DM, IG opens an overlay (no URL change, no
     childList mutations on body — just attribute mutations on existing nodes
     plus a delayed batch of video appends ~3-5 s later). The poll runs even
     if the observer misses everything. Stops early once the reels pager is
     successfully locked, so steady-state CPU stays at 0. */
  var pollCount = 0;
  var pollMax = 30;
  var pollTimer = null;
  function startPostNavPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollCount = 0;
    __dullReelsPagerLocked = false;
    pollTimer = setInterval(function() {
      /* A mutation pass already locked the pager since the last tick: the
         poll has done its job, and one more full pass would only repeat it. */
      if (__dullReelsPagerLocked) { clearInterval(pollTimer); pollTimer = null; return; }
      pollCount++;
      try { processCritical(); } catch(e) {}
      /* Section headings are scanned in the deferred pass. Run it from the
         poll too, so a "Suggested for you" block that renders without a
         later mutation is still caught. */
      if (!isEditingFocused()) scheduleDeferred();
      if (__dullReelsPagerLocked || pollCount >= pollMax) { clearInterval(pollTimer); pollTimer = null; }
    }, 700);
  }
  startPostNavPoll();

  /* --- SPA navigation ---
     Skip while an input is focused. Instagram's React Router fires replaceState
     on focus/blur of OTP inputs (auth_platform/, accounts/login). Running
     processCritical() here triggers hideBottomNav's getComputedStyle/getBoundingClientRect
     pass, which on iOS WKWebView dismisses the keyboard the moment the user taps
     the 2FA code field. The next mutation after blur catches up. */
  window.addEventListener('dull-navigation', function() {
    try { processCritical(); } catch(e) {}
    if (!isEditingFocused()) scheduleDeferred();
    startPostNavPoll();
  });

  /* --- Periodic CSS presence check (30s) ---
     Skip the reinject ping while typing — reinjection runs scripts that force
     layout and can drop keyboard focus mid-2FA. */
  setInterval(function() {
    if (isEditingFocused()) return;
    if (!document.getElementById('dull-filter')) {
      try { window.webkit.messageHandlers.dullReinject.postMessage({ platform: 'instagram', reason: 'css_missing_periodic' }); } catch(e) {}
    }
  }, 30000);

  window.__dullPlatformInit_instagram = true;
})();
