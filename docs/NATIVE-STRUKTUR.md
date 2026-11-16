# Native Struktur (Apple-Targets) — Blockphone

**Eine Quelle der Wahrheit: `targets/`.** Es gibt **keine** zweite Kopie nativen
Swift-Codes mehr (die alte `native/ios/`-Sammlung ist am 16.11.2026 entfernt
worden — sie war gegenüber `targets/` auseinandergelaufen und wurde nie gebaut).

`ios/` ist CNG-Ausgabe (`gitignored`) und wird von `expo prebuild` erzeugt —
niemals von Hand ändern.

## Target-Matrix

| Ordner | `type` | Bundle-ID | Extension-Point | Wann gebaut |
|---|---|---|---|---|
| `targets/packettunnel` | `network-packet-tunnel` | `com.meister.blockphone.PacketTunnelProvider` | `com.apple.networkextension.packet-tunnel` | **immer** |
| `targets/shieldconfig` | `shield-config` | `…blockphone.ShieldConfiguration` | `com.apple.ManagedSettingsUI.shield-configuration-service` | `BLOCKPHONE_SHIELD_EXT=1` |
| `targets/shieldaction` | `shield-action` | `…blockphone.ShieldAction` | `com.apple.ManagedSettings.shield-action-service` | `BLOCKPHONE_SHIELD_EXT=1` |
| `targets/deviceactivity` | `device-activity-monitor` | `…blockphone.DeviceActivityMonitor` | `com.apple.deviceactivity.monitor-extension` | `BLOCKPHONE_DEVICE_ACTIVITY=1` |

Die Auswahl macht `plugins/withAppleTargets.js` (Wrapper um
`@bacons/apple-targets`, setzt `match`). Ohne Filter würde **jeder** Ordner in
`targets/` gebaut — auch einer, dessen Entitlement Apple noch nicht freigegeben
hat, und der Build bricht beim Signieren ab.

## Was in der App läuft

```
App (React Native)
 ├─ modules/vpn-manager (VpnManagerModule.swift)
 │    start(blocklist, allowlist, mode, ads) ──> NETunnelProviderProtocol
 │    → providerConfiguration = { blocklist, allowlist?, mode, ads }
 │
 ├─ targets/packettunnel (EIGENER Prozess, .appex)
 │    PacketTunnelProvider.swift  → liest providerConfiguration
 │    DnsFilter.swift             → DoT 1.1.1.1:853 (+ UDP-53-Fallback),
 │                                  Suffix-Match gegen Blocklist/Allowlist
 │    BlocklistStore.swift        → App-Group-Datei `dns_blocklist.json`
 │                                  (Fallback, wenn kein providerConfiguration)
 │
 ├─ modules/screentime-shield (ScreenTimeShieldModule.swift, in-process)
 │    ManagedSettingsStore.shield.applications / .applicationCategories / .webDomains
 │
 ├─ targets/shieldconfig + targets/shieldaction (optional)
 │    eigener Sperr-Screen + Buttons statt iOS-Standard
 │
 └─ targets/deviceactivity (optional)
      intervalDidStart / intervalDidEnd / eventDidReachThreshold
      → ShieldStorage.apply() liest `screenTime.shield.selection` aus der App Group
```

## Prinzipal-Klassen (häufigste Fehlerquelle)

`@bacons/apple-targets` schreibt den Namen selbst in die generierte `Info.plist`.
Die Swift-Klasse **muss** exakt so heißen, sonst startet die Extension nicht:

| Target | erwartete Klasse |
|---|---|
| `packettunnel` | `PacketTunnelProvider` |
| `shieldconfig` | `ShieldConfigurationExtension` |
| `shieldaction` | `ShieldActionExtension` |
| `deviceactivity` | `DeviceActivityMonitorExtension` |

Prüfen ohne Mac: `npm run targets:check` (Exit 1 bei Abweichung).

## Warum zwei der drei Extensions standardmäßig aus sind

Jede Extension ist eine eigene Bundle-ID → eigenes App-ID + eigenes
Provisioning-Profil. `com.apple.developer.family-controls` lässt sich per
App-Store-Connect-API **nicht** freischalten (kein gültiger `capabilityType`,
verifiziert 15.11.2026) — das muss im Developer-Portal passieren.

Ablauf zum Einschalten:

1. Portal → Identifiers → neue App-ID `com.meister.blockphone.ShieldConfiguration`
   (bzw. `ShieldAction`, `DeviceActivityMonitor`) → Capability **Family Controls**.
2. Für `DeviceActivityMonitor` zusätzlich **App Groups** →
   `group.com.meister.blockphone` (und dieselbe Gruppe bei der Haupt-App).
3. Profil neu erzeugen / `eas credentials` aktualisieren.
4. Build mit Flag starten:
   ```bash
   BLOCKPHONE_SHIELD_EXT=1 eas build -p ios --profile production --local
   BLOCKPHONE_DEVICE_ACTIVITY=1 eas build -p ios --profile production --local
   ```
5. `npm run targets:check` vorher muss OK sein.

Ohne Flag: exakt der Stand, der als Build 148 in TestFlight liegt (nur
`PacketTunnelProvider` + In-Process-ScreenTime-Modul).

## App Group

`group.com.meister.blockphone` steht **nur** in den Entitlements, wenn

- `APP_GROUP=1`, oder
- `BLOCKPHONE_DEVICE_ACTIVITY=1` (dieses Target braucht sie zwingend).

Grund: ein Entitlement, das im Profil fehlt, lässt das Signieren scheitern
(`provisioning profile doesn't include entitlement`).
