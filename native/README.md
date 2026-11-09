# Native Screen-Time-Sperre (FamilyControls + ManagedSettings)

Nachbau des Dull-Sperr-Screens für **Blockphone**. Diese Dateien sind **nativer Swift**
— in Expo (managed workflow) nicht direkt nutzbar, daher der Weg über `expo prebuild`.

## Was hier liegt

| Datei | Zweck |
|---|---|
| `ios/ScreenTimeManager.swift` | FamilyControls-Autorisierung + `ManagedSettingsStore.shield` + React-Bridge (`ScreenTime`-Modul) |
| `ios/ShieldConfigurationExtension/` | **Custom Sperr-Screen** (der Screen, der statt der App erscheint) |
| `ios/ShieldActionExtension/` | Button-Aktion auf dem Sperr-Screen |
| `ios/DeviceActivityMonitorExtension/` | Zeitpläne/Limits → automatisch re-shield |
| `../plugins/withScreenTimeShield.js` | Expo Config Plugin → setzt `com.apple.developer.family-controls` + App-Group |

## Flow

1. **Plugin registrieren** (in `app.json` → `plugins`):
   ```json
   "plugins": ["./plugins/withScreenTimeShield"]
   ```

2. **Prebuild** (erzeugt das native `ios/`-Projekt):
   ```bash
   npx expo prebuild --platform ios
   ```

3. **Swift-Dateien einbinden** (einmalig, danach überlebt es `prebuild` nicht — daher
   in `native/ios/` behalten und nach jedem Prebuild neu einbinden, oder einen
   eigenen Config-Plugin-Mod dafür schreiben):
   - `ScreenTimeManager.swift` → Haupt-Target
   - 3 Extension-Ordner als **App-Extension-Targets** in Xcode anlegen:
     * Target-Typ: `App Extension`
     * `Info.plist` aus dem jeweiligen Ordner verwenden (Punkt-Identifier + Principal-Class sind gesetzt)
     * `com.apple.developer.family-controls = true` + App-Group auf **jedes** Extension-Target
     * In „Build Phases → Embed App Extensions" des Haupt-Targets einbetten
   - Bundle-IDs der Extensions (Konvention):
     * `com.meister.blockphone.ShieldConfig`
     * `com.meister.blockphone.ShieldAction`
     * `com.meister.blockphone.DeviceActivityMonitor`

4. **Build via EAS** (Development Build, damit das native Modul geladen wird):
   ```bash
   eas build --profile development --platform ios
   ```

## Netzwerk-Ebene (DNS-Blocking, Ebene ② — Vorbild Freedom)

Zusätzlich zum Screen-Time-Shield gibt es den **DNS-Blocking-Tunnel**
(`PacketTunnelProvider` + `DnsFilter`). Das ist das funktionale Äquivalent zu
Freedoms `AGDnsProxy`-Layer: blockt Domains **systemweit** (jede App, nicht nur
Browser) über ein lokales Personal-VPN.

| Datei | Zweck |
|---|---|
| `ios/PacketTunnelProvider/PacketTunnelProvider.swift` | NEPacketTunnelProvider — /32-Route + NEDNSSettings auf 10.8.0.1 |
| `ios/PacketTunnelProvider/DnsFilter.swift` | Parst IPv4/UDP/DNS-Pakete, Suffix-Match + Upstream-Forwarding (1.1.1.1) |
| `ios/PacketTunnelProvider/BlocklistStore.swift` | Liest die Domain-Liste aus der App Group |
| `ios/PacketTunnelProvider/Info.plist` | NSExtension-Punkt `com.apple.networkextension.packet-tunnel` |
| `ios/VpnManager.swift` | NEVPNManager-Start/Stop + RN-Bridge (`@objc(VpnManager)`) |
| `ios/VpnManager.m` | registriert das Modul in der Bridge |
| `../plugins/withNetworkBlocker.js` | setzt `networkextension` + `vpn.api = allow-vpn` + App Group |

