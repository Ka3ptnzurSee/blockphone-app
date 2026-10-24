# Nothing OS → iOS Design-System (Reverse-Engineering-Target)

Ziel: die Nothing-Ästhetik (monochrome, Dot-Matrix, Glyph) als Design-System für die
iOS-App „PhoneBlock+" klonen. Diese Tokens stammen aus öffentlich dokumentierten
Nothing-OS-Design-Fakten und sind der „Was müssen wir extrahieren/klonen"-Katalog.

## 1. Farbpalette — strikt monochrom

| Token | Hex | Rolle |
|---|---|---|
| `--bg` | `#000000` | App-Hintergrund (tiefes Schwarz) |
| `--surface` | `#141414` | Karten/Panels |
| `--surface-2` | `#1f1f1f` | erhöhte Flächen |
| `--border` | `#2a2a2a` | Linien/Divider |
| `--text` | `#ffffff` | Primärtext |
| `--text-2` | `#8a8a8a` | Sekundärtext |
| `--text-3` | `#5a5a5a` | deaktiviert |
| `--dot` | `#ffffff` | Dot-Matrix-Punkte (aktiv) |
| `--dot-off` | `#3a3a3a` | Dot-Matrix-Punkte (inaktiv) |

**Regel:** KEINE Farbakzente, KEINE Gradienten, KEINE farbigen Schatten.
Einzige „Farbe" = Weiß auf Schwarz. Erfolg/Fehler nur als Text/Icon-Zustand.

## 2. Typografie — Dot-Matrix (echte Fonts extrahiert ✅)

Per Reverse Engineering aus der Nothing-Launcher-APK extrahiert (`/opt/apps/nothing-re/`),
liegen jetzt in `assets/fonts/`:

| Font-Datei | Echter Name | Copyright | Rolle |
|---|---|---|---|
| `ndot57.otf` | **Ndot 57** | © Nothing | Dot-Matrix (Ziffern, Uhr, Status) |
| `ndot.otf` | **Ndot 55** | © Nothing | Dot-Matrix (ältere/feinere Variante) |
| `lettera_mono_ll_regular.otf` | **Lettera Mono LL** (Lineto) | Lineto/Kobi Benezri | Fließtext-Grotesk |
| `lettera_mono_ll_light.otf` | Lettera Mono LL Light | Lineto | Fließtext light |

- **Dot-Matrix-Font** = NDot 57 (Punkt-Raster) für Ziffern/Uhr/Status.
- **Fließtext (Launcher, alt)** = Lettera Mono LL (Lineto).
- **Fließtext (Nothing X, aktuell)** = **NType 82** (© Nothing, Colophon Foundry) — die
  eigentliche Nothing-Text-Font. Die ursprüngliche „NType"-Annahme war DOCH korrekt;
  nur die alte Launcher-APK (v1.0.2) nutzte Lettera Mono.
- **UI-Sans (Nothing X)** = **Space Grotesk** (Bold/Medium/SemiBold, SIL OFL — frei nutzbar).
- **Dot-Matrix** = Ndot 55 + Ndot 57 (je als „UpAndLow"-Variante mit Kleinbuchstaben).

### ⚠️ Font-Lizenz
- `NType82` + `Ndot` = **Nothing-exklusiv** („solely on Nothing brand materials", Colophon
  Foundry) → NICHT für die Veröffentlichung einer eigenen App nutzbar, nur Research.
- `Space Grotesk` = **SIL OFL** → frei, auch kommerziell — für die Blockphone-App geeignet.
- `Lettera Mono LL` = Lineto (kommerziell lizenziert).

- **Grundraster:** 4-px-Basis; Abstände 4/8/12/16/24/32/48. Viel Negativraum.

## 3. Glyph Interface — das Leucht-Motiv

- LED-Streifen (rückseitig am Phone) als **UI-Motiv** übernehmen:
  - Glyph-Segmente (Kurven/Winkel) als SVG/Canvas, weiß auf schwarz.
  - **Animationen:** Pulse, Lauflicht, „Atmen", Segment-für-Segment-Aufleuchten.
  - Auf iOS: `react-native-reanimated` + `react-native-skia` (oder einfache
    Opacity/Scale-Animationen) — kein echtes LED, aber der Look.
- Typische Glyph-Pattern: Anruf = gleichmäßiges Pulsieren, Benachrichtigung =
  einzelner Blitz, Laden = progressives Auffüllen.

## 4. Layout / Komponenten

- **Flache UI:** keine Drop-Shadows, keine Border-Radius > 16px (Pill = 999 nur
  für Chips/Buttons).
- **App-Icons monochrome:** alle Icons schwarz-weiß (Linien, gefüllt), kein Bunt.
- **Listen** = reine Linien-Trenner, kein Card-Look.
- **Header** = kleine Dot-Matrix-Ziffern/Status statt bunter Logos.
- **Leere Zustände** = ein einzelner Dot-Matrix-Punkt / Glyph-Segment.

## 5. Was wir per Reverse Engineering extrahieren wollen

| Quelle | Tool | Was wir holen |
|---|---|---|
| **Nothing X App (iOS)** im App Store | `ipatool` (installieren) → IPA entpacken | echte `.ttf/.otf`-Fonts (NDot/NType), Farb-/Asset-Tokens, Animations-Parameter |
| **Nothing Launcher (Android APK)** | `apktool` (✅ vorhanden) | Icon-Pack, Dot-Font, Layout-Dimensionen, Wallpaper |
| Fonts in IPA/APK | `radare2`/Ghidra (✅ vorhanden) | Font-Metriken, Glyph-Animationen (falls nativ) |

## Status

- [x] **Nothing Launcher APK geladen + dekompiliert** (`apkeep` via APKPure → `apktool`)
  → `/opt/apps/nothing-re/decompiled/`, base `com.nothing.launcher.apk` (v1.0.2, targetSDK 31)
- [x] **Fonts extrahiert** → `assets/fonts/` (ndot57, ndot, lettera_mono_ll_regular/light)
- [x] **Nothing X IPA gezogen** (v3.10.1, 253 MB, `ipatool` + 2FA-Login `--keychain-passphrase`)
  → `/opt/apps/nothing-re/extracted-ios/` (Flutter-App `Runner.app`); Fonts → `assets/fonts/`
- [ ] Farb-/Token-Palette als `theme.ts` übernehmen (monochrome Werte aus `colors.xml` liegen vor)
- [ ] Glyph-Motiv als Komponente bauen (Skia/Reanimated)

### Extrahiert (Quelle: res/values/colors.xml)

- `fake_wallpaper_color_dark_mode` = `#ff000000`, `_light_mode` = `#fff9f9f9`
- `folder_background_dark` = `#ff2b2d2f`, `folder_background_light` = `#fff0f2f2`
- `folder_text_color_dark` = `#ff06080a`, `folder_dot_color_active` = `#ff06080a`
- Monochromer Icon-Look: Icons werden per Code auf Schwarz/Weiß reduziert (monochrome
  Icon-Engine im Launcher), nicht per Farbpalette.
