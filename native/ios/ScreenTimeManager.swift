// ScreenTimeManager.swift
//
// FamilyControls + ManagedSettings: native Social-Apps shielden (System-Level-Blocker).
// Vorbild: Dull-App (com.getdull.app) — dieselben Apple-APIs, Nothing-Look.
//
// In Expo geht das NICHT direkt (managed workflow) → als Custom Native Module über
// `expo prebuild` einbinden (siehe native/README.md + plugins/withScreenTimeShield.js).
//
// iOS 16+ / Xcode 15+ / Swift 5.9+. Entitlement: com.apple.developer.family-controls

import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

/// Zentrale Screen-Time-Steuerung der Haupt-App.
@MainActor
public final class ScreenTimeManager: ObservableObject {

    public static let shared = ScreenTimeManager()

    private let store = ManagedSettingsStore()
    private let center = AuthorizationCenter.shared

    @Published public private(set) var isAuthorized = false
    @Published public private(set) var shieldedApps: Set<ApplicationToken> = []

    private init() {
        isAuthorized = center.authorizationStatus == .approved
    }

    // MARK: - Autorisierung (einmalig, "Aufsicht" über die eigenen Apps)

    public func requestAuthorization() async throws {
        try await center.requestAuthorization(for: .individual)
        isAuthorized = center.authorizationStatus == .approved
    }

    // MARK: - Shield (native Apps sperren)

    /// Sperrt die übergebenen Apps komplett. Der custom Sperr-Screen kommt aus
    /// ShieldConfigurationExtension (ShieldConfigurationProvider).
    public func shield(applications: Set<ApplicationToken>) {
        store.shield.applications = applications
        shieldedApps = applications
    }

    /// Sperrt ganze Kategorien (z. B. .socialNetworking).
    public func shield(categories: Set<ActivityCategoryToken>) {
        store.shield.applicationCategories = .specific(categories)
    }

    /// Hebt alle Shields auf.
    public func unshieldAll() {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
        shieldedApps = []
    }

    // MARK: - Einschränkungen (optional, wie Dull)

    public func denyAppRemoval(_ deny: Bool) {
        store.application.denyAppRemoval = deny
    }

    public func denyAccountModification(_ deny: Bool) {
        store.account.denyAccountModification = deny
    }

    // MARK: - Schedules (DeviceActivityCenter.startMonitoring gehört in die HAUPT-App;
    // die Extension bekommt nur die Callbacks, siehe ScheduledAccessMonitor.)

    public func scheduleDailyShield(startHour: Int, startMinute: Int,
                                    endHour: Int, endMinute: Int) throws {
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: startHour, minute: startMinute),
            intervalEnd: DateComponents(hour: endHour, minute: endMinute),
            repeats: true
        )
        try DeviceActivityCenter().startMonitoring(.init("nightShield"), during: schedule)
    }

    public func scheduleUsageLimit(minutes: Int) throws {
        let event = DeviceActivityEvent(
            applications: [],
            categories: [.socialNetworking],
            threshold: DateComponents(minute: minutes)
        )
        try DeviceActivityCenter().startMonitoring(
            .init("usageLimit"),
            during: DeviceActivitySchedule(
                intervalStart: DateComponents(hour: 0, minute: 0),
                intervalEnd: DateComponents(hour: 23, minute: 59),
                repeats: true
            ),
            events: ["limitReached": event]
        )
    }

    public func stopAllSchedules() {
        DeviceActivityCenter().stopMonitoring()
    }
}

// MARK: - React-Native-Bridge (Legacy-Bridge; Registrierung via ScreenTime.m)

import React

@objc(ScreenTime)
@MainActor
public class ScreenTime: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool { true }

    /// Alle Mutationen prüfen zuerst die FamilyControls-Autorisierung.
    /// Ohne Gate könnte jeder JS-Code im App-Prozess die Sperren lautlos aufheben.
    private func isAuthorized() -> Bool {
        AuthorizationCenter.shared.authorizationStatus == .approved
    }

    private func rejectUnauthorized(_ reject: @escaping RCTPromiseRejectBlock) {
        reject("E_UNAUTHORIZED", "FamilyControls nicht autorisiert", nil)
    }

    @objc func authorize(_ resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await ScreenTimeManager.shared.requestAuthorization()
                resolve(true)
            } catch {
                reject("E_AUTH", error.localizedDescription, error)
            }
        }
    }

    @objc func shieldAllSocial(_ resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) {
        guard isAuthorized() else { rejectUnauthorized(reject); return }
        ScreenTimeManager.shared.shield(categories: [.socialNetworking])
        resolve(true)
    }

    @objc func unshield(_ resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        guard isAuthorized() else { rejectUnauthorized(reject); return }
        ScreenTimeManager.shared.unshieldAll()
        resolve(true)
    }

    @objc func status(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
        resolve(["authorized": isAuthorized()])
    }
}
