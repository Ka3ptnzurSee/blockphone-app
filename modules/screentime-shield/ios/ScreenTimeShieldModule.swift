// ScreenTimeShieldModule.swift — FamilyControls + ManagedSettings als
// **Expo-Modul** (vorher ein Legacy-RCT-Modul via NativeModules; das ist in
// RN 0.86 / Expo SDK 57 nicht mehr zuverlässig erreichbar → jeder Aufruf lief
// still ins Leere, deshalb "Sperre geht nicht").
//
// Aufgaben:
//   * Autorisierung (.individual) anfragen und melden
//   * System-Picker (FamilyActivityPicker) vollflächig präsentieren
//   * ManagedSettingsStore: Apps/Kategorien/Webseiten sperren
//   * Auswahl dauerhaft speichern (App Group wenn vorhanden, sonst Standard)
//   * Diagnose: echte Store-Werte zurückgeben, nicht raten
//   * Löschschutz (denyAppRemoval) schalten und Ergebnis zurücklesen

import ExpoModulesCore
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI
import UIKit

public class ScreenTimeShieldModule: Module {
  static let group = "group.com.meister.blockphone"
  static let selectionKey = "shieldSelection"
  static let activeKey = "shieldActive"
  static let limitsKey = "appLimits"
  static let catsKey = "shieldCategories"

  /// App Group nur benutzen, wenn sie im Profil wirklich freigeschaltet ist.
  /// Ohne Entitlement liefert `containerURL` nil und Schreibzugriffe auf die
  /// Suite verschwinden — genau das hat die Auswahl (und damit die Sperre)
  /// nach einem Neustart geleert.
  static var groupAvailable: Bool {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil
  }

  static var groupDefaults: UserDefaults? {
    groupAvailable ? UserDefaults(suiteName: group) : nil
  }

  /// Immer auch in `standard` speichern — dann überlebt die Auswahl auch ohne
  /// App Group, und der Picker ist beim nächsten Start vorbelegt.
  static func setValue(_ value: Any?, forKey key: String) {
    UserDefaults.standard.set(value, forKey: key)
    groupDefaults?.set(value, forKey: key)
  }

  static func value(forKey key: String) -> Any? {
    groupDefaults?.object(forKey: key) ?? UserDefaults.standard.object(forKey: key)
  }

