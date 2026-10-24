# PhoneBlock+ — Screentime-/Blocker-Architektur (iOS, finaler Plan)

> Kern: **native Social-Apps komplett sperren** (Shield) und stattdessen eine
> **eigene Browser-App (WKWebView)** bereitstellen, die die Web-Versionen lädt und
> dort Reels/Shorts/Werbung per Injection ausblendet. Plus Widgets, Task-Engine,
> Freundeskonto, Monochrom-Look.

## Architektur-Überblick

```
PhoneBlock+ (iOS, nativ Swift + Expo-Dev-Build)
├─ FamilyControls         → einmalige Autorisierung als „Aufsicht"
├─ ManagedSettingsStore   → native Social-Apps sperren (Shield)
│                            denyAppRemoval, denyAccountModification
├─ DeviceActivityMonitor  → Zeitpläne/Limits → automatisch re-shield
├─ Custom-Browser (WKWebView)   ← der eigentliche Inhalt
│    ├─ WKContentRuleList        → Werbe-/Tracker-Block (Safari-Content-Blocker-Format)
│    └─ WKUserScript (JS/CSS)    → Reels/Shorts/Werbe-Slots ausblenden
├─ Task-Engine (Vokabel/Mathe) → bei Erfolg: App für N Minuten entsperren
├─ WidgetKit (2 Widgets)       → Link/URL-Scheme → Browser (oder native App)
└─ Backend (Raspi/Hetzner)     → Konten, Freunde, Extratime, AdGuard-Proxy

AdGuard Home (Raspi :3000) → DNS-Sperren (Geräte + Tracker-Domains)
```

## Feature-Matrix (final)

| Feature | Weg | Tech |
|---|---|---|
| Social-Apps komplett sperren | Shield | `ManagedSettingsStore.shield.applications` |
| **Reels/Shorts/Werbung entfernen** | eigener Browser lädt Web-Version, blende Elemente aus | `WKWebView` + `WKContentRuleList` + `WKUserScript` |
| Keine Werbung | (a) Content-Rules im Browser, (b) DNS-Tracker via AdGuard Home | `WKContentRuleList` + DNS |
| Tageslimit / „ab Uhrzeit X aus" | Schedule + Shield | `DeviceActivitySchedule` + `ManagedSettings` |
| App-Löschung verhindern | Kids-Time-Kopplung | `application.denyAppRemoval` |
| Einstellungen nur mit 1 Tag Wartezeit | app-intern | Timestamp-Guard (24 h) |
| Vokabel/Mathe VOR Öffnen | wie Opal/one sec: gesperrt → Aufgabe → N Min. entsperrt | Shield + Task-Engine |
| Freundeskonto gibt Extratime | Backend | Accounts-API (Freunde schenken Minuten) |
| Homescreen leer, nur 2 Widgets | Icons entfernen (App-Library) + Widgets | „Remove from Home Screen" + WidgetKit |
| Schwarzes Nothing-Design | iOS 18 Icon-Tönung (monochrom) + Widgets | iOS 18 Tint |

## Warum der Browser-Ansatz (WKWebView) funktioniert

Auf iOS kann man Fremd-Apps **nicht** von innen filtern — aber man kann die
**Web-Versionen** laden und im eigenen WebView manipulieren:

1. `WKContentRuleList` = dasselbe JSON-Format wie Safari Content Blocker
   (EasyList/uBlock-Filter) → blockiert Werbe-Requests im WebView.
2. `WKUserScript` injiziert CSS/JS → blendet DOM-Elemente aus
   (z. B. Instagram `a[href*="/reels/"]`, YouTube Shorts-Section, „Open in App"-Banner).
3. Login bleibt über WebView-Cookies erhalten.

### Ehrliche Grenzen des Browser-Ansatzes

- **Brittle:** Instagram/YouTube ändern ständig DOM/Klassennamen → Selektoren müssen
  gepflegt werden (Selector-Liste im Backend aktualisierbar).
- **Feature-Lücken:** Instagram-Web hat eingeschränkte DMs, TikTok-Web ist rudimentär.
- **„Open in App"-Banner / Redirects:** lassen sich teils per JS unterdrücken, aber
  nicht zu 100 % — Websites drängen zur nativen App.
- **YouTube-Erkennung:** YouTube erkennt Adblocker im Web und zeigt ggf. Hinweise —
  das ist ein Katz-und-Maus-Spiel, kein einmaliges Setup.

## Nächste Schritte (Reihenfolge)

1. AdGuard-Proxy auf dem Raspi (Passwort aus keysafe → App bekommt nur Token).
2. Expo Dev Build + Swift-Modul mit **Family Controls**-Capability
   (`expo prebuild`, Custom Native Module).
3. MVP-Shield: App sperren + entsperren + 1 Zeitplan.
4. Custom-Browser: WKWebView + WKContentRuleList + WKUserScript (Reels/Shorts ausblenden).
5. Task-Engine (Vokabel/Mathe) → Minuten-Entsperren.
6. Backend: Freundeskonto/Extratime.
7. Widgets + iOS-18-Monochrom-Look.
