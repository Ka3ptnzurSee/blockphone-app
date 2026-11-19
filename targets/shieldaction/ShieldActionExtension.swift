// ShieldActionExtension.swift
//
// Button-Aktionen auf dem eigenen Sperr-Screen (`ShieldConfigurationExtension`
// liefert „OK" = primary und „ENTSPERREN" = secondary).
//
// Vorher: secondary → `.none`, d. h. der Button hat NICHTS getan — der Nutzer
// tippte „ENTSPERREN" und landete wieder auf demselben Screen. Jetzt:
//
//   primary   → `.close`  (App/Site schließen, zurück zum Home-Screen)
//   secondary → Merker in die App Group schreiben + `.defer`
//               (iOS gibt die Kontrolle an die Blockphone-App ab, die dort den
//               PIN-Gate zeigt — Sperre aufheben passiert NUR dort, nicht hier)
//
// Extension-Target:  com.apple.ManagedSettings.shield-action-service
// Prinzipal-Klasse:  $(PRODUCT_MODULE_NAME).ShieldActionExtension
// Bundle-ID:         com.meister.blockphone.ShieldAction
// Braucht:           com.apple.developer.family-controls (+ App Group für den
//                    Merker — ohne Gruppe schreibt sie ins eigene Default, dann
//                    sieht die App den Antrag nicht)
//
// WICHTIG: `ShieldActionDelegate` ist in aktuellen SDKs eine KLASSE
// (NSObject-Subklasse), kein Protokoll. Deshalb beerben (nicht zusätzlich
// NSObject aufführen — das ergibt "multiple inheritance from classes 'NSObject'
// and 'ShieldActionDelegate'") und alle Methoden `override`.

import Foundation
import ManagedSettings
import ManagedSettingsUI
import os

final class ShieldActionExtension: ShieldActionDelegate {

    private static let groupId = "group.com.meister.blockphone"
    private static let requestKey = "shieldUnlockRequestedAt"
    private let log = Logger(subsystem: "com.meister.blockphone", category: "shield")

    /// Antrag für die Haupt-App hinterlegen (Zeitstempel), damit sie beim
    /// nächsten Start den PIN-Gate zeigt statt kommentarlos offen zu sein.
    private func recordUnlockRequest(source: String) {
        let now = Date().timeIntervalSince1970
        if let group = UserDefaults(suiteName: Self.groupId) {
            group.set(now, forKey: Self.requestKey)
        } else {
            // Ohne App Group: bleibt in der Extension — die App sieht es nicht.
            UserDefaults.standard.set(now, forKey: Self.requestKey)
            log.error("App Group fehlt — Entsperr-Antrag ist für die App unsichtbar")
        }
        log.info("Entsperr-Antrag (\(source, privacy: .public))")
    }

    // MARK: - Apps

    override func handle(action: ShieldAction,
                for application: Application,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            recordUnlockRequest(source: "app")
            // `.defer` = die Entscheidung gehört der App (PIN-Gate), nicht dem
            // Shield. `.none` würde den Nutzer auf demselben Screen lassen.
            completionHandler(.defer)
        @unknown default:
            completionHandler(.none)
        }
    }

    // MARK: - Webseiten

    override func handle(action: ShieldAction,
                for webDomain: WebDomain,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            recordUnlockRequest(source: "web")
            completionHandler(.defer)
        @unknown default:
            completionHandler(.none)
        }
    }

    // MARK: - Kategorien

    override func handle(action: ShieldAction,
                for category: ActivityCategory,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            recordUnlockRequest(source: "category")
            completionHandler(.defer)
        @unknown default:
            completionHandler(.none)
        }
    }
}
