# Blockphone — vollständige Funktions-Analyse (Stand Build 143, 15.11.2026)

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

* Picker: `shield/AppTarget/ScreenTimeShield.swift` → `presentPicker` präsentiert
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

## 7. Bestehende, nicht gebaute Extension-Quellen

`native/ios/DeviceActivityMonitorExtension/ScheduledAccessMonitor.swift`,
`native/ios/ShieldConfigurationExtension`, `native/ios/ShieldActionExtension`,
`shield/future/DeviceActivityMonitor/` — vollständig vorhanden, aber **nicht** im
Xcode-Projekt (kein Target, keine Entitlements). Sie sind die Vorlage für §6.

## 8. Tests / Prüfung

`npm test` = 190 Tests (u. a. `lib/appLimits.test.ts` 12, `lib/adBlocklist.test.ts` 3),
`npx tsc --noEmit` grün, iOS-Build 143 archive + TestFlight-Upload erfolgreich.
