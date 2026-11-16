# RE-Transfer: Dull + one sec → PhoneBlock+

Konsolidierte Übertragbarkeit der zwei reverse-engineerten Ziel-Apps auf den
PhoneBlock+-Klon (`com.meister.blockphone`, Repo `/opt/apps/internetblocker`).
Quellen: `/opt/ios-re/dull/REPORT.md`, `/opt/ios-re/onesec/REPORT.md`,
`FILTER-DEEP-DIVE.md`, `SCREENTIME-ANALYSE.md`, `FAMILY-CONTROLS-ANTRAG.md`.

## Die drei Block-Hebel (verifiziert an beiden Apps)

| Hebel | Dull | one sec | PhoneBlock+ Status |
|---|---|---|---|
| ① Feed-Filter (WKWebView) | ✅ `Filters/*` | ✅ Safari-Extension | ✅ **fertig** (`lib/browser.ts`, `lib/filters.generated.ts`) |
| ② Screen-Time-Shield (FamilyControls) | ✅ ShieldConfig/Action/DeviceActivity | ✅ + DeviceActivityReport | ⚠️ Code fertig (`targets/`), Target per Flag aus bis Apple-Freigabe |
| ③ Intervention (Pflichtaufgabe) | — | ✅ Atmung/Mathe/… | 🆕 **zu bauen** (dieser Doc) |
| ➕ Focus-Filter | — | ✅ `OneSecFocusFilter` | 🔲 optional, **kein** Apple-Antrag nötig |
| ➕ PIN + Streak | ✅ 4-PIN + „DAYS ON YOUR TERMS" | ✅ | ✅ **fertig** (`components/PinGate.tsx`, `lib/streak.ts`) |

## Was „Intervention" konkret heißt (one sec)

Vor dem Öffnen der Ziel-App erzwingt one sec eine bewusste Unterbrechung. Die
übertragbaren Modi (aus `Localizable.strings` de + .nib):

- **Atmung**: Welle (Bauch→Zwerchfell→Brust), 4-7-8, Box 4-4-4-4
- **Mathe**: Rechenaufgabe als Friction
- **Zeit anfordern**: Nutzer setzt eigenes Limit für die Ziel-App
- **Journaling** / **Random Text** / **WebView-URL**
- **Physisch**: „Touch Grass" (ML-Modell `GrassDetectorModel.mlmodelc`) + NFC-Tag
- **Re-Intervention**: Ziel-App x Minuten ohne erneute Intervention wieder öffnen
  (der eigentliche Anti-Reels-Hebel)

## Konkrete Snippets

### a) FamilyControls-Shield (im Build: `modules/screentime-shield/ios/ScreenTimeShieldModule.swift`)

```swift
import FamilyControls
import ManagedSettings

let store = ManagedSettingsStore()
let center = AuthorizationCenter.shared

func requestAndShield(_ selection: FamilyActivitySelection) async throws {
  try await center.requestAuthorization(for: .individual) // NICHT .child
  store.shield.applications = selection.applicationTokens
  store.shield.applicationCategories = .all()
}
```

### b) Intervention-Gate (RN, an die Stelle vor dem Entsperren)

```tsx
// Pseudocode — baut auf PinGate.tsx auf. "Intervention" ersetzt den bloßen PIN.
function UnlockFlow({ onUnlock }: { onUnlock: () => void }) {
  const [step, setStep] = useState<"intervention" | "pin">("intervention");
  // Intervention = Atmung/Math/Zeit-anfordern, danach PIN (PinGate), dann onUnlock.
  return step === "intervention"
    ? <Breathing onDone={() => setStep("pin")} />
    : <PinGate onUnlock={onUnlock} />;
}
```

### c) Re-Intervention-Fenster (Konfig-Flag)

```ts
// lib/streakStore.ts ergänzen: letzter Unlock-Zeitpunkt + Fenster.
const RE_WINDOW_MS = 10 * 60_000; // "x Minuten ohne erneute Intervention"
export async function withinReInterventionWindow(): Promise<boolean> {
  const last = Number(await AsyncStorage.getItem("pb-last-unlock") || 0);
  return Date.now() - last < RE_WINDOW_MS;
}
```

### d) Focus-Filter (kein Apple-Antrag, im Gegensatz zu FamilyControls)

`OneSecFocusFilter.appex` zeigt: ein Focus-Filter-Target erlaubt „App komplett
blocken oder Interventionsdauer je Fokus verlängern" über die öffentliche
`FocusFilterIntent`/`SetFocusFilterIntent`-API. Als drittes Layer zusätzlich zum
Shield — öffentlich verfügbar, kein Freigabe-Antrag.

## Monetarisierung (beide Apps konsistent)

Beide setzen auf **Lifetime statt Abo** (NonConsumable):

| App | Produkt | Preis |
|---|---|---|
| Dull | Dull Pro (Lifetime) | — |
| one sec | `onesec.lifetime.individual` | 99,99 $ |
| one sec | `onesec.lifetime` (Family) | 149,00 $ |

→ PhoneBlock+-Entscheidung (RevenueCat Lifetime) bestätigt.

## Freedom & SocialLite (25.10.2026) — zwei weitere Ebenen

| App | Konzept | Für PhoneBlock+ |
|---|---|---|
| **Freedom** (`to.freedom.FreedomBlocker`, Flutter) | 3 Ebenen: FamilyControls-Shield **+ PacketTunnel/VPN + AdGuard-DNS-Proxy (AGDnsProxy)** + Safari-ContentBlocker; Sessions mit Warnzeit | **DNS/VPN-Layer = echter App-Blocker** (blockt jede App/Website, nicht nur ausgewählte). `AGDnsProxy` ist Open-Source (AdGuard) |
| **SocialLite** (`social.Social-lite`, Swift) | **Block the real app** (Shield) + entschärfter WKWebView + Tageslimits + Werbeblocker + **On-Device-LLM (FoundationModels)** + 7-Tage-Chart | **Tagesration pro App** („%@/day", „resets at midnight"), zeitbasiertes Freischalten, Fokuszeit-Streak, DeviceActivityReport |

Reports: `/opt/ios-re/to_freedom_FreedomBlocker/REPORT.md`, `/opt/ios-re/social_Social-lite/REPORT.md`.

## Nächste Schritte (Priorität)

1. **DNS/VPN-Layer (Freedom-Muster)**: `PacketTunnelProvider` + AdGuard `AGDnsProxy` — der
   größte Hebel für echtes App-Blocking, mächtiger als FamilyControls allein.
2. **Tagesration + zeitbasiertes Freischalten (SocialLite-Muster)**: „%@/day", „%@ left",
   „resets at midnight" als Limit-Engine vor den bestehenden Streak schalten.
3. **Intervention-Engine** (one sec: Atmung + „Zeit anfordern") vor das PIN-Gate.
4. **Apple-Familienfreigabe** abwarten (siehe `FAMILY-CONTROLS-ANTRAG.md`) → Shield live.
5. Optional: **On-Device-LLM** (`FoundationModels`) als Fokus-Coach, **ContentBlocker**
   (Safari) als zweites Web-Layer.
