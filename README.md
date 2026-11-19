# Blockphone (`apps/internetblocker`)

iOS-App (Expo/React Native) gegen Internet-/App-Sucht: DNS-/Werbe-Blocker per Network Extension **und** App-Sperre per ScreenTime/ManagedSettings.

> Automatisch erzeugt 2026-11-16 von `scripts/opt-map.sh --stub`, danach mit gemessenen Fakten ergänzt.

- **Kategorie:** `apps` · **Pfad:** `/opt/apps/internetblocker`
- **Größe:** 708 M (davon `node_modules` 644 M — regenerierbar)
- **Bundle:** `com.meister.blockphone` · **Team:** `VW2SBC8228` · **ASC-App:** `6826450166` · **EAS:** `4e8daa80-37af-44e6-a4d2-8fd61001c6f0`
- **Auslieferung:** EAS-Build → TestFlight, interne Gruppe „PER"

## Zweck
Zwei unabhängige Blocker in einer App:
1. **DNS-Tunnel** (`targets/packettunnel`, `lib/dnsSettings.ts` → `lib/vpn.ts` → `VpnManagerModule`): 41.293 Werbe-/Tracker-Domains aus `targets/packettunnel/adblock.json` (erzeugt von `scripts/build-adblocklist.mjs`).
2. **App-Sperre** (`modules/screentime-shield`, ManagedSettingsStore): App-Kategorien/Domains sperren, Pro-App-Limits mit Antragssystem (Delay 12/24/48 h, PIN), Zeitlimits (daily/weekly/opensPerDay/pause — Durchsetzung im Hintergrund braucht DeviceActivityMonitor).

## Struktur
| Pfad | Rolle |
|---|---|
| `App.tsx`, `index.ts` | UI + Einstieg (globaler Crash-Handler in `lib/crashHandler.ts`) |
| `lib/` | ~6 k TS-Zeilen: `dnsSettings`, `vpn`, `appLimits`, `store`, `secureStore`, `playlists` |
| `modules/{vpn-manager,screentime-shield}/` | native Bridges (Swift/ObjC) |
| `targets/` | **einzige Quelle** für Swift-Extensions (`packettunnel` immer, `shieldconfig`/`shieldaction` mit `BLOCKPHONE_SHIELD_EXT=1`, `deviceactivity` mit `BLOCKPHONE_DEVICE_ACTIVITY=1`) |
| `plugins/withAppleTargets.js` | Wrapper um `@bacons/apple-targets`, Target-Auswahl per Env-Flag |
| `scripts/check-targets.mjs` | Pre-Build-Gate (fehlendes Flag-Ziel = harter Fehler) |
| `ios/` | **generiert** (CNG, gitignored) — nie von Hand editieren |
| `docs/` | `NATIVE-STRUKTUR.md`, `BACKEND-CONVEX.md`; Analysen im Root (`FUNKTIONEN-ANALYSE.md`, `FILTER-DEEP-DIVE.md`, …) |

## Start / Deploy
```bash
npm test && npx tsc --noEmit          # Gate
node scripts/check-targets.mjs        # Target-Matrix prüfen
npx expo prebuild -p ios --clean --no-install
eas build -p ios --profile production --local     # + BLOCKPHONE_SHIELD_EXT=1 … wenn Capabilities provisioniert
```

## Daten & Backup
Alles gerätelokal (AsyncStorage/Keychain); Server-Backend (Convex) ist vorhanden, aber **nicht deployt** (`EXPO_PUBLIC_CONVEX_URL` unset) → `docs/BACKEND-CONVEX.md`. Kein Backup nötig; Credentials in `credentials/` (gitignored) + `keysafe/store/apple/`.

## Offene Punkte
- [ ] Apple-Portal: App-IDs für `.ShieldConfiguration`, `.ShieldAction`, `.DeviceActivityMonitor` + Family-Controls/App-Group → erst dann Flag-Builds.
- [ ] Convex deployen (`npx convex dev --once`, dann `npm run convex:deploy`).
- [ ] Zeitlimits im Hintergrund durchsetzen (DeviceActivityMonitor-Extension).
