// DeviceActivityMonitorExtension.swift
//
// Zeitlimits im Hintergrund. iOS beendet die App — die Sperre darf deshalb
// nicht von der Haupt-App abhängen, sondern wird hier vom System ausgelöst:
//
//   Haupt-App  → ScreenTimeShield.startLimits(json): startMonitoring mit
//                Events "d<index>" (Tageslimit) bzw. "w<index>" (Wochenlimit),
//                Schwelle = Limit in Sekunden
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
    /// Merkliste, welche App (Index) wegen welcher Limit-Art gesperrt ist:
    /// {"3":["d","w"]}. Nötig, weil der Tageswechsel nur die Tages-Sperren
    /// aufheben darf — eine erreichte Wochen-Sperre muss bleiben.
    private static let shieldedKey = "limitsShielded"

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

    /// "d3" → ("d", 3), "w7" → ("w", 7). Fremde Events → nil.
    private static func limitEvent(_ name: String) -> (kind: String, index: Int)? {
        guard let first = name.first, first == "d" || first == "w" else { return nil }
        guard let index = Int(name.dropFirst()) else { return nil }
        return (String(first), index)
    }

    // MARK: - Merkliste

    private static func loadShielded() -> [String: [String]] {
        guard let json = groupDefaults()?.string(forKey: shieldedKey),
              let data = json.data(using: .utf8),
              let map = try? JSONDecoder().decode([String: [String]].self, from: data)
        else { return [:] }
        return map
    }

    private static func saveShielded(_ map: [String: [String]]) {
        let json = (try? JSONEncoder().encode(map))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        groupDefaults()?.set(json, forKey: shieldedKey)
    }

    /// Setzt den Limit-Store exakt auf den Inhalt der Merkliste (nicht additiv),
    /// damit aufgehobene Sperren auch wirklich verschwinden.
    private func applyShields(_ map: [String: [String]]) {
        guard let tokens = Self.selection().map({ Array($0.applicationTokens) }) else {
            log.error("keine Auswahl in der App Group — Limit kann nicht greifen")
            return
        }
        var shielded = Set<ApplicationToken>()
        for (key, kinds) in map where !kinds.isEmpty {
            guard let index = Int(key), index >= 0, index < tokens.count else { continue }
            shielded.insert(tokens[index])
        }
        store.shield.applications = shielded.isEmpty ? nil : shielded
        log.info("Limit-Sperren aktiv: \(shielded.count) App(s)")
    }

    // MARK: - Intervalle

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // Neuer Tag bzw. neue Woche: Limits des VORHERIGEN Zeitraums aufheben.
        // Nur der eigene Store — der Master-Shield (anderer Store) bleibt.
        resetLimitShield(for: activity, reason: "intervalDidStart")
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        resetLimitShield(for: activity, reason: "intervalDidEnd")
    }

    // MARK: - Schwellen

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name,
                                        activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)

        guard let hit = Self.limitEvent(event.rawValue) else {
            log.error("unbekanntes Event \(event.rawValue, privacy: .public)")
            return
        }
        var map = Self.loadShielded()
        let key = String(hit.index)
        var kinds = Set(map[key] ?? [])
        kinds.insert(hit.kind)
        map[key] = Array(kinds)
        Self.saveShielded(map)
        applyShields(map)

        // Ergebnis prüfen statt hoffen.
        let applied = store.shield.applications?.count ?? 0
        log.info("Limit erreicht (\(event.rawValue, privacy: .public), Art \(hit.kind, privacy: .public)): \(applied) App(s) gesperrt")
    }

    override func eventWillReachThresholdWarning(_ event: DeviceActivityEvent.Name,
                                               activity: DeviceActivityName) {
        super.eventWillReachThresholdWarning(event, activity: activity)
        // Kein UI-Zugriff aus der Monitor-Extension: nur protokollieren.
        // Eine lokale Warnung müsste die Haupt-App per Notification planen.
        log.info("Warnung: \(event.rawValue, privacy: .public) fast am Limit")
    }

    // MARK: - Hilfe

    /// Hebt Sperren auf: beim Tages-Intervall nur die Tages-Sperren ("d"),
    /// beim Wochen-Intervall alles. Unbekannte Activity → alles (Sicherheitsnetz).
    private func resetLimitShield(for activity: DeviceActivityName, reason: String) {
        let isDaily = activity.rawValue.hasSuffix("daily")
        let isWeekly = activity.rawValue.hasSuffix("weekly")
        var map = Self.loadShielded()
        if isDaily && !isWeekly {
            for (key, kinds) in map { map[key] = kinds.filter { $0 != "d" } }
        } else {
            map = [:]
        }
        Self.saveShielded(map)
        applyShields(map)
        log.info("Limits zurückgesetzt (\(reason, privacy: .public) \(activity.rawValue, privacy: .public))")
    }
}
