// DeviceActivityMonitorExtension.swift
//
// Zeitlimits im Hintergrund. iOS beendet die App — die Sperre darf deshalb
// nicht von der Haupt-App abhängen, sondern wird hier vom System ausgelöst:
//
//   Haupt-App  → ScreenTimeShield.startLimits(json): startMonitoring mit
//                Events "app<index>" und Schwelle = Limit in Sekunden
//   Extension  → eventDidReachThreshold: App-Token `index` in den
//                LIMITS-Store shielden (systemweit, sofort)
//   Extension  → intervalDidStart/DidEnd: Limits-Store leeren (neuer Tag/Woche)
//
// Gelesen wird ausschließlich aus der App Group `group.com.meister.blockphone`:
//   shieldSelection → FamilyActivitySelection (plist)  = Token-Quelle
//   appLimits       → [{index,dailySeconds,weeklySeconds}] (JSON, nur Diagnose)
//
// WICHTIG (Fehler aus der Vorgänger-Version): niemals den Default-Store
// benutzen und niemals `applicationCategories = nil` setzen — damit würde die
// Extension die Kategorie-Sperren der Haupt-App aufheben. Deshalb ein eigener
// Store `blockphone.limits`: Shields aus mehreren Stores werden von iOS
// vereinigt, ein `nil` hier lässt den Master-Shield unangetastet.
//
// Extension-Target:  com.apple.deviceactivity.monitor-extension
// Prinzipal-Klasse:  $(PRODUCT_MODULE_NAME).DeviceActivityMonitorExtension
// Bundle-ID:         com.meister.blockphone.DeviceActivityMonitor
// Braucht:           com.apple.developer.family-controls + App Group (beides
//                    muss im Provisioning-Profil stehen, sonst startet die
//                    Extension nicht bzw. liest nil)

import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import os

final class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    private static let groupId = "group.com.meister.blockphone"
    private static let selectionKey = "shieldSelection"
    private static let limitsKey = "appLimits"
    private static let storeName = ManagedSettingsStore.Name("blockphone.limits")

    private let log = Logger(subsystem: "com.meister.blockphone", category: "limits")
    private var store: ManagedSettingsStore { ManagedSettingsStore(named: Self.storeName) }

    // MARK: - App Group

    private static func groupDefaults() -> UserDefaults? {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) != nil else {
            return nil
        }
        return UserDefaults(suiteName: groupId)
    }

    private static func selection() -> FamilyActivitySelection? {
        guard let data = groupDefaults()?.data(forKey: selectionKey) else { return nil }
        return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    /// "app3" → 3. Alles andere (fremde Events) → nil.
    private static func appIndex(from eventName: String) -> Int? {
        guard eventName.hasPrefix("app") else { return nil }
        return Int(eventName.dropFirst(3))
    }

    // MARK: - Intervalle

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // Neuer Tag bzw. neue Woche: Limits des VORHERIGEN Zeitraums aufheben.
        // Nur der eigene Store — der Master-Shield (anderer Store) bleibt.
        resetLimitShield(reason: "intervalDidStart \(activity.rawValue)")
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        resetLimitShield(reason: "intervalDidEnd \(activity.rawValue)")
    }

    // MARK: - Schwellen

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name,
                                        activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)

        guard let index = Self.appIndex(from: event.rawValue) else {
            log.error("unbekanntes Event \(event.rawValue, privacy: .public)")
            return
        }
        guard let tokens = Self.selection().map({ Array($0.applicationTokens) }) else {
            log.error("keine Auswahl in der App Group — Limit kann nicht greifen")
            return
        }
        guard index >= 0 && index < tokens.count else {
            log.error("Index \(index) außerhalb der Auswahl (\(tokens.count))")
            return
        }

        var shielded = store.shield.applications ?? []
        shielded.insert(tokens[index])
        store.shield.applications = shielded

        // Ergebnis prüfen statt hoffen.
        let applied = store.shield.applications?.count ?? 0
        log.info("Limit erreicht: \(event.rawValue, privacy: .public) → \(applied) App(s) gesperrt")
    }

    override func eventWillReachThresholdWarning(_ event: DeviceActivityEvent.Name,
                                               activity: DeviceActivityName) {
        super.eventWillReachThresholdWarning(event, activity: activity)
        // Kein UI-Zugriff aus der Monitor-Extension: nur protokollieren.
        // Eine lokale Warnung müsste die Haupt-App per Notification planen.
        log.info("Warnung: \(event.rawValue, privacy: .public) fast am Limit")
    }

    // MARK: - Hilfe

    private func resetLimitShield(reason: String) {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
        log.info("Limits zurückgesetzt (\(reason, privacy: .public))")
    }
}
