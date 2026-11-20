// VpnManagerModule.swift
//
// App-Seite des DNS-Blockers: konfiguriert einen NETunnelProviderManager und
// startet/stoppt die PacketTunnelProvider-Extension (targets/packettunnel).
//
// Warum NETunnelProviderManager statt NEVPNManager: nur damit lassen sich
// providerConfiguration (unsere Blocklist) und On-Demand-Regeln setzen, und es
// ist die von Apple empfohlene API für eigene Tunnel-Provider.
//
// Die Blocklist wird als providerConfiguration mitgegeben → die Extension liest
// sie beim startTunnel direkt. Dadurch braucht der DNS-Layer KEINE App Group
// und ist unabhängig von der FamilyControls-Freigabe baubar.

import ExpoModulesCore
import NetworkExtension

public class VpnManagerModule: Module {
    private static let providerBundleId = "com.meister.blockphone.PacketTunnelProvider"

    public func definition() -> ModuleDefinition {
        Name("VpnManager")

        AsyncFunction("start") { (domains: [String], allowlist: [String], mode: String, ads: Bool) async throws -> Bool in
            try await VpnService.shared.start(blocklist: domains, allowlist: allowlist, mode: mode, ads: ads)
            return true
        }

        AsyncFunction("stop") { () async throws -> Bool in
            try await VpnService.shared.stop()
            return true
        }

        AsyncFunction("status") { () async throws -> [String: Any] in
            try await VpnService.shared.status()
        }

        AsyncFunction("setBlocklist") { (domains: [String]) async throws -> Bool in
            try await VpnService.shared.updateBlocklist(domains)
            return true
        }
    }
}

// MARK: - Kern-Logik

final class VpnService {
    static let shared = VpnService()
    private init() {}

    private static let providerBundleId = "com.meister.blockphone.PacketTunnelProvider"

