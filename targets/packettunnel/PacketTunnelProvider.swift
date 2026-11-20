// PacketTunnelProvider.swift
//
// Netzwerk-Extension (Packet Tunnel) für echtes, App-übergreifendes DNS-Blocking.
//
// Architektur (analog zu Freedoms PacketTunnelProvider + AGDnsProxy, nur ohne
// AdGuard-Binary):
//   - Der Tunnel legt ein virtuelles Interface 10.8.0.1/32 an.
//   - NEDNSSettings zeigt ALLE DNS-Abfragen des Systems auf 10.8.0.1.
//   - includedRoutes = nur die /32 des DNS-Servers → sonstiger Traffic läuft
//     ungefiltert direkt raus (kein Default-Route → kein Traffic-Routing nötig).
//   - readLoop liest rohe IP-Pakete; geblockte Domains werden synchron mit
//     NXDOMAIN beantwortet, alle anderen async via DoT (siehe DnsFilter).
//
// Blocklist-Quelle: `providerConfiguration["blocklist"]` (von der Haupt-App beim
// startVPNTunnel mitgegeben). Das braucht KEINE App Group — dadurch ist der
// DNS-Layer unabhängig von der FamilyControls-Freigabe baubar. Fallback:
// BlocklistStore (App Group), falls vorhanden.
//
// Entitlements (Extension-Target):
//   com.apple.developer.networking.networkextension = ["packet-tunnel-provider"]
//   com.apple.developer.networking.vpn.api = ["allow-vpn"]

import NetworkExtension
import Darwin

class PacketTunnelProvider: NEPacketTunnelProvider {
    private var filter: DnsFilter?

    // `running` wird von mehreren Queues (readLoop-Callback + stopTunnel) berührt.
    private let stateLock = NSLock()
    private var _running = false
    private var running: Bool {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _running }
        set { stateLock.lock(); defer { stateLock.unlock() }; _running = newValue }
    }

    /// Regeln aus der Provider-Konfiguration (bevorzugt) oder App Group.
    /// mode = "blocklist" (nur Gelistetes sperren) oder "allowlist" (alles außer
    /// Gelistetem sperren = Internet aus).
    /// ads = Werbe-/Tracker-Liste aus dem Extension-Bundle dazunehmen.
    private func loadRules() -> (blocklist: [String], allowlist: [String], mode: String, ads: Bool) {
        if let proto = protocolConfiguration as? NETunnelProviderProtocol,
           let cfg = proto.providerConfiguration {
            let block = cfg["blocklist"] as? [String] ?? []
            let allow = cfg["allowlist"] as? [String] ?? []
            let mode = cfg["mode"] as? String ?? "blocklist"
            let ads = (cfg["ads"] as? Bool) ?? ((cfg["ads"] as? NSNumber)?.boolValue ?? false)
            // WICHTIG: ads mitprüfen — sonst würde ein reiner Werbeblocker
            // (ohne Plattformen) hier durchfallen und still auf die alte
            // BlocklistStore-Liste zurückfallen.
            if !block.isEmpty || !allow.isEmpty || mode == "allowlist" || ads {
                return (block, allow, mode, ads)
            }
        }
        return (BlocklistStore.load(), [], "blocklist", false)
    }

    /// Werbe-/Tracker-Domains: als Ressource im Extension-Bundle (adblock.json,
    /// erzeugt von scripts/build-adblocklist.mjs). Bewusst NICHT über
    /// providerConfiguration — 41k Einträge sprengen die VPN-Plist; als
    /// Bundle-Ressource ist die Liste ausserdem offline aktuell.
    private static func loadAdDomains() -> [String] {
        guard let url = Bundle.main.url(forResource: "adblock", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [String]
        else { return [] }
        return arr
    }

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        let rules = loadRules()
        var blocklist = rules.blocklist
        var adsCount = 0
        if rules.ads && rules.mode != "allowlist" {
            let ads = Self.loadAdDomains()
            adsCount = ads.count
            if !ads.isEmpty { blocklist += ads }
        }
        // Wenn der Nutzer den Werbeblocker einschaltet, die Liste aber nicht im
        // Extension-Bundle liegt, blockt der Tunnel NICHTS und niemand sieht
        // warum. Deshalb hier laut ins Gerätelog (Console.app, Subsystem
        // com.meister.blockphone) statt still leer weiterzulaufen.
        NSLog("[Blockphone] Tunnel-Start: ads=%d, adblock-Ressource=%d Domains, blocklist=%d, allowlist=%d, mode=%@",
              rules.ads ? 1 : 0, adsCount, blocklist.count, rules.allowlist.count, rules.mode)

        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.8.0.1")
        let ipv4 = NEIPv4Settings(addresses: ["10.8.0.1"], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = [NEIPv4Route(destinationAddress: "10.8.0.1", subnetMask: "255.255.255.255")]
        settings.ipv4Settings = ipv4
        let dns = NEDNSSettings(servers: ["10.8.0.1"])
        // matchDomains ist hier PFLICHT, nicht optional: Der Tunnel ist bewusst
        // NICHT die Default-Route (includedRoutes = nur 10.8.0.1/32). Apple:
        // „This property is used to create a 'split DNS' configuration … Hosts
        // not in one of the domains in this list are resolved using the system's
        // default resolver. If [matchDomains] contains the empty string it
        // becomes the default domain. This is how a split-tunnel configuration
        // can direct all DNS queries first to the VPN DNS servers.“
        // Ohne die leere Domain gingen alle Queries am Tunnel vorbei → der
        // Werbeblocker blockte nachweislich 0 Domains.
        dns.matchDomains = [""]
        settings.dnsSettings = dns
        settings.mtu = 1280

        let f = DnsFilter(blocklist: blocklist, allowlist: rules.allowlist, mode: rules.mode)
        filter = f

        setTunnelNetworkSettings(settings) { [weak self] error in
            if let error = error {
                completionHandler(error)
                return
            }
            self?.running = true
            self?.readLoop(filter: f)
            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        running = false
        filter?.stop()
        filter = nil
        completionHandler()
    }

    private func readLoop(filter: DnsFilter) {
        guard running else { return }
        packetFlow.readPackets { [weak self] packets, _ in
            guard let self = self, self.running else { return }

            var immediate: [Data] = []
            for pkt in packets {
                guard let req = filter.parse(packet: pkt) else { continue }
                if filter.isBlocked(req.name) {
                    immediate.append(filter.blockedEnvelope(for: req))
                } else {
                    filter.forward(req) { [weak self] answer in
                        guard let self = self, self.running, let answer else { return }
                        self.packetFlow.writePackets([answer], withProtocols: [NSNumber(value: AF_INET)])
                    }
                }
            }

            if !immediate.isEmpty {
                self.packetFlow.writePackets(immediate,
                                             withProtocols: immediate.map { _ in NSNumber(value: AF_INET) })
            }
            self.readLoop(filter: filter)
        }
    }
}
