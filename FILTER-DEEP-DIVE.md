# Instagram-Filter — Deep Dive (filter.js, v2.5.2)

Analyse der Blocking-Logik aus `assets/filters/instagram/filter.js` (2706 Zeilen,
portiert aus der Dull-App, **Stand v1.9.4** / Filter v2.5.2). Die Mechanismen sind 1:1 in jedem WKWebView nutzbar —
unabhängig von React Native / Swift.

> ⚡ **Update 2026-10-25:** Port von Dull v1.9.3 → **v1.9.4** aktualisiert.
> Instagram-Filter v2.4.0 → **v2.5.2**, Reddit v2.1.2 → **v2.2.0**.
> Neu seit v2.4.0: `v2.5.0` Saved Posts/Collections · `v2.5.1` Notifications ·
> `v2.5.2` Account-Switcher (alle aus UserJot-Reports). Reddit v2.2.0: Sign-Out-Popular-Feed-Handling.

## 1. Ausführungs-Modell

```
document-end (injectedJavaScript)
   └─ processCritical()     → sofort, vor first paint (Reels-Nav, Explore-Redirect, CSS-Klassen)
        └─ processDeferred() → requestIdleCallback (Sponsored/Suggested, Banner)
             └─ MutationObserver → bei DOM-Mutationen, rAF-gecoalesced
                  └─ processCritical() + processDeferred() erneut
```

- **Re-entry-Guard**: `window.__dullPlatformInit_instagram` (verhindert Doppel-Injection).
- **Pause beim Tippen**: `isEditingFocused()` → forced Layouts (getComputedStyle) würden
  auf iOS WKWebView den Keyboard-Fokus killen. Filter-Pass wird bei Input/OTP übersprungen.
- **Performance**: `WeakSet processed` (Elemente nie doppelt), `WeakMap cleanArticleSignature`
  (saubere Artikel werden bis zur Inhaltsänderung übersprungen).

## 2. Sponsored / Ads (cfg.ads)

Zwei unabhängige Signale, beide im Home-Feed (`/`):

**a) Label im Header** — `findHeaderLabel(article, markers)`:
- `TreeWalker` pre-order durch den Artikel, stoppt am ersten Media-Element.
- Prüft `aria-label` / `title` / `textContent` (≤ 96 Zeichen) gegen `sponsoredMarkers`.
- Marker sind **lokalisiert** (folgen der Account-Sprache, nicht der UI-Sprache):
  `Sponsored`, `Gesponsert`, `Anzeige`, `Promoted`, `Publicidad`, `Sponsorisé`, … (~40 Sprachen).
- Match = ganzer String oder `"Sponsored · ..."` (separiert). **Array-Scan statt Objekt-Literal**,
  damit `"constructor"` nicht als geerbter Key matcht (Bug aus v1.9.1).

**b) Outbound-Link** — `hasOutboundAdLink(article)`:
- Organische Posts haben **keine** Links raus aus Instagram.
- Ein gesponserter Post hat „Learn more"/„Shop now" → `l.instagram.com`/`l.facebook.com`-Shim
  oder non-Meta-Host.
- `META_HOST`-Whitelist: instagram.com, facebook.com, fbcdn.net, cdninstagram.com, threads.*, meta.*, whatsapp.com.
- Alles außerhalb → Ad-Signal.

→ Treffer: `collapseElement(article, 'ad')` + `pauseVideos()` (Reel-Previews stoppen).

## 3. Suggested Posts & Sections (cfg.suggested)

