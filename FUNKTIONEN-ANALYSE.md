# Blockphone — vollständige Funktions-Analyse (Stand Build 148, 16.11.2026)

Diese Datei beantwortet: **was existiert, was davon wird wirklich durchgesetzt, und wo im Code.**
Legende: ✅ läuft · 🟡 teilweise / nur in bestimmten Fällen · ❌ vorhanden, aber nicht verdrahtet.

## 1. Tabs (App.tsx)

| Tab | Inhalt | Status |
|---|---|---|
| GLYPH | Uhr, Datum, Streak (`streak.days`), Wochenfortschritt, Kulanz-Tag | ✅ rein lokal (`lib/gamification`, `lib/streakStore`) |
| BROWSER | eigene WebView: URL-Policy, Werbe-/Tracker-Filter, Autofill, Passwort-Tresor, PiP, Mini-Fenster | ✅ (`components/Browser.tsx`, `lib/urlPolicy`, `lib/filters.generated`, `lib/vault`, `lib/autofill`, `lib/pip`) |
| SHIELD | DNS-Tunnel: Plattform-Domains, „Internet aus" (Allowlist), **neu: Werbung + Tracker** | ✅ systemweit (auch native Apps), `targets/packettunnel/*` |
| APPS | **neu**: zwei unabhängige Schalter (Werbeblocker / App-Sperre) + Limits pro App + Wartezeit | ✅ Sperre wirkt, Zeitlimits siehe §7 |
| MEHR → LIMITS | Tagesbudget, 48-h-Änderungssperre | ✅ App-intern (`lib/limits`, `lib/limitStore`) |
| MEHR → COMMIT | Commitment/„Vertrag", PinGate, Streak-Einsatz | ✅ App-intern (`lib/commitment`) |
| MEHR → ZEIT | Zeitplan (Zeitfenster, an denen Apps gesperrt sind) | 🟡 Auswertung in der App; im Hintergrund erst mit Monitor-Extension (§7) |

## 2. Zwei getrennte Blocker-Systeme (Kern der Neuheit in 143)

```
        ┌─────────────────────────────┐   ┌──────────────────────────────┐
        │  WERBUNG + TRACKER          │   │  APP-SPERRE                  │
        │  NEPacketTunnelProvider     │   │  ManagedSettingsStore        │
        │  DNS-Sinkhole, 41.293 +     │   │  shield.applications /       │
        │  5 Plattform-Domaingruppen  │   │  applicationCategories /     │
        │  gilt für ALLE Apps         │   │  webDomains                  │
        └───────────┬─────────────────┘   └──────────────┬───────────────┘
                    │ unabhängig schaltbar               │
              lib/dnsSettings.ts                  lib/appLimitsStore.ts
                    └──────────┬─────────────────────────┘
                       components/AppBlocker.tsx (Tab APPS)
```

* Werbeblocker: `scripts/build-adblocklist.mjs` lädt StevenBlack/hosts, faltet Subdomains
  auf Wurzel-Domains (77.309 → 41.293) und schreibt `targets/packettunnel/adblock.json`
  (825 kB) — liegt als Bundle-Ressource **im** PacketTunnelProvider.appex (im Build-Log
  verifiziert), wird also nicht ins JS-Bundle geladen.
* DNS-Auswertung: `DnsFilter.swift` (Suffix-Match), Blocklist wird bei
  `loadRules()` mit den Plattform-Domains zusammengeführt, wenn `ads == true` und Modus
  ≠ allowlist. Kette: `lib/vpn.ts → VpnManagerModule.swift (start(…, ads)) →
  providerConfiguration["ads"] → PacketTunnelProvider.loadRules()`.

## 3. App-Sperre (Screen Time)

* Picker: `modules/screentime-shield/ios/ScreenTimeShieldModule.swift` → `presentPicker` präsentiert
  `FamilyActivityPicker` **vollflächig** (`modalPresentationStyle = .fullScreen`,
  eigener `UIHostingController` ohne Höhenbegrenzung) — das war der „App wird nicht
  angezeigt"-Fehler. Auswahl wird als `FamilyActivitySelection` (PropertyList)
  persistiert und beim nächsten Öffnen **vorausgewählt**.
* Sperren: `applyShield` setzt applications + `.specific(categories)` + webDomains.
  `shieldApps(indexes)` sperrt **einzelne** Apps aus der Auswahl (Basis für
  Dauer-Sperre pro App).
* Rückmeldung an JS: `shieldState` liest den echten Store (apps/webDomains + eigener
  Kategorie-Zähler, weil `applicationCategories` sich je SDK nicht gefahrlos auslesen lässt).

## 4. Limits pro App (neu, `lib/appLimits.ts`)

Pro App (Index aus dem Picker): `dailySeconds`, `weeklySeconds`, `opensPerDay`,
`pauseSeconds`, `blocked`. Alles editierbar — aber **nicht sofort**:

