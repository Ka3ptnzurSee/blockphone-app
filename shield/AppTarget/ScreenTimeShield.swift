// ScreenTimeShield.swift
//
// FamilyControls + ManagedSettings: native Apps systemweit sperren.
// Vorbild: Dull / one sec — dieselben Apple-APIs, Nothing-Look.
//
// Kernpunkte (Build 143):
//   * Picker wird VOLLFLÄCHIG und mit voller Höhe präsentiert. Vorher bekam der
//     UIHostingController keine Größe → die App-Liste war abgeschnitten bzw.
//     ließ sich nicht scrollen ("App nicht vollständig angezeigt").
//   * Die Auswahl wird beim erneuten Öffnen des Pickers VORBELEGT, damit man
//     sieht, was schon gewählt ist.
//   * applyShield sperrt Apps, Kategorien UND Webseiten (vorher nur Apps).
//   * Der Sperr-Zustand wird persistent gespeichert und von der UI gelesen —
//     vorher zeigte die App nach einem Tab-Wechsel wieder "aus", obwohl die
//     Sperre lief.
//   * Pro-App-Sperre: shieldApps(indexes) sperrt eine Teilmenge der Auswahl.
//   * Limit-Regeln werden mitgespeichert (limits), damit die Monitor-Extension
//     sie später lesen kann.

import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit
import DeviceActivity
import React

@objc(ScreenTimeShield)
final class ScreenTimeShield: NSObject {
  static let group = "group.com.meister.blockphone"
  static let selectionKey = "shieldSelection"
  static let activeKey = "shieldActive"
  static let limitsKey = "appLimits"

  private static var defaults: UserDefaults {
    UserDefaults(suiteName: group) ?? UserDefaults.standard
  }

  @objc static func requiresMainQueueSetup() -> Bool { true }

  // MARK: - Autorisierung

  @objc(requestAuthorization:rejecter:)
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task { @MainActor in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        resolve(["status": "approved"])
      } catch {
        resolve(["status": "denied", "error": error.localizedDescription])
      }
    }
  }

  @objc(status:rejecter:)
  func status(_ resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
    let s = AuthorizationCenter.shared.authorizationStatus
    resolve(["status": s == .approved ? "approved" : (s == .denied ? "denied" : "notDetermined")])
  }

  // MARK: - Picker

  @objc(presentPicker:rejecter:)
  func presentPicker(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard let root = Self.topViewController() else {
        reject("no_root", "Kein Root-View-Controller", nil)
        return
      }
      var host: UIHostingController<PickerScreen>!
      let screen = PickerScreen(
        initial: Self.loadSelection() ?? FamilyActivitySelection(includeEntireCategory: true),
        onDone: { sel in
          Self.saveSelection(sel)
          host.dismiss(animated: true) {
            resolve([
              "selection": "saved",
              "apps": sel.applicationTokens.count,
              "categories": sel.categoryTokens.count,
              "webDomains": sel.webDomainTokens.count,
            ])
          }
        },
        onCancel: {
          host.dismiss(animated: true) { resolve(["selection": "cancelled"]) }
        })
      host = UIHostingController(rootView: screen)
      // WICHTIG: fullScreen + keine intrinsische Höhe → sonst kollabiert der
      // FamilyActivityPicker auf wenige Punkte und die Liste ist unbrauchbar.
      host.modalPresentationStyle = .fullScreen
      root.present(host, animated: true)
    }
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    let window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
    var vc = window?.rootViewController
    while let p = vc?.presentedViewController { vc = p }
    return vc
  }

  private static func loadSelection() -> FamilyActivitySelection? {
    guard let data = defaults.data(forKey: selectionKey) else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  private static func saveSelection(_ sel: FamilyActivitySelection) {
    if let data = try? PropertyListEncoder().encode(sel) {
      defaults.set(data, forKey: selectionKey)
    }
  }

  // MARK: - Sperre

  @objc(applyShield:rejecter:)
  func applyShield(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sel = Self.loadSelection() else {
      resolve(["shield": "no_selection"]); return
    }
    let store = ManagedSettingsStore()
    let apps = sel.applicationTokens
    let cats = sel.categoryTokens
    let webs = sel.webDomainTokens
    store.shield.applications = apps.isEmpty ? nil : apps
    store.shield.applicationCategories = cats.isEmpty ? nil : .specific(cats)
    store.shield.webDomains = webs.isEmpty ? nil : webs
    let active = !(apps.isEmpty && cats.isEmpty && webs.isEmpty)
    Self.defaults.set(active, forKey: Self.activeKey)
    resolve([
      "shield": active ? "on" : "no_selection",
      "apps": apps.count,
      "categories": cats.count,
      "webDomains": webs.count,
    ])
  }

  @objc(clearShield:rejecter:)
  func clearShield(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let store = ManagedSettingsStore()
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
    Self.defaults.set(false, forKey: Self.activeKey)
    resolve(["shield": "off"])
  }

  /// Nur einzelne Apps der Auswahl sperren (Index-Liste aus dem Picker).
  /// Leere Liste = alle Auswahl-Apps sperren.
  @objc(shieldApps:resolver:rejecter:)
  func shieldApps(_ indexes: NSArray,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sel = Self.loadSelection() else {
      resolve(["shield": "no_selection"]); return
    }
    let all = Array(sel.applicationTokens)
    let wanted = indexes.compactMap { ($0 as? NSNumber)?.intValue }.filter { $0 >= 0 && $0 < all.count }
    let tokens = wanted.isEmpty ? Set(all) : Set(wanted.map { all[$0] })
    let store = ManagedSettingsStore()
    store.shield.applications = tokens.isEmpty ? nil : tokens
    Self.defaults.set(!tokens.isEmpty, forKey: Self.activeKey)
    resolve(["shield": tokens.isEmpty ? "off" : "on", "apps": tokens.count])
  }

  @objc(shieldState:rejecter:)
  func shieldState(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let sel = Self.loadSelection()
    let store = ManagedSettingsStore()
    let apps = store.shield.applications?.count ?? 0
    let web = store.shield.webDomains?.count ?? 0
    var cats = 0
    if case let .specific(set)? = store.shield.applicationCategories { cats = set.count }
    if case .all? = store.shield.applicationCategories { cats = -1 }
    resolve([
      "active": apps > 0 || web > 0 || cats != 0,
      "apps": apps,
      "categories": cats,
      "webDomains": web,
      "selected": [
        "apps": sel?.applicationTokens.count ?? 0,
        "categories": sel?.categoryTokens.count ?? 0,
        "webDomains": sel?.webDomainTokens.count ?? 0,
      ],
    ])
  }

  @objc(selectedCount:rejecter:)
  func selectedCount(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sel = Self.loadSelection() else { resolve(0); return }
    resolve(sel.applicationTokens.count + sel.categoryTokens.count + sel.webDomainTokens.count)
  }

  /// Wie viele Apps stecken in der Auswahl (ohne Kategorien/Webseiten)?
  @objc(selectedApps:rejecter:)
  func selectedApps(_ resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.loadSelection()?.applicationTokens.count ?? 0)
  }

  // MARK: - Limit-Regeln (Persistenz für die Monitor-Extension)

  @objc(setLimits:resolver:rejecter:)
  func setLimits(_ json: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    Self.defaults.set(json, forKey: Self.limitsKey)
    resolve(NSNull())
  }

  @objc(getLimits:rejecter:)
  func getLimits(_ resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.defaults.string(forKey: Self.limitsKey) ?? "[]")
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
