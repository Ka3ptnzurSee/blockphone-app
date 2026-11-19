# Portal-Schritte: Blockphone-Extensions scharf machen

Stand: 19.11.2026. Alles, was **ohne** Apple-Portal geht, ist erledigt und bewiesen
(Swift kompiliert, CI grün, JS 200/200 Tests, tsc 0). Was hier steht, kann die
App-Store-Connect-API **nicht** — es sind Klicks im Developer-Portal.

Messbasis (`node scripts/asc-ext-profiles.mjs`):

| Ziel | Profil | family-controls | App-Groups |
|---|---|---|---|
| com.meister.blockphone | Blockphone AppStore 140 | **JA** | `[]` (leer) |
| com.meister.blockphone.ShieldConfiguration | Blockphone ShieldConfiguration | NEIN | `[]` |
| com.meister.blockphone.ShieldAction | Blockphone ShieldAction | NEIN | `[]` |
| com.meister.blockphone.DeviceActivityMonitor | Blockphone DeviceActivityMonitor | NEIN | `[]` |

Die API lehnt `FAMILY_CONTROLS` als capabilityType ab:
`409 ENTITY_ERROR.ATTRIBUTE.TYPE … Expected one of: ICLOUD, IN_APP_PURCHASE, GAME_CENTER,
PUSH_NOTIFICATIONS, … APP_GROUPS, …` — Family Controls fehlt in dieser Liste.
`APP_GROUPS` ließ sich setzen, aber ohne zugewiesene Gruppe bleibt das Array leer.

---

## 1. Family Controls für 3 App-IDs freigeben (5 Minuten)

<https://developer.apple.com/account/resources/identifiers/list>

Für jede dieser drei IDs: Eintrag öffnen → Checkbox **Family Controls** anhaken →
Save:

- `com.meister.blockphone.ShieldConfiguration`
- `com.meister.blockphone.ShieldAction`
- `com.meister.blockphone.DeviceActivityMonitor`

(Sie wurden am 19.11. per API angelegt: `6VW777YFD4`, `85K6MP2HW4`, `9D28ZC7J9L`.
„App Groups“ ist dort schon gesetzt.)

## 2. App Group anlegen und zuweisen (3 Minuten)

<https://developer.apple.com/account/resources/identifiers/list/appGroup>

1. **+** → App Groups → Identifier `group.com.meister.blockphone`, Description z. B.
   „Blockphone Shared“ → Continue → Register.
2. Diese Gruppe bei **allen vier** App-IDs anhaken (Configure → Checkbox → Continue):
   `com.meister.blockphone`, `…ShieldConfiguration`, `…ShieldAction`,
   `…DeviceActivityMonitor`.

Warum die Gruppe zählt: `ScreenTimeShieldModule` meldet aktuell `storage: "standard"`,
weil das Profil `appstore_blockphone_140` keine Gruppe enthält. Auswahl und Limits
liegen damit in `UserDefaults.standard`; die Extensions (Sperr-Screen-Button,
DeviceActivityMonitor) kommen nicht daran. Der DNS-Blocker ist davon **nicht**
betroffen — er bekommt seine Listen über `providerConfiguration`.

## 3. Profile neu erzeugen (1 Befehl)

```bash
cd /opt/apps/internetblocker
node scripts/asc-ext-profiles.mjs --recreate --out credentials
```

Erwartete Ausgabe: bei allen vier Zielen `family-controls = JA` und in der
App-Group-Spalte `group.com.meister.blockphone`. Solange dort `NEIN`/`—` steht,
ist der Portal-Schritt noch nicht durch (Profile backen Entitlements beim
Erzeugen ein — alte Profile bleiben auch nach dem Klick „falsch“).

## 4. Signieren erlauben

- `credentials.json` um die drei Targets erweitern (Namen = **Xcode-Targetnamen**:
  `ShieldConfiguration`, `ShieldAction`, `DeviceActivityMonitor`), Profile wie in
  Schritt 3 erzeugt; alternativ `node scripts/sync-ios-credentials.mjs`, falls das
  Paket im Repo liegt.
- Repo-Variablen setzen (GitHub → Settings → Variables):

```bash
gh variable set BLOCKPHONE_SHIELD_EXT --body 1
gh variable set BLOCKPHONE_DEVICE_ACTIVITY --body 1
gh variable set BLOCKPHONE_APP_GROUP --body 1
```

Ohne diese Variablen baut CI weiter nur `packettunnel` (Build 149 = aktueller,
sicherer Zustand: DNS-Blocker + Master-Shield, keine Extensions).

## 5. Danach beweisen

1. `gh run list -L 2` → „Swift-Extensions kompilieren“ grün, und im Schritt
   „Extensions im Build nachweisen“ steht `OK ShieldConfiguration.appex gebaut` usw.
2. Neuer Build läuft durch; im CI-Log erscheint
   `· dieser Build zusätzlich: shieldconfig, shieldaction, deviceactivity`.
3. Auf dem Gerät: Sperr-Screen zeigt den eigenen schwarzen Screen mit
   **ENTSPERREN**; Tippen darauf führt in die App und zeigt
   „Entsperr-Wunsch vom Sperr-Screen — unten Sperre lösen (PIN)“.
4. Limit setzen (z. B. 1 Minute), App benutzen → nach Ablauf sperrt die Extension
   die App. `limitsStatus` in der App muss die laufenden Activities nennen.

## Was ohne diese Schritte schon funktioniert (Build 148/149)

- Master-Shield über `ManagedSettings` (Kategorien, Web-Domains, pro-App-Token).
- DNS-Blocker: `packettunnel` mit `adblock.json` (41.293 Domains, 845 KB), DoT
  upstream `1.1.1.1` mit SNI `cloudflare-dns.com`, Modus „Internet aus“ mit Allowlist.
- Limits-UI speichert Regeln; die Regeln werden ab jetzt zusätzlich als
  DeviceActivity-Payload aufgerufen (`startLimits`) — die Wirkung tritt erst ein,
  wenn die Monitor-Extension im Build ist.
