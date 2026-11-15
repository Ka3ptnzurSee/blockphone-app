import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit
import DeviceActivity
import React

@objc(ScreenTimeShield)
final class ScreenTimeShield: NSObject {
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
    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
          let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
      reject("no_root", "Kein Root-View-Controller", nil); return
    }
    var vc = root
    while let p = vc.presentedViewController { vc = p }
    let host = FamilyActivityPickerHost(
      onDone: { sel in
        if let data = try? PropertyListEncoder().encode(sel) {
          (UserDefaults(suiteName: ScreenTimeShield.group) ?? UserDefaults.standard).set(data, forKey: ScreenTimeShield.key)
        }
        vc.dismiss(animated: true) { resolve(["selection": "saved"]) }
      },
      onCancel: { vc.dismiss(animated: true) { resolve(["selection": "cancelled"]) } }
    )
    let picker = UIHostingController(rootView: host)
    vc.present(picker, animated: true)
  }

  @objc(applyShield:rejecter:)
  func applyShield(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let store = ManagedSettingsStore()
    guard let data = (UserDefaults(suiteName: ScreenTimeShield.group) ?? UserDefaults.standard).data(forKey: ScreenTimeShield.key),
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
    guard let data = (UserDefaults(suiteName: ScreenTimeShield.group) ?? UserDefaults.standard).data(forKey: ScreenTimeShield.key),
          let sel = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) else {
      resolve(0); return
    }
    resolve(sel.applicationTokens.count + sel.categoryTokens.count)
  }
}

struct FamilyActivityPickerHost: View {
  let onDone: (FamilyActivitySelection) -> Void
  let onCancel: () -> Void
  @State private var selection = FamilyActivitySelection()
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    VStack {
      HStack {
        Button("Abbrechen") { onCancel(); dismiss() }.padding()
        Spacer()
        Button("Fertig") { onDone(selection); dismiss() }.padding().bold()
      }
      FamilyActivityPicker(selection: $selection)
    }
  }
}

