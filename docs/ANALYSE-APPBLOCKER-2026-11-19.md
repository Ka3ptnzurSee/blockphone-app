# Analyse: AppBlocker-Subsystem (SPERREN → APPS) — Stand Build 148

Gemessen am 2026-11-19 gegen das **ausgelieferte** Build 148 (ASC, 2026-11-16T22:13Z),
nicht gegen den Quellcode-Wunsch. Alles unten ist mit Befehl/Datei belegt.

---

## 1. Gate (harte Zahlen)

| Prüfung | Ergebnis | Beleg |
|---|---|---|
| Unit-Tests | **193 / 193 grün** | `npm test` → `# tests 193 # pass 193 # fail 0` |
| TypeScript | **0 Fehler** | `npx tsc --noEmit` → Exit 0 |
| Native-Targets | OK | `node scripts/check-targets.mjs` → `check-targets: OK` |
| ASC-Builds | 148, 147, 146, 144, 143 (VALID) | `/opt/apps/check-builds.mjs` |

## 2. Was im Build 148 wirklich drin ist (Kernbefund)

Build 148 kommt aus dem CI-Lauf `gh run 43961899166` (push auf master, 35m55s, Ende
22:13Z = Upload-Zeit). Dessen Log ist eindeutig:

```
· dieser Build zusätzlich: — (keine Flags gesetzt)
[PREBUILD] [apple-targets] baue 1 Target(s): packettunnel
```

→ **Im Release steckt genau EINE Extension: der DNS-Tunnel.**
`shieldconfig`, `shieldaction`, `deviceactivity` sind im Repo vorhanden und als Xcode-Target
verdrahtet, werden aber nur mit `BLOCKPHONE_SHIELD_EXT=1` / `BLOCKPHONE_DEVICE_ACTIVITY=1`
gebaut — und **kein Skript setzt diese Flags** (`.github/workflows/ios-build.yml` setzt nur `CI=1`).

Konsequenz für den Nutzer:

| Feature | Quelle | Im Build 148? |
|---|---|---|
| App-Sperre (ManagedSettings) | `modules/screentime-shield/ios/ScreenTimeShieldModule.swift` | ✅ ja — aber mit **Apples Standard-Sperrbildschirm** |
| Eigener Sperr-Screen „LESS. PLEASE COME AGAIN." | `targets/shieldconfig` (71 Zeilen) | ❌ **nicht im Build = toter Code im Release** |
| „ENTSPERREN"-Button / Shield-Action | `targets/shieldaction` (48 Zeilen) | ❌ **nicht im Build** |
| Zeitlimits im Hintergrund | `targets/deviceactivity` (53 Zeilen) | ❌ nicht im Build (und siehe §4: wäre auch dann wirkungslos) |

## 3. Was tatsächlich durchgesetzt wird

| Regel | Durchsetzung | Beleg |
|---|---|---|
| Master-Sperre (ganze Auswahl) | ✅ systemweit | `applyShield()` → `store.shield.applications/-applicationCategories/.webDomains` |
| Dauer-Sperre pro App (`blocked=true`) | ✅ systemweit | `syncShield()` → `shieldApps(blocked)` → `shieldApps(indexes)` |
| Kategorien / Webseiten | ✅ | `.specific(cats)`, `store.shield.webDomains` |
| Werbung/Tracker (DNS) | ✅ alle Apps | `targets/packettunnel` + `adblock.json` = **41.293 Domains / 845 KB** |
| Plattform-Domains, „Internet aus" (Allowlist) | ✅ DNS-Ebene | `DnsFilter` mode `blocklist`/`allowlist`, `mode=="allowlist"` → `!matches(allowlist)` |
| **Tageslimit / Wochenlimit / Öffnungen pro Tag / Pflicht-Pause** | ❌ **wirkungslos** | siehe §4 |
| Löschschutz (`denyAppRemoval`) | 🟡 | wird gesetzt *und* zurückgelesen (`diagnostics.store.denyAppRemoval`) — ehrlich gemeldet |

