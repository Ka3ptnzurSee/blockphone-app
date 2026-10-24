// ScheduledAccessMonitor.swift
//
// DeviceActivity-Monitor: Zeitpläne + Limits → automatisch re-shield.
// Vorbild: Dull.app → DullDeviceActivityMonitor.ScheduledAccessMonitor
//
// Extension-Target: com.apple.deviceactivity.monitor-extension
// Prinzipal-Klasse (Info.plist NSExtensionPrincipalClass):
//   $(PRODUCT_MODULE_NAME).ScheduledAccessMonitor
//
// DeviceActivityMonitor ist eine KLASSE → `override` ist hier korrekt.
// Die Schedule-Definition (startMonitoring) gehört in die HAUPT-App
// (ScreenTimeManager.swift); diese Extension bekommt nur die Callbacks.

import DeviceActivity
import ManagedSettings
import Foundation

final class ScheduledAccessMonitor: DeviceActivityMonitor {

    private let store = ManagedSettingsStore()

    // MARK: - Intervalle (Tageslimits)

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // Z. B. "ab 22 Uhr aus": hier shielden, wenn das Limit beginnt.
        store.shield.applicationCategories = .specific([.socialNetworking])
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Limit vorbei → wieder freigeben.
        store.shield.applicationCategories = nil
    }

    // MARK: - Events (Schwellen erreicht)

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name,
                                         activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        // Nutzungs-Schwelle überschritten → sofort shielden.
        store.shield.applicationCategories = .specific([.socialNetworking])
    }

    override func eventWillReachThresholdWarning(_ event: DeviceActivityEvent.Name,
                                                 activity: DeviceActivityName) {
        super.eventWillReachThresholdWarning(event, activity: activity)
        // Warnung kurz vor dem Limit (z. B. lokale Notification).
    }
}
