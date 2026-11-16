# Blockphone — Analyse „Browser-Versionen der Apps"

Stand: 2026-11-07 · Code-Stand: `190fee9` + uncommittete Feature-Arbeit (Shield/Schedule/Paywall/native)
Methode: Code-Lesung + `tsc --noEmit` + `node --test` + `generate-filters.mjs`-Diff + Entitlement-Prüfung im Profil.
**Nichts geändert** — nur Befunde.

## Ist-Zustand (was existiert)

| Baustein | Datei | Status |
|---|---|---|
| In-App-Browser (WebView) | `components/Browser.tsx` (554 Z.) | funktioniert strukturell |
| Feed-Filter (Dull-Port) | `assets/filters/{youtube,instagram,facebook,x,reddit}` + `lib/filters.generated.ts` | in sync, JS syntaktisch valide |
| Tageslimit-Engine | `lib/limits.ts`, `lib/limitStore.ts`, `components/LimitSettings.tsx` | 77 Tests grün |
| Session/Cooldown | `lib/schedule.ts`, `lib/sessionStore.ts` | im Browser aktiv |
| Systemweite Sperre (native Apps) | `modules/screentime-shield/`, `plugins/with*.js`, `components/Shield.tsx` | **im Build** (Build 148) |

Injektionsgrößen: YouTube 28 KB · Instagram 139 KB · Facebook 71 KB · X 21 KB · Reddit 28 KB.

## Befunde

### A. „Fast Vollbild" — aktuell ~67 % des Screens

1. `App.tsx:290–320` rendert Header (`BLOCKPHONE`) **und** Tab-Leiste in *jedem* Tab, auch in BROWSER.
2. `Browser.tsx:277–286` Plattform-Picker (~46 pt) + `Browser.tsx:400–430` Status-/Nav-Leiste (~35 pt).
3. `SafeAreaView` (RN, deprecated) oben 59 / unten 34 pt.
4. Höhenbudget iPhone 14 Pro (852 pt): 59 + 70 + 38 + 46 + 35 + 34 = **282 pt Chrome → WebView ≈ 570 pt (67 %)**.
5. `app.json:6` `"orientation": "portrait"` → Video-Vollbild kann nicht ins Querformat drehen (Funktion der Web-Apps fehlt).

### B. „Ohne Werbung / ohne Reels" — greift, aber unzuverlässig

6. **Injektion zu spät:** `injectedJavaScript` wird von react-native-webview als `WKUserScriptInjectionTimeAtDocumentEnd` registriert
   (`node_modules/react-native-webview/apple/RNCWebViewImpl.m:1708–1716`). CSS + DOM-Filter starten also erst nach vollständigem Parse
   → erster Feed / erstes Video kann Werbung + Reels zeigen (Flash). Nur `injectedJavaScriptBeforeContentLoaded`
   (= `AtDocumentStart`, ebd. 1743–1752) läuft früh genug — dort wird aber nur Config + Bridge gesetzt, kein Filter.
7. **Reinject wird ignoriert:** filter.js fordert Selbstheilung an (`dullReinject.postMessage({reason:'css_missing_periodic'})`,
   z. B. `assets/filters/x/filter.js` Health-Check). `Browser.tsx:243–262` akzeptiert **nur** `m.count` → die Anfrage verfällt.
   Fällt das `<style id="dull-filter">` weg (SPA-Rebuild, Navigation), bleiben Werbung/Reels dauerhaft drin, ohne Signal.
8. **Drei Config-Schlüssel fehlen** in `FilterConfig`/`DEFAULT_FILTER_CONFIG` (`lib/browser.ts:14–70`):
   - `suggestions` → X: `hideUserCellSuggestions` + `hideHeadingBasedSuggestions` laufen **nie** (`assets/filters/x/filter.js` nutzt `cfg.suggestions`),
   - `feedVideoHomeRedirect` → Facebook-Feature tot,
   - `strings` → Lokalisierungs-Copy (nur Kosmetik, Fallback Englisch).
9. **Flag-Kollision `premium`:** steuert YouTube-Background-Playback *und* X-Premium-Upsell-Hiding. Default `false`
   → X-Upsells bleiben drin, obwohl der Kommentar „Standard: alles blockieren (maximal dull)" sagt.