## 4. Warum die Limits nicht greifen (3 unabhängige Ursachen)

1. **Keine Nutzungsdaten.** `grep -rn "DeviceActivityReport|totalActivity" *.swift` → **0 Treffer**.
   Ohne `DeviceActivityReport`-Extension gibt es keine Sekunden pro App; `dailySeconds`,
   `weeklySeconds`, `opensPerDay`, `pauseSeconds` sind damit reine Zahlen in AsyncStorage
   (`pb-app-limits`) und haben keine Datenquelle.
2. **Kein Monitoring gestartet.** `grep -rn "DeviceActivityCenter|startMonitoring"` → Treffer
   **nur im Kommentar** von `DeviceActivityMonitorExtension.swift`. Niemand ruft
   `DeviceActivityCenter.startMonitoring(...)` auf → es gibt kein Intervall und kein Event,
   das feuern könnte.
3. **Die Monitor-Extension ist ein Platzhalter.** `DeviceActivityMonitorExtension.swift`
   shieldet hart `.socialNetworking` — unabhängig von Picker-Auswahl und Limit-JSON. Schlimmer:
   `intervalDidEnd` setzt `store.shield.applicationCategories = nil` und würde damit
   **Kategorie-Sperren der Haupt-App aufheben**. Das Target darf so nicht scharf geschaltet
   werden; es muss erst implementiert werden (Auswahl + Limits aus der App Group lesen).

## 5. Provisioning — die echte Blocker-Kette (ASC gemessen)

`GET /v1/bundleIds?filter[identifier]=com.meister.blockphone` liefert **nur**:

```
com.meister.blockphone                     (Blockphone)
com.meister.blockphone.PacketTunnelProvider
com.meister.blockphone.monitortest
```

→ Für `…ShieldConfiguration`, `…ShieldAction`, `…DeviceActivityMonitor` existieren
**keine Bundle-IDs**, also auch keine Profile. `credentials.json` kennt ebenfalls nur
zwei Targets (`Blockphone`, `PacketTunnelProvider`) — ein Build mit
`BLOCKPHONE_SHIELD_EXT=1` scheitert deshalb an der Signatur (genau dafür gibt es den
lokalen `ios/.targets/`-Rest mit ShieldAction/ShieldConfiguration vom 16.11. 21:33,
also aus dem gescheiterten Versuch).

Capabilities der vorhandenen IDs:

| Bundle-ID | Capabilities (ASC) |
|---|---|
| `com.meister.blockphone` | FAMILY_CONTROLS, **FAMILY_CONTROLS_DISTRIBUTION**, **APP_GROUPS**, PERSONAL_VPN, NETWORK_EXTENSIONS, PUSH_NOTIFICATIONS |
| `…PacketTunnelProvider` | NETWORK_EXTENSIONS, PERSONAL_VPN |
| `…monitortest` | nur IN_APP_PURCHASE (Family Controls **nicht** freigegeben) |

Profil-Beleg (`credentials/appstore_blockphone_140.mobileprovision`, Plist-Parsing):
`com.apple.developer.family-controls = true`, **`com.apple.security.application-groups` fehlt**.
Folge im Code: `ScreenTimeShieldModule.groupAvailable == false` → `diagnostics.storage == "standard"`.
Die Auswahl liegt damit in `UserDefaults.standard` der Haupt-App — für die Sperre selbst
ausreichend, für jede Extension-Kommunikation (Shield-Button, Monitor) **unbrauchbar**.

## 6. DNS-Blocker — der Teil, der wirklich hält

* Tunnel: Interface `10.8.0.1/32`, `includedRoutes` nur diese /32 → kein Full-Tunnel,
  restlicher Traffic läuft ungefiltert (kein IP-Leak-Risiko, aber auch kein IP-Blocking).