**Posts** (`hideLabelledFeedCards`): `suggestedPostMarkers` im Header („Suggested for you",
„Vorgeschlagen", …) → Post collapsen.

**Sections** (`hideSuggestedSections`):
- Sucht Überschriften (`h1`–`h4`, `[role=heading]`, `div[dir=auto]`, `span`).
- `findSuggestionListContainer(heading)` klettert ≤ 8 Ebenen hoch und sucht den kleinsten
  Container mit **2+ Profil-Links + 2+ Buttons** (Follow-Buttons) → das ist das Account-Karussell.
- Stoppt an `article`/`input`/`nav`/`[role=dialog]` (nie zu viel collapsen).
- Alles nach einer „Suggested posts"-Überschrift am Feed-Ende wird auf jedem Pass gecollapst.
- `data-dull-collapsed` + always-on CSS-Regel → ein React-Style-Rewrite kann es nicht aufheben.

## 4. Der Einzel-Reel-Lock (cfg.reels) — das Herzstück

Ziel: ein **von einem Freund geteiltes Reel** darf man ansehen, aber **nicht durchswipen**.

**4a. URL-Ebene** — `enforceSingleReel()`:
- Reel-ID aus Pfad (`/reel/<id>/`, `/reels/<id>/`).
- Erste ID wird gemerkt (`__dullReelLockedId`), `next`/`next_media_id`-Params werden entfernt.
- Wechselt die ID (Wisch zum nächsten Reel) → `location.replace('/direct/inbox/')`.

**4b. DOM-Ebene** — `lockReelsPager()` (URL-Gating reicht nicht: DM-Reel-Overlay ändert die URL **nicht**):
- **URL-Gate**: nur `/direct/` oder `/reels?/` — sonst würde ein `<video>`-Container im normalen
  Feed als „Pager" fehlklassifiziert und echtes Scrollen gelockt.
- **Pager-Signatur** (`findReelsPager`): von jedem `<video>` ≤ 16 Ebenen hoch, akzeptiert
  Container mit `clientHeight` 400…1.2×Viewport, **5+ video-descendants**, **2+ viewport-große
  Portrait-Videos** (`height > width × 1.1`), `overflow-y: scroll|auto`.
- **Ausschluss**: `<body>`/`<html>` (sonst totes Scrollen), `role=log` (Chat-Transkript via
  `isMessagingHistoryContainer`).
- **Lock**: `overflow: hidden`, `touch-action: none`, `scroll-snap-type: none` → alle
  non-aktiven Kinder `display:none`. Aktives Reel = Video mit `rect.top` am nächsten an 0.
  DM-Wrapper-Fall: eine Ebene tiefer recurse.

**4c. Pre-emptive Body-Lock** — `maintainPreEmptiveLock()`:
- Der Pager braucht 150–300 ms zum Aufbau; ein schneller Wisch in dem Fenster würde ein Reel
  weiterschalten. Sobald **ein** full-viewport Portrait-Video im DOM ist (nur `/direct/` oder
  `/reels?/`), wird `html/body { overflow: hidden; touch-action: pan-x }` gesetzt (< 50 ms).

**4d. Swipe-Interrupt-Overlay** — `showReelInterruption()`:
- Versucht der Nutzer trotzdem zu wischen (touch dy > 30 px / wheel deltaY > 20), erscheint
  für 4 s ein Blur-Overlay (mittleres Band, Top/Bottom frei für Back-Button + Composer):
  > **„no scrolling past this reel."**
  > **„that's the whole point of dull."**
- **Space Mono**, monochrom, `pointer-events:none` (Back-Geste bleibt nutzbar),
  `mask-image`-Gradient für weiche Kanten. Das ist der sichtbare „dull"-Moment.

## 5. Friends-Only (cfg.friendsOnly)

- Feed nur von gefolgten Accounts: `/?variant=following` (seit 2022 stabil).
- `:has()`-Regeln für Feed-Switcher-Pill + „Back to For You"-Link.
- Story-Compose-Workaround: Following-Variante zeigt keine Story-Tray → filter.js stampft
  `__dullStoryCompose` in sessionStorage und lädt `/` mit 10-min-Fenster (Story-Posting).

## 6. Messages-Only (cfg.messagesOnly)

- Redirect auf `/direct/inbox/`; non-DM-Routen werden versteckt.

## 7. Explore-Block (cfg.explore)

- `/explore/` (außer `/explore/search/`) → Redirect auf `/explore/search/` (Suche ist erlaubt,
  der Endlos-Feed nicht). `hideExploreGrid()` entfernt das Raster; die Lupe bleibt als
  einziger Such-Einstieg.

## 8. „Open in App"-Banner (cfg.ads / always-on)

`hideOpenInAppBanners()` entfernt App-Install-Banner; unterscheidet echte App-Store-Ziele
(`apps.apple.com`, `itunes.apple.com`, Universal-Links) von normalen UI-Sheets via
`isExplicitInstallOrLoginWall()`.

## Übernehmbare Konstanten (für den Klon)

- `sponsoredMarkers` / `suggestedPostMarkers` / `suggestedSectionMarkers`: lokalisierte Listen
  (im Backend aktualisierbar — Instagram ändert die Labels).
- `META_HOST` / `LINK_SHIM_HOST`: Host-Whitelist für die Outbound-Ad-Erkennung.
- Selektoren für Reels-Nav: `a[href="/reels/"]`, `svg[aria-label="Reels"]`, `svg[aria-label="Reel"]`.
