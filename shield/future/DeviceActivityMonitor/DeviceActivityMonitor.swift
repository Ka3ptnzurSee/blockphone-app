import DeviceActivity
import FamilyControls
import ManagedSettings
import Foundation

final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  private let store = ManagedSettingsStore()

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    ShieldStorage.apply(to: store)
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    ShieldStorage.clear(store)
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    ShieldStorage.apply(to: store)
  }
}

enum ShieldStorage {
  static let appGroup = "group.com.meister.blockphone"
  static let selectionKey = "screenTime.shield.selection"
  static let activeKey = "screenTime.shield.active"

  static func apply(to store: ManagedSettingsStore) {
    let defaults = UserDefaults(suiteName: appGroup)
    guard defaults?.bool(forKey: activeKey) == true,
          let data = defaults?.data(forKey: selectionKey),
          let selection = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return }
    if !selection.applicationTokens.isEmpty { store.shield.applications = selection.applicationTokens }
    if !selection.categoryTokens.isEmpty { store.shield.applicationCategories = .specific(selection.categoryTokens) }
    if !selection.webDomainTokens.isEmpty { store.shield.webDomains = selection.webDomainTokens }
  }

  static func clear(_ store: ManagedSettingsStore) {
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }
}

