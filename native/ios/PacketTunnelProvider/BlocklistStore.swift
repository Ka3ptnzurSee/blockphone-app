// BlocklistStore.swift
//
// Lädt/speichert die Domain-Blocklist für den DNS-Filter.
// Der Container (App Group) wird mit der Haupt-App geteilt → die App schreibt
// die Liste (VpnManagerBridge.setBlocklist), die VPN-Extension liest sie beim
// Tunnel-Start. Schreibt UND liest symmetrisch gecappt/validiert.

import Foundation

enum BlocklistStore {
    static let groupId = "group.com.meister.blockphone"
    static let fileName = "dns_blocklist.json"

    /// Extension-Memory ist eng (~15 MB) → Dateigröße und Einträge cappen.
    private static let maxFileSize = 2 * 1024 * 1024   // 2 MB
    private static let maxEntries = 50_000
    private static let maxDomainLength = 253

    static func load() -> [String] {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else {
            return []
        }
        let url = dir.appendingPathComponent(fileName)
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let sizeNum = attrs[.size] as? NSNumber,
              Int(sizeNum.intValue) <= maxFileSize,
              let data = try? Data(contentsOf: url),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String] else {
            return []
        }
        let cleaned = clean(arr)
        return cleaned
    }

    static func save(_ domains: [String]) {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else { return }
        let url = dir.appendingPathComponent(fileName)
        let cleaned = clean(domains)
        guard let data = try? JSONSerialization.data(withJSONObject: cleaned) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Symmetrische Validierung für Lese- UND Schreibpfad.
    private static func clean(_ domains: [String]) -> [String] {
        let result = domains
            .prefix(maxEntries)
            .map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                        .trimmingCharacters(in: CharacterSet(charactersIn: ".")) }
            .filter { !$0.isEmpty && $0.count <= maxDomainLength }
        return Array(result)
    }
}