10. **Defaults widersprechen der Doku:** `friendsOnly/stories/messagesOnly/feedsOnly` = `false`, Kommentar sagt „alles blockieren".
11. **Filter-Config ist hartcodiert** — keine UI, keine Persistenz. Werbung/Reels/Shorts lassen sich **nicht** ein-/ausschalten.

### C. „Einstellbare Begrenzungen" — nur halb wahr

12. Tageslimit (pro Plattform, Reset um Mitternacht) funktioniert im Browser. Presets: 0/10/20/30/60/120 min (`LimitSettings.tsx:27`) — keine freie Minute.
13. **Systemweite Begrenzung existiert nicht im Build:** `plugins/withScreenTimeShield.js` + `withNetworkBlocker.js` setzen gated
    Entitlements (`com.apple.developer.family-controls`, `…networking.networkextension`, `…vpn.api`, App Group).
    Das lokale App-Store-Profil `credentials/ios_appstore.mobileprovision` enthält **keines** davon (nur `application-identifier`,
    `keychain-access-groups`, `beta-reports-active`) → nächster EAS-Build bricht an der Signatur, und die `.appex`-Targets
    (ShieldConfig/ShieldAction/DeviceActivityMonitor, PacketTunnelProvider.appex) sind als Targets verdrahtet, aber per Flag aus (`docs/NATIVE-STRUKTUR.md`).
    Apple-Freigabe für Family Controls steht aus (`FAMILY-CONTROLS-ANTRAG.md`).
14. **Tote Einstellungen:** Quiet Hours + Posting Mode werden gespeichert (`ScheduleSettings.tsx`), aber nirgends erzwungen
    (`withinQuietHours()` wird von keiner Datei aufgerufen).
15. **Zählfehler:** kein `AppState`-Handling (`grep AppState` → 0 Treffer). `elapsed = now − sessionStartRef`
    (`Browser.tsx:96–99`) zählt Zeit, in der die App im Hintergrund / das Display aus ist, als Nutzung → Limit ohne Nutzung aufgebraucht.
    Gegenläufig: App-Kill verliert bis 30 s (`CHECKPOINT_MS`).
16. Session-/Cooldown-Werte werden nur beim Mount geladen (`Browser.tsx:153–171`) → Änderung greift erst nach Tab-Wechsel.

### D. „Mit den Funktionen"

