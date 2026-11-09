// VpnManager.swift
//
// Haupt-App-Seite des DNS-Blockers: konfiguriert NEVPNManager und startet/stoppt
// den PacketTunnelProvider. Enthält außerdem die React-Native-Bridge
// (@objc(VpnManager)) für NativeModules.VpnManager.
//
// Vorbild: Freedoms VPN-Start-Flow (NEVPNManager + NETunnelProviderProtocol +
// providerBundleIdentifier auf den PacketTunnelProvider).

import Foundation
import NetworkExtension
import React

/// Kern-Logik (kein RN-Bezug).
@MainActor
public final class VpnService {
    public static let shared = VpnService()
    private init() {}

    private static let extensionBundleId = "com.meister.blockphone.PacketTunnelProvider"

    /// Konfiguriert und startet den DNS-Blocking-Tunnel.
    public func start() async throws {
        let mgr = NEVPNManager.shared()
        try await mgr.loadFromPreferences()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.extensionBundleId
        proto.serverAddress = "Blockphone DNS Filter"
        proto.providerConfiguration = ["upstream": "1.1.1.1"]
        proto.disconnectOnSleep = false

        mgr.protocolConfiguration = proto
        mgr.localizedDescription = "Blockphone Blocker"
        mgr.isEnabled = true
        mgr.isOnDemandEnabled = true

        try await mgr.saveToPreferences()
        try mgr.connection.startVPNTunnel()
    }

    public func stop() {
        NEVPNManager.shared().connection.stopVPNTunnel()
    }

    public func status() -> [String: Any] {
        let c = NEVPNManager.shared().connection
        return ["connected": c.status == .connected]
    }
}

/// RN-Bridge: NativeModules.VpnManager
@objc(VpnManager)
@MainActor
public class VpnManagerBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { true }

    @objc func start(_ resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await VpnService.shared.start()
                resolve(true)
            } catch {
                reject("E_VPN", error.localizedDescription, error)
            }
        }
    }

    @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
        VpnService.shared.stop()
        resolve(true)
    }

    @objc func status(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
        resolve(VpnService.shared.status())
    }

    @objc func setBlocklist(_ domains: [String],
                            resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
        BlocklistStore.save(domains)
        resolve(true)
    }
}
