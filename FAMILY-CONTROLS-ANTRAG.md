# Family Controls — Apple-Freigabe beantragen (Shield-Teil)

Das Screen-Time-Entitlement `com.apple.developer.family-controls` ist ein **gated
Entitlement** — Apple muss es **manuell für dein Team freigeben**, bevor es in
Provisioning-Profilen verfügbar ist. Ohne Freigabe schlägt jeder Shield-Build fehl.

**Apple-Referenz (offiziell):**
> „Before submitting your app to the App Store, you must
> [request permission](https://developer.apple.com/contact/request/family-controls-distribution)
> to use the entitlement."

## 1. Antrag einreichen (muss von DIR mit Apple-Login gemacht werden)

**Link:** https://developer.apple.com/contact/request/family-controls-distribution

**Daten, die du eingibst:**

| Feld | Wert |
|---|---|
| App-Name | PhoneBlock+ |
| Bundle-ID | `com.meister.blockphone` |
| Team-ID | `VW2SBC8228` |
| Rolle | App Manager / Account Holder |

**Use-Case-Text (copy-paste, Englisch):**

> **App name:** PhoneBlock+
> **Bundle ID:** com.meister.blockphone
> **Team ID:** VW2SBC8228
>
> **Use case:**
> PhoneBlock+ is a screen time management and focus app that helps users reduce
> mindless scrolling by blocking distracting social media applications and features.
>
> The app uses Family Controls to:
> 1. Shield (block) social media applications via `ManagedSettingsStore.shield.applications`,
>    letting users temporarily lock themselves out of distracting apps.
> 2. Monitor device activity via `DeviceActivityMonitor` to enforce schedules and daily
>    usage limits (e.g. "block after 22:00" or "block after 30 min/day").
> 3. Show a custom `ShieldConfiguration` screen when a blocked app is opened.
> 4. Provide a built-in browser (WKWebView) that loads the web versions of social
>    platforms with distracting feeds (Reels, Shorts, ads) removed.
>
> The app requests authorization for `.individual` (self-control) only, not `.child`,
> so users block their own apps — not children's devices.

## 2. Nach der Freigabe (dann mache ICH weiter)

1. Entitlement ist freigeschaltet → `com.apple.developer.family-controls` verfügbar.
2. `plugins/withScreenTimeShield.js` wieder in `app.json` registrieren.
3. Config-Plugin schreiben, das die 3 Extension-Targets (ShieldConfig/ShieldAction/
   DeviceActivityMonitor) automatisch ins Xcode-Projekt hängt (damit EAS Cloud sie baut).
4. Rebuild → TestFlight mit vollem Shield.

Der Swift-Code liegt fertig in `targets/` (Quelle der Wahrheit) bzw. `modules/`:
- `modules/screentime-shield/ios/ScreenTimeShieldModule.swift` (Autorisierung + Shield + Bridge)
- `targets/shieldconfig/ShieldConfigurationExtension.swift` (Sperr-Screen)
- `targets/shieldaction/ShieldActionExtension.swift` (Button)
- `targets/deviceactivity/DeviceActivityMonitorExtension.swift` (Monitoring)

Gebaut werden shieldconfig/shieldaction/deviceactivity nur mit
`BLOCKPHONE_SHIELD_EXT=1` / `BLOCKPHONE_DEVICE_ACTIVITY=1` — siehe
`docs/NATIVE-STRUKTUR.md`.