### Integration (Xcode, einmalig)

1. **Extension-Target anlegen**: Target-Typ `Network Extension` → `Packet Tunnel Provider`.
   - `Info.plist` aus `native/ios/PacketTunnelProvider/` verwenden
     (Punkt + Principal-Class sind gesetzt).
   - Die drei Swift-Dateien (`PacketTunnelProvider.swift`, `DnsFilter.swift`,
     `BlocklistStore.swift`) dem Target hinzufügen.
2. **Entitlements auf das Extension-Target**:
   - `com.apple.developer.networking.networkextension = true`
   - `com.apple.developer.networking.vpn.api = ["allow-vpn"]`
   - `com.apple.security.application-groups = group.com.meister.blockphone`
3. **Haupt-Target**: `VpnManager.swift` + `VpnManager.m` hinzufügen.
   In „Build Phases → Embed App Extensions" die `PacketTunnelProvider.appex` einbetten.
4. **Bundle-ID der Extension**: `com.meister.blockphone.PacketTunnelProvider`
   (muss zu `VpnService.extensionBundleId` passen).

### Blocklist-Format

Die Haupt-App schreibt `dns_blocklist.json` (JSON-Array von Domains) in die App
Group, die Extension liest sie beim Tunnel-Start. Suffix-Match: `instagram.com`
blockt auch `www.instagram.com`.

> **Target-Mitgliedschaft:** `BlocklistStore.swift` muss in **beide** Targets —
> Haupt-App (ruft `save`) UND Extension (ruft `load`). Beide teilen sich die
> App-Group `group.com.meister.blockphone`.

```ts
import { setDnsBlocklist } from "../lib/vpn";
await setDnsBlocklist(["instagram.com", "tiktok.com", "x.com"]);
```

### JS/TS-Seite (nach dem Build)

```ts
import { startDnsBlocking, stopDnsBlocking, dnsBlockingStatus } from "../lib/vpn";

await startDnsBlocking();            // VPN-Hinweis → Tunnel an
const { connected } = await dnsBlockingStatus();
await stopDnsBlocking();             // Tunnel aus
```

> **Hinweis:** Beim ersten `startVPNTunnel()` zeigt iOS den System-Dialog
> „Blockphone Blocker möchte VPN-Konfigurationen hinzufügen" — das ist normal
> und entspricht Freedoms „allow-vpn"-Personal-VPN.

---

## JS/TS-Seite (nach dem Build)

```ts
import { NativeModules } from "react-native";
const { ScreenTime } = NativeModules;

await ScreenTime.authorize();       // FamilyControls-Dialog
await ScreenTime.shieldAllSocial(); // alle Social-Apps sperren
await ScreenTime.unshield();        // freigeben
const { authorized } = await ScreenTime.status();
```

## Warum nur nativ

`FamilyControls`, `ManagedSettings`, `DeviceActivity` sind **Apple-System-APIs**
(iOS 16+) und existieren nur als Swift/ObjC. Expo managed kann sie nicht erreichen
— der Shield-/Sperr-Screen wird vom System gerendert, nicht von der App.

## Screens (Vorbild Dull, monochrom)

- **Titel**: „LESS. PLEASE COME AGAIN."
- **Untertitel**: „Diese App ist gesperrt. Nichts verpasst."
- Primär-Button „OK" (weiß auf schwarz), Sekundär „ENTSPERREN".
- Icon: `minus.circle.fill` (monochrom).

## Referenz
- Dull v1.9.3: `DullShieldConfig.ShieldConfigurationProvider`, `DullShieldAction.ShieldActionHandler`,
  `DullDeviceActivityMonitor.ScheduledAccessMonitor` (aus `/opt/ios-re/dull/` extrahiert).
- Apple Docs: FamilyControls, ManagedSettings, DeviceActivity (Screen Time API).
