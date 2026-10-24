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
