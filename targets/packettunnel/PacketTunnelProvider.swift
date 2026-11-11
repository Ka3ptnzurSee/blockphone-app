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
    private func loadRules() -> (blocklist: [String], allowlist: [String], mode: String) {
        if let proto = protocolConfiguration as? NETunnelProviderProtocol,
           let cfg = proto.providerConfiguration {
            let block = cfg["blocklist"] as? [String] ?? []
            let allow = cfg["allowlist"] as? [String] ?? []
            let mode = cfg["mode"] as? String ?? "blocklist"
            if !block.isEmpty || !allow.isEmpty || mode == "allowlist" {
                return (block, allow, mode)
            }
        }
        return (BlocklistStore.load(), [], "blocklist")
    }

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        let rules = loadRules()

        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.8.0.1")
        let ipv4 = NEIPv4Settings(addresses: ["10.8.0.1"], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = [NEIPv4Route(destinationAddress: "10.8.0.1", subnetMask: "255.255.255.255")]
        settings.ipv4Settings = ipv4
        settings.dnsSettings = NEDNSSettings(servers: ["10.8.0.1"])
        settings.mtu = 1280

        let f = DnsFilter(blocklist: rules.blocklist, allowlist: rules.allowlist, mode: rules.mode)
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