17. Cookies/Session persistieren (WKWebView-Default-Store) → Logins bleiben erhalten. Positiv.
18. `setSupportMultipleWindows={false}` (`Browser.tsx:311`) → OAuth-/Share-Popups laden im selben View; kann Google-/Meta-Login stören.
19. Risiko Google-Login in Embedded-WebView („browser or app may not be secure"); UA ist Safari-like, **muss am Gerät geprüft werden**.
20. Kein TikTok; kein Launcher/Icon-Raster für die Plattformen; nur ‹ / ↻ / ⌂-Buttons, keine iOS-Zurück-Wischgeste.

## Fix-Plan (priorisiert, jeweils verifizierbar)

| # | Fix | Wirkung | Aufwand |
|---|---|---|---|
| 1 | Browser-Vollbild: Header/Tabs im BROWSER-Tab ausblenden, Picker als Overlay, Status/Nav auto-hide | 570 → ~750 pt (88 %) | M |
| 2 | Filter-Injektion nach vorn: CSS ab DocumentStart (Style via MutationObserver), Ad-Strip-JS (`ytInitialPlayerResponse`-Trap + fetch-Proxy) ab DocumentStart | Werbung/Reels auch im ersten Load weg | M |
| 3 | `dullReinject` in `onMessage` behandeln → CSS/JS nachinjizieren | Filter fallen nicht mehr still aus | S |
| 4 | `FilterConfig` erweitern (`suggestions`, `feedVideoHomeRedirect`, `strings`), `premium` splitten (`ytBackground` / `xPremium`), Defaults an Doku angleichen | X-/FB-Filter wieder aktiv | S |
| 5 | FilterSettings-UI + Persistenz (AsyncStorage wie `limitStore`) pro Plattform | Begrenzungen **einstellbar** | M |
| 6 | `AppState`-Handling: bei `background/inactive` flushen + pausieren, bei `active` neu basieren | Limits zählen korrekt | S |
| 7 | Quiet Hours + Posting Mode im Browser erzwingen | tote Settings werden wirksam | S |
| 8 | Native Sperre ehrlich trennen: Shields/VPN aus dem Build nehmen, bis Entitlements + Apple-Freigabe da sind; UI per Feature-Flag | Build bricht nicht, keine Fake-Funktion | S |
| 9 | `orientation: "default"` + `UISupportedInterfaceOrientations` | Video-Vollbild quer möglich | S |
| 10 | TikTok (`m.tiktok.com`) + Icon-Launcher | Wunsch „die Apps" vollständig | M |

Reihenfolge-Empfehlung: 3 → 8 → 6 → 1 → 2 → 4 → 5 → 7 → 9 → 10 (kleine, sichere Fixes zuerst; 1+2 sind die sichtbaren Sprünge).

## Gate-Stand (gemessen)

- `npx tsc --noEmit` → **EXIT 0** (grün)
- `node --import tsx --test lib/*.test.ts` → **77 Tests, 0 fail**
- `node scripts/generate-filters.mjs` → `lib/filters.generated.ts` **in sync**
- `node --check assets/filters/*/filter.js` → alle 5 **OK**

---

# UMGESETZT (Runde 2)

Schwerpunkt dieser Runde: **alles in-app**, **gespeicherte Passwörter**, **harte Sperren**, **Zeitsperren**.

## 1. Links bleiben in der App
- `scripts/…` unverändert; Logik in `components/Browser.tsx`:
  - `onShouldStartLoadWithRequest`: nur `http`/`https`. Alles andere (`youtube://`, `instagram://`, `intent://`, `itms-apps:`, `tel:`, `mailto:`) wird verworfen → kein Handoff an die native App/Safari.
  - `HANDOFF_HOST_RE` blockt Store-/Geräte-Hosts (`apps.apple.com`, `itunes.apple.com`, `testflight.apple.com`, `play.google.com`, `appgallery.huawei.com`).
  - `REDIRECT_PATH_RE` blockt Weiterleitungs-Endpunkte (`/redirect`, `/l.php`, `/flx/warn`, `/linkshim`, …) inkl. doppelt-URL-kodierter Pfade (iteratives `decodeURIComponent`, fail-closed).
  - **Neu `onOpenWindow`**: `window.open`/`target="_blank"` wird in *derselben* WebView geladen (gleiche URL-Policy), statt eine zweite WebView/App zu öffnen.
- iOS-Verhalten geprüft (`node_modules/react-native-webview/apple/RNCWebViewImpl.m`): ohne `onOpenWindow` lädt die Lib `target=_blank` selbst in derselben View; mit Handler übernehmen wir das explizit.

## 2. Gespeicherte Passwörter (Keychain-Tresor)
- `lib/vault.ts` (pure): `baseDomain`, `hostOf`, `normalizeCredential`, `upsertCredential`, `removeCredential`, `credentialsForHost`, `canFillOn`, `maskSecret`; Deckel 30 Einträge.
- `lib/vaultStore.ts`: Persistenz über `expo-secure-store` (iOS-Keychain), serialisiert, Secret verlässt die Keychain nur auf Tap.
- `lib/autofill.ts`: zwei getrennte Skripte
  - `buildCaptureScript()` — lauscht auf `submit` (und Submit-Buttons ohne `<form>`), meldet `{type:"pbVaultOffer", host, username, secret}` an die App; **kein Auto-Save**.
  - `buildFillScript(host, user, secret)` — prüft vor dem Schreiben die Domain im WebView (`__pbBase(location.hostname) === host`), setzt Werte über den native Setter + `input`/`change`-Events (React-kompatibel).
- `components/VaultSheet.tsx`: Bottom-Sheet „LOGIN SPEICHERN?" (maskiert, nur letzte 2 Zeichen) und Liste „PASSWÖRTER" mit Füllen/Löschen.
- Anti-Leak: `onMessage` akzeptiert `pbVaultOffer` nur, wenn `baseDomain(msg.host) === hostOf(aktuell geladene URL)`; `canFillOn()` verhindert Fills auf fremden Domains. Secrets liegen nie in AsyncStorage, nur in der Keychain.
- Bewusst **nicht** iCloud-AutoFill: in WKWebView von Drittanbieter-Apps nicht verfügbar (nur Safari bzw. Apps mit Web-Browser-Entitlement).

## 3. Harte Sperren (vorher nur Deko)
- `lib/access.ts` (pure) führt alle Ebenen in **einer** Entscheidung zusammen, Reihenfolge hart → weich:
  1. Commitment-Sperre (`filterLockedUntil[platform]`) → kein Unlock, kein Fenster
  2. Quiet Hours → kein Unlock, kein Fenster
  3. manuelle Sperre (⏻) → unlock-bar
  4. laufendes Posting-Fenster → Zugang
  5. Session-Limit abgelaufen → unlock-bar (außer Cooldown)
  6. Tagesration aufgebraucht → unlock-bar (außer Cooldown)
- Vorher wurde `filterLockedUntil` **nur angezeigt** (`CommitmentSettings`), nie durchgesetzt — jetzt blockt der Browser wirklich.
- `settingsLocked` wird jetzt ebenfalls durchgesetzt: `lib/commitment.ts` → `settingsLockInfo()` (+ `commitmentStore.loadSettingsLock()`); Limits (`components/LimitSettings.tsx`) und Zeitfenster (`components/ScheduleSettings.tsx`) sind bei aktiver Sperre schreibgeschützt (Guard in den Update-Funktionen *und* Banner mit Recovery-Restzeit).
- Freischalten im Browser: Atem-Intervention → PIN (wenn gesetzt, `streakStore.verifyPin`) → `unlockFor()`; Cooldown blockt erneutes Freischalten.

## 4. Zeitsperren
- Quiet Hours (`lib/schedule.ts: withinQuietHours`) werden im Browser erzwungen — vorher rief sie niemand auf.
- Posting Mode: `lib/postingStore.ts` (`pb-posting-usage`, atomar, tagesgebunden, fail-closed) + „ZEITFENSTER ÖFFNEN · X MIN" im Lock-Overlay.
- Session-Limit + Cooldown laufen mit; Timer startet mit der Freischaltung (nicht beim App-Start → kein Sofort-Lock).

## 5. Zählung / Vollbild / Injektion
- `AppState`: bei `background/inactive` erst flushen, dann pausieren; bei `active` neu basieren + Settings neu laden. Hintergrundzeit zählt nicht mehr als Nutzung.
- 30-s-Checkpoint bleibt; Flush serialisiert (`flushChainRef`), damit parallele Checkpoints nicht doppelt zählen.
- **Vollbild**: `tab === "browser"` rendert jetzt einen eigenen Full-Screen-Modus (Header/Tabs/Statusbar weg) — WebView volle Höhe; Chrome (Status+Nav) blendet nach 5 s aus, Tap-Streifen unten holt sie zurück, Picker als Overlay, Verlassen über ✕.
- **Injektion nach vorn** (#2): `buildEarlyCssScript(platform)` setzt das Filter-CSS bereits `AtDocumentStart` (`#dull-filter`), die späte Injektion nach DOM-ready bleibt (idempotent) → kein Aufblitzen von Werbung/Reels.
- `dullReinject` wird jetzt behandelt (#3): bei `{platform, reason:"css_missing_periodic"}` wird CSS+JS nachinjiziert.

## 6. Filter-Config
- `FilterConfig` um `suggestions`, `feedVideoHomeRedirect`, `strings` erweitert; `premium` ist jetzt eindeutig X-Upsell-Hiding, YouTube-Background-Playback heißt `ytBackground` (Default aus).
- Defaults an die Doku angeglichen (`friendsOnly`, `stories`, `feedsOnly`, `suggestions`, `premium` = true).
- `lib/filterStore.ts`: Persistenz + Toggle-UI in `LimitSettings` (Abschnitt **FEED-FILTER**, je Plattform).
- **Nebenbefund behoben**: `lib/filters.generated.ts` war *nicht* im Sync mit `assets/filters/{instagram,reddit}` (veraltete Strings). `node scripts/generate-filters.mjs` hat sie aktualisiert — die App nutzt jetzt die aktuellen Filter.

## Gate-Stand nach der Umsetzung
- `npx tsc --noEmit` → **EXIT 0**
- `npm test` → **105 Tests, 0 fail** (neu: `lib/access.test.ts` 16, `lib/vault.test.ts` 12, `commitment` +3)
- `node scripts/generate-filters.mjs` → **in sync**
- `craft-gate` → **GRÜN** (Tests, Typcheck, `expo export` Build, Secret-Heuristik; eslint nicht konfiguriert)
- Playwright-Smoke (echtes Chromium): Injektion für alle 5 Plattformen ohne `pageerror`, `#dull-filter` gesetzt, `__dullConfig` vorhanden, plattformspezifische Selektoren greifen (IG `/reels/`, X Home-Tab).
- Playwright-Smoke Autofill: Capture sendet `pbVaultOffer` mit `host=youtube.com`, Fill schreibt Benutzer+Secret, Fill auf fremder Domain liefert `false` und schreibt nichts.

## Offen
- iOS-Build muss neu gebaut werden (EAS), damit die Änderungen auf dem Gerät landen (buildNumber 114 → 115).
- Systemweite Sperre (Family Controls + NetworkExtension) weiter blockiert (Apple-Freigabe offen).
- Quer-Video: `orientation: "portrait"` in `app.json` unverändert (bewusst, um Rotation im Rest der App zu vermeiden) — bei Bedarf auf `"default"` + per-Screen-Lock umstellen.

## Review-Runde 1 (code-reviewer + security-reviewer)

Behoben:
- **HIGH · Redirect-Umgehung über Popups**: `window.open`/`target=_blank` prüfte die URL-Policy nicht. Policy nach `lib/urlPolicy.ts` extrahiert (`isInAppAllowed`), neue `lib/urlPolicy.test.ts` (9 Tests), beide Aufrufstellen nutzen jetzt dieselbe Prüfung.
- **HIGH · Domain-Kollaps**: `baseDomain` nutzte eine reine 2-Label-Regel → bei `co.uk`, `github.io` u. a. wäre ein gespeichertes Passwort auf jeder fremden Seite derselben Domain angeboten worden. Jetzt Multi-Label-Suffix-Liste (identisch in `vault.ts` **und** im injizierten `__pbBase`); Test: `evil.github.io` sieht `attacker.github.io` nicht.
- **MEDIUM · unhandled rejection**: `flushUsage()` im Cleanup und im 30-s-Intervall hing ohne `.catch` an `addUsage` → bei AsyncStorage-Fehler eine unbehandelte Promise-Rejection. Jetzt `.catch(() => {})` (der Flush selbst läuft weiterhin serialisiert).
- **Härtung Honeypot-Fill** (aus dem CRITICAL-Hinweis): Fill schreibt nur in sichtbare und nicht offscreen positionierte Felder (`checkVisibility`, `right/bottom <= 0` verworfen, Felder unterhalb des Folds erlaubt). Playwright-Beweis: `display:none`, `aria-hidden`, `left:-9999px` bleiben leer, echtes Feld wird gefüllt.

Bewusst nicht geändert (dokumentiert):
- **Main-World-Injection des Secrets** ist bei jedem Web-Passwortmanager in einer Dritt-App-WKWebView unvermeidbar (kein isolierter Content-World-Zugriff über react-native-webview; iOS-AutoFill steht nur Safari/Browser-Entitlement zur Verfügung). Der Seite ist das Secret ohnehin bekannt, sobald es in ihrem Feld steht; der Tresor reduziert das Risiko auf „Nutzer tippt explizit".
- **Gefälschte `pbVaultOffer`** kann nur einen Speichern-Dialog auslösen (Domain wird geprüft, Ersetzen wird bestätigt) — kein Lesepfad auf gespeicherte Secrets.
- `vaultStore`/`filterStore` schlucken Write-Fehler weiterhin (UI zeigt keinen Fehler); als MEDIUM vermerkt.

## Runde 3 — URL-Policy gehärtet (08.11.2026)
- `lib/urlPolicy.ts`: Prozent-Dekodierung legt bei EINEM kaputten Escape nicht mehr die ganze Kette lahm (fail-open behoben, `%252Fredirect%zz` → blockiert); führende Dot-Segmente nach dem Dekodieren aufgelöst (`%2e%2e%2fredirect`, `..%2fredirect` → blockiert); rohe URL (16 KB) und Hostname (253) gedeckelt; Handoff-Hosts um Universal-Link-Brücken erweitert (`t.me`, `wa.me`, `open.spotify.com`, `music.apple.com`, `maps.apple.com`).
- `components/Browser.tsx`: Passwort-Fill prüft jetzt auch `access.locked` (WebView ist bei harter/Zeit-Sperre nicht gemountet).
- Kein `Linking.openURL`/`WebBrowser`/`Sharing` im ganzen App-Code → alles bleibt in der WebView.
- Gate: 138 Tests, tsc 0, expo build, Secrets: GRÜN.

## Runde 4 — Review-Findings (08.11.2026)
- `Browser.tsx`: `reloadAll` fällt bei Storage-Lesefehler NICHT mehr auf frische Ration zurück (fail-open) — neuer `stateLocked` sperrt den Browser statt 0 s Verbrauch anzunehmen; alle Aufrufe mit `.catch`; `doRelock` persistiert jetzt `markUnlocked` (Cooldown war per AppState-Reload verkürzbar).
- `lib/vault.ts`: `baseDomain` nimmt das LÄNGSTE passende Public-Suffix → `s3.amazonaws.com`-Eintrag wirkt jetzt, Buckets/Mandanten sind getrennt (vorher Fill über Mandantengrenzen möglich).
- `lib/urlPolicy.ts`: Steuerzeichen im Pfad (auch kodiert, `%0a`) = fail-closed statt entfernt.
- Gate: 142 Tests, tsc 0, build, Secrets: GRÜN.

## Runde 5 — Review Runde 1/2 (08.11.2026)
- HIGH (fail-open) geschlossen: `limitStore.parseState` wirft jetzt bei korruptem JSON/falschem Shape und `loadLimits` schluckt Lesefehler nicht mehr → `reloadAll` sperrt fail-closed (`stateLocked`) statt frische Ration anzunehmen.
- HIGH (Domain-Leak) entschärft: `baseDomain` behandelt IP-Literale atomar (`10.0.0.1` ≠ `10.0.0.2`, vorher beide `0.1`), plus generische ccTLD-Second-Level-Regel (`co.il`, `com.ph`, `com.co` …) — vorher kollabierten solche Hosts auf `<x>.<cc>`.
- `lib/autofill.ts`: `__pbBase` rechnet jetzt IDENTISCH zu `baseDomain` (Laengstes Suffix, IP atomar, ccTLD-Muster) — vorher nur last2 → Save/Fill auf `*.s3.amazonaws.com` brach ab.
- Dead ternary im Quiet-Hours-Text entfernt.
- Neu: `lib/autofill.test.ts` (Skript-Syntax + Parität Injektion↔App bei 15 Hosts), in `npm test` aufgenommen.
- Gate: 144 Tests, tsc 0, build, Secrets: GRUEN.

## Runde 6 — Review Runde 1/2 (08.11.2026)
- MEDIUM geschlossen: `buildFillScript` normalisiert den erwarteten Host jetzt über `baseDomain()` — ein unnormalisierter Aufrufer-Host (`M.YouTube.com:443`) kann den Domain-Guard weder aushebeln noch den Fill still abbrechen.
- LOW geschlossen: `BASE_DOMAIN` ist exportiert; `lib/autofill.test.ts` schneidet nicht mehr am generierten String, sondern laedt den Baustein direkt.
- Der Anti-Leak-Guard wird jetzt WIRKLICH ausgefuehrt (Mini-DOM + fake window): fremde Domain / `youtube.com.evil.com` / `instagram.com@evil.com` → kein Fill; eigene Domain + Subdomain + Grossschreibung → Fill.
- Gate: 146 Tests, tsc 0, build, Secrets: GRUEN.

## Runde 7 — Review Runde 1/2 (08.11.2026)
- MEDIUM geschlossen: `runFill` liefert jetzt den RÜCKGABEWERT des injizierten Skripts mit; Negativ-Tests asserten `true`/`false`, nicht nur den (auch bei kaputtem Skript leeren) Feldwert. Dabei echter Bug gefunden: `true;` als letzte Anweisung eines IIFE ergibt `undefined` (Funktionen ohne `return`) → beide Skripte endeten ohne Erfolgssignal, jetzt `return true;`.
- LOW geschlossen: `__pbBase` weist Hosts mit ungueltigen Zeichen jetzt wie `baseDomain()` fail-closed ab ("" statt "com@evil.com"); ungueltige Hosts in der Paritaetsliste (a@b.com, _x.com, instagram.com@evil.com).
- Gate: 146 Tests, tsc 0, build, Secrets: GRUEN.