* `requestChange()` legt einen **Antrag** an; nur einer gleichzeitig, nicht überschreibbar
  (sonst könnte man eine Verschärfung durch einen zweiten Antrag aushebeln).
* Wartezeit: 12 h / 24 h (Default) / 48 h, hart geklemmt auf 1–72 h — auch wenn das
  gespeicherte JSON manipuliert wurde (`normalizeRule`).
* `applyPending()` wird bei jedem Öffnen des Tabs und beim App-Start ausgeführt.
* Verwerfen nur mit PIN (`askPin` + `verifyPin`).
* Persistenz: `pb-app-limits` / `pb-app-limits-delay` (AsyncStorage) **und** Spiegelung
  in die Extension-Defaults (`ScreenTimeShield.setLimits`), damit ein Monitor sie später
  lesen kann.

## 5. Was wirklich durchgesetzt wird (Ehrlichkeits-Matrix)

| Regel | Durchsetzung | Wie |
|---|---|---|
| App dauerhaft sperren (`blocked`) | ✅ | `ManagedSettingsStore.shield.applications`, systemweit, auch bei geschlossener App |
| Ganze Auswahl sperren (Master) | ✅ | `applyShield()` |
| Kategorien/Webseiten sperren | ✅ | `.specific(categories)`, `shield.webDomains` |
| Werbung/Tracker blocken | ✅ | DNS-Tunnel, alle Apps |
| Plattform-Domains (YouTube, Insta, …) | ✅ | DNS-Tunnel |
| Tages-/Wochenlimit, Öffnungen/Tag, Pflicht-Pause | 🟡 gespeichert + Wartezeit ✅, Hintergrund-Durchsetzung ❌ — braucht `DeviceActivityMonitor` (§7) | — |
| Browser-Budget (MEHR → LIMITS) | ✅ | im eingebauten Browser (`lib/limits`) |
| Zeitplan | 🟡 | App wertet aus; Hintergrund = §7 |

## 6. Warum Zeitlimits nicht schon in 143 laufen

Zeitlimits müssen **ohne geöffnete App** feuern (Apple beendet die App). Dafür gibt es nur
`DeviceActivityMonitor` — eine eigene Extension, die (a) ein eigenes Bundle-ID mit dem
gegateten Entitlement `com.apple.developer.family-controls` braucht und (b) die App-Tokens
über eine App Group bekommt.

Beides ist über die ASC-API **nicht** machbar (geprüft 15.11. mit dem Team-Key):
* `POST /v1/bundleIdCapabilities` → `FAMILY_CONTROLS` ist **kein** gültiger Wert der API
  (nur Portal-Antrag); Test-Bundle-ID `com.meister.blockphone.monitortest`
  (ASC-ID `JRHD769378`) wurde dafür angelegt.
* App Group: kein `appGroups`-Resource in der ASC-API (`APP_GROUPS` nur als Capability).

→ Nötig: 1 Portal-Aktion (Antrag Family Controls für das Extension-Bundle-ID) +
`@bacons/apple-targets`-Target für die Extension. Dann ist §5 vollständig.

## 7. Extension-Quellen (seit 16.11.2026 echte Targets)

`targets/deviceactivity/DeviceActivityMonitorExtension.swift`,
`targets/shieldconfig/ShieldConfigurationExtension.swift`,
`targets/shieldaction/ShieldActionExtension.swift` — vollständig vorhanden und als
Xcode-Target verdrahtet, aber per Flag **aus** (`BLOCKPHONE_SHIELD_EXT=1` bzw.
`BLOCKPHONE_DEVICE_ACTIVITY=1`), weil das Provisioning-Profil fehlt.
Details: `docs/NATIVE-STRUKTUR.md`.

## 8. Tests / Prüfung

`npm test` = 190 Tests (u. a. `lib/appLimits.test.ts` 12, `lib/adBlocklist.test.ts` 3),
`npx tsc --noEmit` grün, iOS-Build 143 archive + TestFlight-Upload erfolgreich.


## 9. Build 148 — was repariert wurde und warum

Ausgangslage: Per meldete „App an sich läuft, aber echte Apps werden nicht gesperrt,
Add-Block geht nicht, alles ist über zu viele Einstellungs-Tabs verteilt".

### 9.1 Warum die App-Sperre nicht griff (Root Cause)

