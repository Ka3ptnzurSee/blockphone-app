import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit
import DeviceActivity
import React

@objc(ScreenTimeShield)
final class ScreenTimeShield: NSObject, FamilyActivityPickerHost {
  static let group = "group.com.meister.blockphone"
  static let key = "shieldSelection"

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc(requestAuthorization:rejecter:)
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        resolve(["status": "approved"])
      } catch {
        resolve(["status": "denied", "error": error.localizedDescription])
      }
    }
  }

  @objc(status:rejecter:)
  func status(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let s = AuthorizationCenter.shared.authorizationStatus
    resolve(["status": s == .approved ? "approved" : (s == .denied ? "denied" : "notDetermined")])
  }

  @objc(presentPicker:rejecter:)
  func presentPicker(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else {
      reject("no_root", "Kein Root-View-Controller", nil); return
    }
    var vc = root
    while let p = vc.presentedViewController { vc = p }
    let picker = UIHostingController(rootView: FamilyActivityPickerHost(onDone: { sel in
      if let data = try? PropertyListEncoder().encode(sel) {
        UserDefaults(suiteName: ScreenTimeShield.group)?.set(data, forKey: ScreenTimeShield.key)
      }
      vc.dismiss(animated: true) { resolve(["selection": "saved"]) }
    }))
    if #available(iOS 14.0, *) { picker.view.backgroundColor = .clear }
    vc.present(picker, animated: true)
  }

  @objc(applyShield:rejecter:)
  func applyShield(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let store = ManagedSettingsStore()
    guard let data = UserDefaults(suiteName: ScreenTimeShield.group)?.data(forKey: ScreenTimeShield.key),
          let sel = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else {
      resolve(["shield": "no_selection"]); return
    }
    store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
    resolve(["shield": "on", "apps": sel.applicationTokens.count])
  }

  @objc(clearShield:rejecter:)
  func clearShield(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let store = ManagedSettingsStore()
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
    resolve(["shield": "off"])
  }

  @objc(selectedCount:rejecter:)
  func selectedCount(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let data = UserDefaults(suiteName: ScreenTimeShield.group)?.data(forKey: ScreenTimeShield.key),
          let sel = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else {
      resolve(0); return
    }
    resolve(sel.applicationTokens.count + sel.categoryTokens.count)
  }
}

protocol FamilyActivityPickerHost {}

struct FamilyActivityPickerHost: View {
  let onDone: (FamilyActivitySelection) -> Void
  @State private var selection = FamilyActivitySelection()
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    VStack {
      HStack {
        Button("Abbrechen") { dismiss() }.padding()
        Spacer()
        Button("Fertig") { onDone(selection); dismiss() }.padding().bold()
      }
      FamilyActivityPicker(selection: $selection)
    }
  }
}