    /// Bis 50k Einträge, je max. 253 Zeichen — symmetrisch zur Extension.
    private func clean(_ domains: [String]) -> [String] {
        Array(
            domains
                .prefix(50_000)
                .map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                            .trimmingCharacters(in: CharacterSet(charactersIn: ".")) }
                .filter { !$0.isEmpty && $0.count <= 253 }
        )
    }

    private func loadAll() async throws -> [NETunnelProviderManager] {
        try await withCheckedThrowingContinuation { cont in
            NETunnelProviderManager.loadAllFromPreferences { managers, error in
                if let error = error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume(returning: managers ?? [])
                }
            }
        }
    }

    /// Holt den bestehenden Manager (sonst neu) — verhindert doppelte VPN-Profile.
    private func manager() async throws -> NETunnelProviderManager {
        let all = try await loadAll()
        if let existing = all.first(where: {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier
                == Self.providerBundleId
        }) {
            return existing
        }
        return NETunnelProviderManager()
    }

    private func save(_ mgr: NETunnelProviderManager) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            mgr.saveToPreferences { error in
                if let error = error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
        // Nach dem Speichern neu laden, sonst ist `connection` nicht nutzbar.
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            mgr.loadFromPreferences { error in
                if let error = error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    func start(blocklist: [String], allowlist: [String] = [], mode: String = "blocklist", ads: Bool = false) async throws {
        let mgr = try await manager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.providerBundleId
        proto.serverAddress = "Blockphone DNS Filter"
        proto.providerConfiguration = [
            "blocklist": clean(blocklist),
            "allowlist": clean(allowlist),
            "mode": mode == "allowlist" ? "allowlist" : "blocklist",
            // Werbe-/Tracker-Liste liegt als Bundle-Ressource im Tunnel (adblock.json).
            "ads": ads,
        ]
        proto.disconnectOnSleep = false

        mgr.protocolConfiguration = proto
        mgr.localizedDescription = "Blockphone"
        mgr.isEnabled = true
        mgr.isOnDemandEnabled = true
        mgr.onDemandRules = [NEOnDemandRuleConnect()]

        try await save(mgr)
        try mgr.connection.startVPNTunnel()
    }

    func stop() async throws {
        let all = try await loadAll()
        for mgr in all {
            guard (mgr.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier
                    == Self.providerBundleId else { continue }
            mgr.isOnDemandEnabled = false
            mgr.connection.stopVPNTunnel()
            try? await save(mgr)
        }
    }

    /// Blocklist im laufenden Tunnel tauschen (Tunnel neu starten).
    ///
    /// Hinweis: die App steuert den Tunnel heute über `start(...)` (voller
    /// Neustart mit kompletter Konfiguration); `setDnsBlocklist` in lib/vpn.ts
    /// hat aktuell keinen Aufrufer. Diese Funktion bleibt als Bridge-Vertrag
    /// erhalten und muss deshalb auch allein korrekt sein — inklusive mode und
    /// allowlist, sonst kippt "Internet aus" beim Tausch still auf blocklist.
    func updateBlocklist(_ domains: [String]) async throws {
        let all = try await loadAll()
        guard let mgr = all.first(where: {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier
                == Self.providerBundleId
        }) else { return }

        if let proto = mgr.protocolConfiguration as? NETunnelProviderProtocol {
            // Bestehende Konfiguration ERHALTEN: nur die Blocklist ersetzen.
            // Vorher wurde sie überschrieben (["blocklist": …, "ads": …]) —
            // damit fielen allowlist und mode weg und "Internet aus"
            // (mode=allowlist) kippte still auf blocklist zurück: die Sperre
            // war danach wirkungslos, ohne Fehlermeldung.
            var cfg = proto.providerConfiguration ?? [:]
            cfg["blocklist"] = clean(domains)
            proto.providerConfiguration = cfg
            mgr.protocolConfiguration = proto
            try await save(mgr)
        }
        // Neustart nur, wenn der Tunnel läuft oder gerade hochkommt. Auch
        // .disconnecting/.reasserting müssen hier rein: sonst würde die neue
        // Liste gespeichert, der laufende Tunnel behielte aber die alte.
        let running = mgr.connection.status
        guard running != .disconnected, running != .invalid else { return }

        mgr.connection.stopVPNTunnel()
        // Auf .disconnected warten: startVPNTunnel() während .disconnecting wirft
        // (NEVPNErrorDomain), der Tunnel bliebe dann aus. Das Profil hat
        // isOnDemandEnabled=true, deshalb ist ein harter Neustart hier der
        // einzige Weg, die neue Liste wirklich zu laden.
        var now = running
        for _ in 0..<20 {
            now = mgr.connection.status
            if now == .disconnected || now == .invalid { break }
            // `try await` (kein `try?`): Task-Abbruch bricht ab, statt ohne
            // Delay durchzudrehen und trotzdem zu starten.
            try await Task.sleep(nanoseconds: 100_000_000)  // 100 ms, max 2 s
        }
        guard now == .disconnected || now == .invalid else {
            // Nicht trotzdem starten: der Fehler ist die ehrlichere Auskunft als
            // ein Tunnel, der still mit der alten Blocklist weiterläuft.
            throw NSError(
                domain: "Blockphone.VpnManager",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Tunnel reagiert nicht auf Stopp — Blocklist nicht übernommen"]
            )
        }
        try mgr.connection.startVPNTunnel()
    }

    func status() async throws -> [String: Any] {
        let all = try await loadAll()
        guard let mgr = all.first(where: {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier
                == Self.providerBundleId
        }) else {
            return ["connected": false, "configured": false, "status": "notConfigured"]
        }
        let st = mgr.connection.status
        return [
            "connected": st == .connected,
            "configured": true,
            "status": Self.describe(st),
        ]
    }

    private static func describe(_ s: NEVPNStatus) -> String {
        switch s {
        case .invalid: return "invalid"
        case .disconnected: return "disconnected"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .reasserting: return "reasserting"
        case .disconnecting: return "disconnecting"
        @unknown default: return "unknown"
        }
    }
}