* `NEDNSSettings(servers: ["10.8.0.1"])` → alle System-DNS-Abfragen laufen durch den Filter.
* Blocklist kommt über `providerConfiguration` (`blocklist`, `allowlist`, `mode`, `ads`) →
  **unabhängig von der App Group** (bewusst; `BlocklistStore` ist nur Fallback und mit
  fehlender Gruppe aktuell immer `[]`).
* Werbe-Domains als Bundle-Ressource `targets/packettunnel/adblock.json` (41.293) statt in der
  VPN-Plist.
* Upstream: DoT an `1.1.1.1` (IP-Literal, SNI `cloudflare-dns.com`, Zertifikatsprüfung).
* Grenze (bekannt, `INTERNETBLOCKER-STUFEN.md`): reines DNS — eigene DoH-Resolver
  (Chrome „Secure DNS"), iCloud Private Relay und direkte IP-Aufrufe umgehen den Filter.

## 7. UI-Struktur (Build 148)

4 Tabs statt vorher 8 (`App.tsx`): `GLYPH`, `BROWSER`, `SPERREN` (Unter-Tabs `apps` | `domains`),
`SETUP` (Unter-Tabs `limits` | `zeit` | `commit` | `start`).
`components/AppBlocker.tsx` (776 Zeilen) ist der `SPERREN → APPS`-Screen: zwei unabhängige
Schalter (DNS-Werbeblocker / App-Sperre), FamilyControls-Autorisierung, System-Picker,
Pro-App-Limits, Wartezeit 0/12/24/48 h.

## 8. Reihenfolge, um „echtes Sperren" fertig zu machen

1. **Bundle-IDs anlegen** (`com.meister.blockphone.ShieldConfiguration`, `…ShieldAction`,
   `…DeviceActivityMonitor`) — per ASC-API möglich (`POST /v1/bundleIds`).
2. **Family Controls für diese IDs freigeben** — nur Portal/Antrag (API kann die Capability
   nicht setzen; `monitortest` zeigt: ohne Freigabe nur IN_APP_PURCHASE).
3. **App Group `group.com.meister.blockphone`** anlegen und beiden App-IDs zuweisen (Portal),
   dann Profile per API neu ziehen und per Plist prüfen (`application-groups` gefüllt,
   nicht leeres `<array/>`).
4. `credentials.json` um die Extension-Targets erweitern, CI mit
   `BLOCKPHONE_SHIELD_EXT=1` bauen (sonst bleibt der schöne Sperr-Screen toter Code).
5. **`ShieldActionExtension`: `secondaryButtonPressed` → `.defer` + URL-Scheme der App**
   (aktuell `.none` = Button tut nichts, der Nutzer landet wieder auf dem Shield).
6. `DeviceActivityMonitorExtension` neu schreiben (Auswahl+Limits aus App Group,
   `startMonitoring` in der Haupt-App, kein `applicationCategories = nil`) **und**
   eine `DeviceActivityReport`-Extension für den Verbrauch ergänzen — vorher die
   Limit-UI als „wartet auf Freigabe" kennzeichnen statt sie als aktiv zu zeigen.

Bis Schritt 4–6 abgeschlossen sind, gilt ehrlich: **Blockphone blockt heute Apps
(dauerhaft, systemweit) und DNS (Domains/Werbung) — aber es misst nichts und kann
deshalb keine Zeitlimits durchsetzen.**

---

# Umgesetzt am 2026-11-19 (nach der Analyse)

## A. Bundle-IDs angelegt (ASC-API, `scripts/asc-bundle-ids.mjs`)

```
+ com.meister.blockphone.ShieldConfiguration   id 6VW777YFD4
+ com.meister.blockphone.ShieldAction          id 85K6MP2HW4
+ com.meister.blockphone.DeviceActivityMonitor id 9D28ZC7J9L
```

Capability `APP_GROUPS` **konnte per API gesetzt werden** (alle drei).
Capability `FAMILY_CONTROLS` **nicht** — exakte API-Antwort:

```
409 ENTITY_ERROR.ATTRIBUTE.TYPE: 'FAMILY_CONTROLS' is not a valid value for the
attribute 'capabilityType'. Expected one of: ICLOUD, IN_APP_PURCHASE, APP_GROUPS,
PERSONAL_VPN, NETWORK_EXTENSIONS, … (FAMILY_CONTROLS fehlt in der Liste)
```

→ **Portal nötig** (identisch zum Stand in `FUNKTIONEN-ANALYSE.md` §6, jetzt mit Beleg):
1. Für die drei neuen IDs „Family Controls" beantragen/freigeben.
2. App Group `group.com.meister.blockphone` anlegen und **allen vier** App-IDs zuweisen
   (`com.meister.blockphone`, `…ShieldConfiguration`, `…ShieldAction`, `…DeviceActivityMonitor`).

## B. Code (fertig, kompiliert erst mit den Flags im CI-Job „Swift-Extensions kompilieren")

| Datei | Änderung |
|---|---|
| `modules/screentime-shield/ios/ScreenTimeShieldModule.swift` | **neu**: `startLimits`, `stopLimits`, `limitsStatus`, `unlockRequestedAt`; baut `DeviceActivityEvent`s (Event-Name `app<index>`, Schwelle = Sekunden), zwei Schedules (täglich 00:00–23:59, Woche Mo–So), eigener Store `blockphone.limits`, stoppt vor jedem Start die alten Activities (sonst bleiben entfernte Limits scharf) |
| `targets/deviceactivity/DeviceActivityMonitorExtension.swift` | **neu geschrieben** statt Platzhalter: liest `shieldSelection` + `appLimits` aus der App Group, shieldet beim Schwellen-Event genau den App-Token, leert beim Intervall-Wechsel **nur den eigenen Store** (vorher: `applicationCategories = nil` → hätte Master-Kategorie-Sperren aufgehoben) |
| `targets/shieldaction/ShieldActionExtension.swift` | „ENTSPERREN" → Merker `shieldUnlockRequestedAt` in die App Group + **`.defer`** (statt `.none`, das nichts tat); gilt für App, Webseite und Kategorie |
| `targets/shieldaction/expo-target.config.js` | App-Group-Entitlement ergänzt (Merker-Speicher) |
| `targets/shieldconfig/ShieldConfigurationExtension.swift` | Web-Domain-Shield bekommt ebenfalls „ENTSPERREN" |
| `lib/limitMonitor.ts` (+ Test) | Vertrag JS↔Swift: `[{index,dailySeconds,weeklySeconds}]`, Schwellen < 60 s verworfen, `pending`/`blocked` zählen nicht |
| `lib/appLimitsStore.ts` | nach jeder Regeländerung `startLimits(payload)` bzw. `stopLimits()` — ohne das feuert kein Limit |
| `shield/ScreenTimeShield.ts`, `modules/screentime-shield/index.ts` | Typen + Wrapper für die neuen Aufrufe |
| `.github/workflows/ios-build.yml` | Flags kommen jetzt aus Repo-Variablen (`vars.BLOCKPHONE_SHIELD_EXT`, `vars.BLOCKPHONE_DEVICE_ACTIVITY`, `vars.BLOCKPHONE_APP_GROUP`) — umschaltbar ohne Commit, Default bleibt grün |
| `.github/workflows/swift-compile-check.yml` | **neu**: prebuild mit allen Targets + `xcodebuild CODE_SIGNING_ALLOWED=NO` → Swift-Fehler fallen vor dem Release auf |

Gate danach: **200/200 Tests**, `tsc --noEmit` 0 Fehler, `check-targets` OK
(auch mit gesetzten Flags: „dieser Build zusätzlich: shieldconfig, shieldaction, deviceactivity").

## C. Was noch am Nutzer hängt

1. Portal: Family Controls für die drei IDs + App Group zuweisen (s. A).
2. Danach: `node scripts/asc-profiles.mjs`-Äquivalent für die neuen IDs
   (Profile erzeugen, `credentials.json` erweitern) und Repo-Variablen setzen → Build 149
   enthält dann den eigenen Sperr-Screen, den echten Entsperr-Button und die Limits.
3. Vor dem Scharfschalten der Limits ehrlich bleiben: `opensPerDay` und
   `pauseSeconds` haben weiterhin keine Datenquelle (dafür bräuchte es eine
   `DeviceActivityReport`-Extension); Tages-/Wochenlimit sind mit dieser Änderung gedeckt.


---

## Nachtrag 19.11.2026 — was jetzt wirklich gebaut ist (Build 149)

### CI, die Swift-Fehler vorher findet
`.github/workflows/swift-compile-check.yml` baut alle Targets mit
`CODE_SIGNING_ALLOWED=NO` und weist die entstandenen Bundles nach. Ohne diesen
Job fällt ein Swift-Fehler erst im ~30-Minuten-Release-Build auf (genau das war
Build 148: „kompilierte nicht“). Gemessener Lauf `44545377912`:

```
OK ShieldConfiguration.appex gebaut
OK ShieldAction.appex gebaut
OK DeviceActivityMonitor.appex gebaut
OK PacketTunnelProvider.appex gebaut
```

Wichtig für den Job: `runs-on: macos-latest` **und** die neueste Xcode wählen —
RN 0.86 zieht SPM-Pakete, die Swift-Tools 6.2 verlangen; mit dem
Standard-Xcode 16.4 (Swift 6.1) bricht schon die Paketauflösung ab
(`package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.1.0`).

### Drei echte API-Fehler, die dabei auffielen (alle behoben)
1. `ShieldConfigurationDataSource` und `ShieldActionDelegate` sind **Klassen**,
   keine Protokolle → `final class X: NSObject, ShieldConfigurationDataSource`
   ergibt `error: multiple inheritance from classes 'NSObject' and …`.
   Richtig: nur die Klasse beerben, Methoden mit `override`.
2. `ShieldActionDelegate.handle` nimmt **Token-Typen**
   (`ApplicationToken`, `WebDomainToken`, `ActivityCategoryToken`) — nicht
   `Application`/`WebDomain`. Vorher: „method does not override any method from
   its superclass“.
3. `DateComponents` Memberwise-Init ist **reihenfolgegebunden**:
   `DateComponents(hour: 0, minute: 0, weekday: 2)`, nicht `(weekday:…, hour:…)`.

### Zeitlimits: Tages- und Wochenlimit sind jetzt getrennt
Erste Fassung hätte beim Tageswechsel auch eine erreichte **Wochen**-Sperre
aufgehoben (beide Events hießen `app<index>`, und `intervalDidEnd` leerte alles).

Jetzt:
- Events heißen `d<index>` (Tageslimit) bzw. `w<index>` (Wochenlimit).
- Die Extension führt in der App Group die Merkliste `limitsShielded`
  (`{"3":["d","w"]}`) und setzt den Limit-Store bei jeder Änderung **exakt** auf
  diese Liste (`applyShields`), statt additiv zu sperren — aufgehobene Sperren
  verschwinden dadurch wirklich.
- `intervalDidEnd` für `blockphone.daily` entfernt nur die `d`-Einträge,
  für `blockphone.weekly` (und unbekannte Activities) alles.
- `clearLimitShield()` in der App leert zusätzlich die Merkliste, sonst stellt
  die Extension nach dem Entfernen aller Limits alte Sperren wieder her.

### Stand der Auslieferung
- Build **149** (ASC `VALID`) enthält weiterhin nur `packettunnel`: die drei
  Extension-Targets brauchen `com.apple.developer.family-controls` im Profil,
  das kann nur das Developer-Portal setzen (siehe
  `docs/PORTAL-SCHRITTE-EXTENSIONS.md`). `node scripts/asc-ext-profiles.mjs`
  liest die echten Entitlements aus den Profilen und zeigt die Lücke.
- Gate: `npm test` 200/200, `tsc --noEmit` 0 Fehler, `check-targets: OK`,
  Swift-Kompilier-Job grün.