| Befund | Beleg | Wirkung |
|---|---|---|
| Die Screen-Time-Brücke war ein **Legacy-RCT-Modul** (`RCT_EXTERN_MODULE`), aus JS über `NativeModules.ScreenTimeShield` geholt | `shield/AppTarget/ScreenTimeShieldBridge.m` (entfernt in 148) | In RN 0.86 / Expo SDK 57 kommt dort `undefined` an → **jeder** Aufruf (`applyShield`, `presentPicker`, `shieldApps`) lief in den `if (!M)`-Zweig und gab still `{shield:"unavailable"}` zurück. Kein Fehler, keine Meldung, keine Sperre. |
| Auswahl wurde in `UserDefaults(suiteName: "group.com.meister.blockphone")` gespeichert | `ScreenTimeShield.swift:41` (alt) | Das Profil (`credentials/appstore_blockphone_140.mobileprovision`) hat **leere** `com.apple.security.application-groups` (`APP_GROUP` wird im CI nie gesetzt → `plugins/withScreenTimeShield.js:13`). Ohne Entitlement liefert `containerURL(forSecurityApplicationGroupIdentifier:)` nil → Schreibzugriffe verschwinden, Auswahl ist nach dem Neustart leer → `applyShield()` meldet `no_selection`. |
| Fehler wurden in der UI als Erfolg gemeldet | `AppBlocker.tsx` (alt): `await syncShield(...)` ohne Ergebnisprüfung, danach „App-Sperre aktiv" | Schalter stand auf AUS, Meldung sagte „aktiv". |
| Wartezeit war Pflicht (min. 1 h) | `lib/appLimits.ts:21` (alt) `MIN_DELAY_H = 1` | Ein Antrag auf „App sperren" wurde erst 12–48 h später wirksam — gefühlt „geht nicht". |

Fix in 148:
* `modules/screentime-shield/` — die Sperre ist jetzt ein **Expo-Modul**
  (`requireOptionalNativeModule("ScreenTimeShield")`), dieselbe Technik wie das
  funktionierende `VpnManager`-Modul.
* Speicher: App Group nur, wenn `containerURL(...)` sie wirklich liefert —
  sonst `UserDefaults.standard` (Auswahl überlebt den Neustart auch ohne Group).
* `applyShield`/`shieldApps` lesen den `ManagedSettingsStore` **zurück** und
  liefern `on` / `not_applied` / `no_selection`. `not_applied` wird in der App
  als Warnkarte gezeigt („iOS hat die Sperre nicht übernommen").
* Neue Karte **DIAGNOSE** (SPERREN → APPS): Modul, Autorisierung, Speicherort,
  Auswahl, echter Store-Inhalt, letzter Fehlschlag.
* Wartezeit-Stufen `0 / 12 / 24 / 48 h` — `0` = **SOFORT** (`isInstant()`).

### 9.2 „Add Block" — eigene Domains

Vorher gab es nur die 5 festen Plattformen. Neu: `lib/dnsBlocklist.ts`
`normalizeCustomDomain()` + `custom[]` in `DnsSettings`; UI in SPERREN → DOMAINS
(„EIGENE DOMAINS" mit Eingabefeld `+ BLOCK`, Tippen auf einen Chip entfernt).
Die Liste geht denselben Weg wie die Plattform-Domains in den Tunnel
(`providerConfiguration.blocklist`).

### 9.3 Einstellungen zusammengelegt

Vorher 5 Tabs + 3 Unter-Tabs (`APPS`, `SHIELD`, `MEHR → LIMITS/COMMIT/ZEIT`).
Jetzt 4 Tabs: **GLYPH · BROWSER · SPERREN · SETUP**
* SPERREN → APPS / DOMAINS (die beiden Sperr-Systeme)
* SETUP → LIMITS / ZEIT / COMMIT / APP-START (alle Einstellungen an einem Ort)

### 9.4 Harte Regeln sind optional

`lib/gateSettings.ts` + `components/GateSettings.tsx` (SETUP → APP-START):
* **PIN verlangen** an/aus (vorher Pflicht beim ersten Start)
* **Intervention** an/aus (vorher immer Atmen/Mathe/Journal vor dem Öffnen)
* **Wartezeit** 0/12/24/48 h (vorher Pflicht-Delay)
* Commitment/Vertrag war schon freiwillig.

### 9.5 Löschschutz und Family Sharing (Antwort auf Pers Frage)

`denyAppRemoval` ist in ManagedSettings vorhanden (`ManagedSettingsStore.application.denyAppRemoval`,
Vorlage lag ungenutzt in der alten `native/ios`-Kopie, jetzt in
`modules/screentime-shield/ios/ScreenTimeShieldModule.swift`). Es ist jetzt als
Schalter **LÖSCHSCHUTZ** in SPERREN → APPS verdrahtet (`setDenyAppRemoval`), inklusive
Rücklesen des echten Werts.

Ehrlich dazu:
* Wirksam wird es praktisch nur mit **Kind-/Family-Autorisierung**
  (`FamilyControls`, AuthorizationCenter `.child`) — also einem Gerät, das über
  Family Sharing als Kind-Gerät verwaltet wird. Bei `.individual` (eigenes Gerät,
  das nutzt die App) verweigert iOS die Einstellung; der Schalter springt dann
  zurück und die App sagt das.
* Der sichere Weg auf dem **eigenen** Gerät: Einstellungen → Bildschirmzeit →
  Beschränkungen → „Apps löschen" aus, mit einem Bildschirmzeit-Code, den eine
  **andere** Person kennt. Family Sharing allein verhindert nichts.
* Keine App kann ihre eigene Löschung verhindern. Wer den Gerätecode hat, kann
  immer löschen (dann sind auch die Sperren weg).