  static func loadSelection() -> FamilyActivitySelection? {
    guard let data = value(forKey: selectionKey) as? Data else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  static func saveSelection(_ sel: FamilyActivitySelection) {
    guard let data = try? PropertyListEncoder().encode(sel) else { return }
    setValue(data, forKey: selectionKey)
  }

  public func definition() -> ModuleDefinition {
    Name("ScreenTimeShield")

    // MARK: Autorisierung

    AsyncFunction("requestAuthorization") { () async -> [String: Any] in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        return ["status": "approved"]
      } catch {
        return ["status": "denied", "error": error.localizedDescription]
      }
    }

    // FamilyControls verlangt den Main-Thread für authorizationStatus.
    AsyncFunction("status") { () async -> [String: Any] in
      await MainActor.run {
        let s = AuthorizationCenter.shared.authorizationStatus
        let name = s == .approved ? "approved" : (s == .denied ? "denied" : "notDetermined")
        return ["status": name]
      }
    }

    // MARK: Picker

    AsyncFunction("presentPicker") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let root = Self.topViewController() else {
          promise.resolve(["selection": "no_root"])
          return
        }
        var host: UIHostingController<PickerScreen>!
        let screen = PickerScreen(
          initial: Self.loadSelection() ?? FamilyActivitySelection(includeEntireCategory: true),
          onDone: { sel in
            Self.saveSelection(sel)
            let counts: [String: Any] = [
              "selection": "saved",
              "apps": sel.applicationTokens.count,
              "categories": sel.categoryTokens.count,
              "webDomains": sel.webDomainTokens.count,
            ]
            host.dismiss(animated: true) { promise.resolve(counts) }
          },
          onCancel: {
            host.dismiss(animated: true) { promise.resolve(["selection": "cancelled"]) }
          })
        host = UIHostingController(rootView: screen)
        // fullScreen ohne Höhenbegrenzung — sonst kollabiert die App-Liste.
        host.modalPresentationStyle = .fullScreen
        // Wisch-Geste aus: sonst schließt der Nutzer den Picker ohne
        // onDone/onCancel und die JS-Promise bleibt für immer offen.
        host.isModalInPresentation = true
        root.present(host, animated: true)
      }
    }

    AsyncFunction("selectedCount") { () -> Int in
      guard let sel = Self.loadSelection() else { return 0 }
      return sel.applicationTokens.count + sel.categoryTokens.count + sel.webDomainTokens.count
    }

    AsyncFunction("selectedApps") { () -> Int in
      Self.loadSelection()?.applicationTokens.count ?? 0
    }

    // MARK: Sperren

    AsyncFunction("applyShield") { () -> [String: Any] in
      guard let sel = Self.loadSelection() else { return ["shield": "no_selection"] }
      let store = ManagedSettingsStore()
      let apps = sel.applicationTokens
      let cats = sel.categoryTokens
      let webs = sel.webDomainTokens
      store.shield.applications = apps.isEmpty ? nil : apps
      store.shield.applicationCategories = cats.isEmpty ? nil : .specific(cats)
      store.shield.webDomains = webs.isEmpty ? nil : webs
      Self.setValue(cats.count, forKey: Self.catsKey)
      let want = apps.count + webs.count + cats.count
      let got = (store.shield.applications?.count ?? 0)
        + (store.shield.webDomains?.count ?? 0)
        + (store.shield.applicationCategories == nil ? 0 : 1)
      Self.setValue(want > 0 && got == 0, forKey: "shieldFailed")
      return [
        "shield": want == 0 ? "no_selection" : (got == 0 ? "not_applied" : "on"),
        "apps": apps.count,
        "categories": cats.count,
        "webDomains": webs.count,
        "applied": got,
      ]
    }

    AsyncFunction("clearShield") { () -> [String: Any] in
      let store = ManagedSettingsStore()
      store.shield.applications = nil
      store.shield.applicationCategories = nil
      store.shield.webDomains = nil
      Self.setValue(0, forKey: Self.catsKey)
      Self.setValue(false, forKey: "shieldFailed")
      return ["shield": "off"]
    }

    /// Teilmenge der Auswahl sperren (Index-Liste). Leere Liste = ganze Auswahl.
    AsyncFunction("shieldApps") { (indexes: [Int]) -> [String: Any] in
      guard let sel = Self.loadSelection() else { return ["shield": "no_selection"] }
      let all = Array(sel.applicationTokens)
      let wanted = indexes.filter { $0 >= 0 && $0 < all.count }
      let tokens = wanted.isEmpty ? Set(all) : Set(wanted.map { all[$0] })
      let store = ManagedSettingsStore()
      store.shield.applications = tokens.isEmpty ? nil : tokens
      let got = store.shield.applications?.count ?? 0
      let failed = !tokens.isEmpty && got == 0
      Self.setValue(failed, forKey: "shieldFailed")
      return [
        "shield": tokens.isEmpty ? "off" : (failed ? "not_applied" : "on"),
        "apps": tokens.count,
        "applied": got,
      ]
    }

    AsyncFunction("shieldState") { () -> [String: Any] in
      let sel = Self.loadSelection()
      let store = ManagedSettingsStore()
      let apps = store.shield.applications?.count ?? 0
      let web = store.shield.webDomains?.count ?? 0
      let catsSet = store.shield.applicationCategories != nil
      let cats = catsSet ? max(1, UserDefaults.standard.integer(forKey: Self.catsKey)) : 0
      return [
        "active": apps > 0 || web > 0 || catsSet,
        "apps": apps,
        "categories": cats,
        "webDomains": web,
        "selected": [
          "apps": sel?.applicationTokens.count ?? 0,
          "categories": sel?.categoryTokens.count ?? 0,
          "webDomains": sel?.webDomainTokens.count ?? 0,
        ],
      ]
    }

    // MARK: Löschschutz

    /// `denyAppRemoval` verhindert das Löschen von Apps auf dem Gerät.
    /// Wirksam wird es nur mit passender Autorisierung (Kind-/Family-Konto);
    /// wir lesen den Store zurück und melden ehrlich, ob es greift.
    AsyncFunction("setDenyAppRemoval") { (enabled: Bool) -> [String: Any] in
      let store = ManagedSettingsStore()
      store.application.denyAppRemoval = enabled
      let applied = store.application.denyAppRemoval ?? false
      return ["requested": enabled, "applied": applied]
    }

    AsyncFunction("getDenyAppRemoval") { () -> Bool in
      ManagedSettingsStore().application.denyAppRemoval ?? false
    }

    // MARK: Diagnose

    AsyncFunction("diagnostics") { () async -> [String: Any] in
      let sel = Self.loadSelection()
      let store = ManagedSettingsStore()
      let auth = await MainActor.run { AuthorizationCenter.shared.authorizationStatus }
      return [
        "module": "expo",
        "authorization": auth == .approved ? "approved" : (auth == .denied ? "denied" : "notDetermined"),
        "storage": Self.groupAvailable ? "app_group" : "standard",
        "selected": [
          "apps": sel?.applicationTokens.count ?? 0,
          "categories": sel?.categoryTokens.count ?? 0,
          "webDomains": sel?.webDomainTokens.count ?? 0,
        ],
        "store": [
          "apps": store.shield.applications?.count ?? 0,
          "webDomains": store.shield.webDomains?.count ?? 0,
          "categoriesSet": store.shield.applicationCategories != nil,
          "denyAppRemoval": store.application.denyAppRemoval ?? false,
        ],
        "shieldFailed": (Self.value(forKey: "shieldFailed") as? Bool) ?? false,
      ]
    }

    // MARK: Persistenz für die Monitor-Extension

    AsyncFunction("setLimits") { (json: String) in
      Self.setValue(json, forKey: Self.limitsKey)
    }

    AsyncFunction("getLimits") { () -> String in
      (Self.value(forKey: Self.limitsKey) as? String) ?? "[]"
    }

    // MARK: Zeitlimits im Hintergrund (DeviceActivity)

    /// Schwellen bei iOS registrieren. Ohne `startMonitoring` gibt es kein
    /// Event und damit keine Sperre — die App ist beim Erreichen des Limits
    /// längst beendet. `json` = [{index, dailySeconds, weeklySeconds}]
    AsyncFunction("startLimits") { (json: String) -> [String: Any] in
      Self.startLimitMonitoring(json: json)
    }

    AsyncFunction("stopLimits") { () -> [String: Any] in
      let center = DeviceActivityCenter()
      center.stopMonitoring([Self.dailyActivity, Self.weeklyActivity])
      Self.clearLimitShield()
      return ["monitoring": "off", "activities": center.activities.map { $0.rawValue }]
    }

    AsyncFunction("limitsStatus") { () -> [String: Any] in
      let center = DeviceActivityCenter()
      return [
        "monitoring": center.activities.isEmpty ? "off" : "on",
        "activities": center.activities.map { $0.rawValue },
        "group": Self.groupAvailable,
      ]
    }

    /// Zeitstempel, den die Shield-Action-Extension beim "ENTSPERREN"-Tippen
    /// in die App Group schreibt. 0 = kein Antrag.
    AsyncFunction("unlockRequestedAt") { () -> Double in
      (Self.groupDefaults?.double(forKey: "shieldUnlockRequestedAt")) ?? 0
    }
  }

  // MARK: - Zeitlimits (DeviceActivity)

  static let dailyActivity = DeviceActivityName("blockphone.daily")
  static let weeklyActivity = DeviceActivityName("blockphone.weekly")
  /// Eigener Store: die Limits-Sperre darf den Master-Shield nie mitschleifen.
  static let limitStoreName = ManagedSettingsStore.Name("blockphone.limits")

  struct LimitRule: Decodable {
    let index: Int
    let dailySeconds: Int
    let weeklySeconds: Int
  }

  static func parseLimitRules(_ json: String) -> [LimitRule] {
    guard let data = json.data(using: .utf8) else { return [] }
    return (try? JSONDecoder().decode([LimitRule].self, from: data)) ?? []
  }

  static func clearLimitShield() {
    let store = ManagedSettingsStore(named: limitStoreName)
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  /// Events bauen + `startMonitoring` aufrufen. Immer erst stoppen: sonst
  /// bleiben alte Schwellen aktiv, wenn ein Limit entfernt wurde.
  static func startLimitMonitoring(json: String) -> [String: Any] {
    let rules = parseLimitRules(json)
    let center = DeviceActivityCenter()
    center.stopMonitoring([dailyActivity, weeklyActivity])

    guard let selection = loadSelection() else {
      return ["monitoring": "no_selection", "started": [], "group": groupAvailable]
    }
    let tokens = Array(selection.applicationTokens)
    guard !tokens.isEmpty else {
      return ["monitoring": "no_selection", "started": [], "group": groupAvailable]
    }

    var daily: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    var weekly: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    for rule in rules where rule.index >= 0 && rule.index < tokens.count {
      let token = tokens[rule.index]
      if rule.dailySeconds >= 60 {
        daily[DeviceActivityEvent.Name("app\(rule.index)")] = DeviceActivityEvent(
          applications: [token],
          threshold: DateComponents(second: rule.dailySeconds)
        )
      }
      if rule.weeklySeconds >= 60 {
        weekly[DeviceActivityEvent.Name("app\(rule.index)")] = DeviceActivityEvent(
          applications: [token],
          threshold: DateComponents(second: rule.weeklySeconds)
        )
      }
    }

    var started: [String] = []
    if !daily.isEmpty {
      let schedule = DeviceActivitySchedule(
        intervalStart: DateComponents(hour: 0, minute: 0),
        intervalEnd: DateComponents(hour: 23, minute: 59),
        repeats: true
      )
      if (try? center.startMonitoring(dailyActivity, during: schedule, events: daily)) != nil {
        started.append(dailyActivity.rawValue)
      }
    }
    if !weekly.isEmpty {
      // Woche: Montag 00:00 bis Sonntag 23:59 (weekday 1 = Sonntag).
      let schedule = DeviceActivitySchedule(
        // DateComponents-Memberwise-Init ist reihenfolgegebunden (hour vor weekday).
        intervalStart: DateComponents(hour: 0, minute: 0, weekday: 2),
        intervalEnd: DateComponents(hour: 23, minute: 59, weekday: 1),
        repeats: true
      )
      if (try? center.startMonitoring(weeklyActivity, during: schedule, events: weekly)) != nil {
        started.append(weeklyActivity.rawValue)
      }
    }

    // Die Extension liest die Schwellen aus der App Group — ohne Gruppe
    // bleibt sie blind, deshalb ehrlich mitliefern.
    setValue(json, forKey: limitsKey)
    return [
      "monitoring": started.isEmpty ? "off" : "on",
      "started": started,
      "daily": daily.count,
      "weekly": weekly.count,
      "group": groupAvailable,
    ]
  }

  // MARK: - Helfer

  static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    let window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
    var vc = window?.rootViewController
    while let p = vc?.presentedViewController { vc = p }
    return vc
  }
}

// MARK: - Picker-UI

struct PickerScreen: View {
  let onDone: (FamilyActivitySelection) -> Void
  let onCancel: () -> Void
  @State private var selection: FamilyActivitySelection

  init(initial: FamilyActivitySelection,
       onDone: @escaping (FamilyActivitySelection) -> Void,
       onCancel: @escaping () -> Void) {
    self.onDone = onDone
    self.onCancel = onCancel
    _selection = State(initialValue: initial)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button("Abbrechen") { onCancel() }
          .foregroundColor(.white)
        Spacer()
        Text("APPS WÄHLEN")
          .font(.system(size: 13, weight: .bold))
          .kerning(1.2)
          .foregroundColor(.white)
        Spacer()
        Button("Fertig") { onDone(selection) }
          .font(.system(size: 15, weight: .bold))
          .foregroundColor(.white)
      }
      .padding(.horizontal, 16)
      .frame(height: 52)
      .background(Color.black)

      Divider().background(Color(white: 0.2))

      FamilyActivityPicker(selection: $selection)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
    .background(Color.black)
    .ignoresSafeArea(edges: .bottom)
  }
}
