// DnsFilter.swift
//
// DNS-Sinkhole-Filter für die Packet-Tunnel-Ebene von Blockphone.
//
//   - Parst rohe IPv4/UDP/DNS-Pakete aus dem TUN (NEPacketTunnelFlow)
//   - Geblockte Domain (Suffix-Match) → NXDOMAIN-Antwort (synchron, schnell)
//   - Sonst → Weiterleitung an Upstream via DoT (DNS-over-TLS, RFC 7858)
//     über NWConnection → TLS-authentifiziert, kein Response-Spoofing möglich
//   - Antwort wird als fertiges IP/UDP/DNS-Paket zurückgegeben
//
// DoT statt nacktem UDP-DNS ist der eigentliche Anti-Spoofing-Schutz: Ein
// On-Path-Angreifer kann Source-Addr/TXID von UDP trivial fälschen, nicht aber
// die TLS-Serverauthentifizierung (Zertifikat für cloudflare-dns.com gegen den
// System-Trust-Store). Entspricht Freedoms verschlüsseltem Upstream.

import Foundation
import Network
import Security

final class DnsFilter {
    struct Request {
        let srcIp: [UInt8]     // Quell-IP des Clients (im TUN)
        let dstIp: [UInt8]     // Ziel-IP (= 10.8.0.1)
        let srcPort: UInt16
        let dstPort: UInt16    // 53
        let dnsData: Data      // vollständige, validierte DNS-Anfrage (≥ 12 Bytes)
        let name: String       // QNAME, lowercased
        let question: Data     // NUR die Question-Section (Name+QTYPE+QCLASS), ohne EDNS-OPT
    }

    private final class QueryState {
        var finished = false
        var timeout: DispatchWorkItem?
    }

    private let blocklist: Set<String>
    private let queue = DispatchQueue(label: "blockphone.dot")

    private let dotServer = "1.1.1.1"          // IP-Literal → keine DNS-Auflösung nötig
    private let dotPort: UInt16 = 853
    private let plainServer = "1.1.1.1"   // UDP-Fallback
    private let plainPort: UInt16 = 53
    private let dotSni = "cloudflare-dns.com"  // SNI für Zertifikat-Validierung

    // Ressourcen-Begrenzung: max. 16 gleichzeitige DoT-Verbindungen.
    // Bei Überlast wird gedroppt (der DNS-Client wiederholt die Anfrage).
    private let semaphore = DispatchSemaphore(value: 16)
    private let connLock = NSLock()
    // NWConnection ist nicht Hashable → über ObjectIdentifier tracken.
    private var liveConnections: [ObjectIdentifier: NWConnection] = [:]

    /// "blocklist" = nur die gelisteten Domains sperren.
    /// "allowlist" = ALLES sperren außer den gelisteten Domains (= Internet aus).
    private let mode: String
    private let allowlist: Set<String>

    init(blocklist: [String], allowlist: [String] = [], mode: String = "blocklist") {
        self.blocklist = Set(Self.clean(blocklist))
        self.allowlist = Set(Self.clean(allowlist))
        self.mode = mode == "allowlist" ? "allowlist" : "blocklist"
    }

    private static func clean(_ domains: [String]) -> [String] {
        domains
            .map { $0.lowercased()
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: ".")) }
            .filter { !$0.isEmpty }
    }

    /// Suffix-Match: "www.instagram.com" trifft "instagram.com".
    private static func matches(_ name: String, in set: Set<String>) -> Bool {
        var parts = name.split(separator: ".").map(String.init)
        while !parts.isEmpty {
            if set.contains(parts.joined(separator: ".")) { return true }
            parts.removeFirst()
        }
        return false
    }

    /// Bricht alle laufenden DoT-Verbindungen ab (wird von `stopTunnel` aufgerufen).
    func stop() {
        connLock.lock()
        let conns = liveConnections
        liveConnections.removeAll()
        connLock.unlock()
        conns.values.forEach { $0.cancel() }
    }

    // MARK: - Paket parsen (IPv4/UDP/DNS-Anfrage)

    func parse(packet: Data) -> Request? {
        let b = [UInt8](packet)
        guard b.count >= 20 else { return nil }

        guard (b[0] >> 4) == 4 else { return nil }          // nur IPv4
        let ihl = Int(b[0] & 0x0F) * 4
        guard ihl >= 20, b.count >= ihl + 8 else { return nil }
        guard b[9] == 17 else { return nil }                 // nur UDP

        let srcIp = Array(b[12..<16])
        let dstIp = Array(b[16..<20])
        let srcPort = UInt16(b[ihl]) << 8 | UInt16(b[ihl + 1])
        let dstPort = UInt16(b[ihl + 2]) << 8 | UInt16(b[ihl + 3])
        let dnsData = Data(b[(ihl + 8)...])

        guard dstPort == 53 else { return nil }              // nur DNS-Anfragen
        guard let (name, questionEnd) = parseQueryName(dnsData) else { return nil }

        return Request(srcIp: srcIp, dstIp: dstIp,
                       srcPort: srcPort, dstPort: dstPort,
                       dnsData: dnsData, name: name,
                       question: dnsData.subdata(in: 12..<questionEnd))
    }

    // MARK: - Blocklist

    func isBlocked(_ name: String) -> Bool {
        if mode == "allowlist" {
            // Internet aus: alles sperren, was nicht ausdrücklich erlaubt ist.
            return !Self.matches(name, in: allowlist)
        }
        return Self.matches(name, in: blocklist)
    }

    /// Synchron: NXDOMAIN-Antwort (komplettes IP/UDP/DNS-Paket) für geblockte Domain.
    func blockedEnvelope(for req: Request) -> Data {
        var dns = Data()
        dns.appendUInt16(UInt16(req.dnsData[0]) << 8 | UInt16(req.dnsData[1]))  // ID
        dns.appendUInt16(0x8183)   // QR=1, RD=1, RA=1, RCODE=3 (NXDOMAIN)
        dns.appendUInt16(1)        // QDCOUNT
        dns.appendUInt16(0)        // ANCOUNT
        dns.appendUInt16(0)        // NSCOUNT
        dns.appendUInt16(0)        // ARCOUNT
        dns.append(req.question)   // nur Name+QTYPE+QCLASS (kein EDNS-OPT)
        return envelope(for: req, dnsAnswer: dns)
    }

    /// Asynchron: DoT-Weiterleitung mit UDP-Fallback, dann komplettes
    /// Antwort-Paket via Callback.
    ///
    /// Wichtig: Wenn DoT (Port 853) im Netz geblockt ist, darf der Tunnel nicht
    /// das gesamte DNS verschlucken — sonst hat das Gerät gar kein Internet
    /// mehr. Deshalb nach einem DoT-Fehlschlag einmal klassisch per UDP fragen.
    func forward(_ req: Request, completion: @escaping (Data?) -> Void) {
        // Überlast → droppen statt unbegrenzt Verbindungen aufzubauen.
        guard semaphore.wait(timeout: .now()) == .success else {
            completion(nil)
            return
        }
        forwardDoT(req) { [weak self] answer in
            guard let self = self else { return }
            if let answer = answer {
                self.semaphore.signal()
                completion(answer)
                return
            }
            self.forwardUDP(req) { udpAnswer in
                self.semaphore.signal()
                completion(udpAnswer)
            }
        }
    }

    /// Klassisches DNS über UDP/53 (Fallback, unverschlüsselt).
    private func forwardUDP(_ req: Request, completion: @escaping (Data?) -> Void) {
        let conn = NWConnection(host: NWEndpoint.Host(plainServer),
                                port: NWEndpoint.Port(rawValue: plainPort)!,
                                using: .udp)
        let state = QueryState()

        let finish: (Data?) -> Void = { [weak self] result in
            guard !state.finished else { return }
            state.finished = true
            state.timeout?.cancel()
            state.timeout = nil
            conn.stateUpdateHandler = nil
            conn.cancel()
            self?.untrack(conn)
            completion(result)
        }

        state.timeout = DispatchWorkItem { conn.cancel() }
        queue.asyncAfter(deadline: .now() + 3, execute: state.timeout!)

        track(conn)
        conn.stateUpdateHandler = { s in
            switch s {
            case .failed, .cancelled:
                finish(nil)
            default:
                break
            }
        }

        conn.start(queue: queue)
        conn.send(content: req.dnsData, completion: .contentProcessed { error in
            if error != nil { finish(nil); return }
            conn.receiveMessage { [weak self] data, _, _, error in
                guard let self = self, error == nil, let data, data.count >= 12,
                      data[0] == req.dnsData[0], data[1] == req.dnsData[1],
                      (data[2] & 0x80) != 0 else { finish(nil); return }
                finish(self.envelope(for: req, dnsAnswer: data))
            }
        })
    }

    /// DoT-Weiterleitung (verschlüsselt, Port 853).
    private func forwardDoT(_ req: Request, completion: @escaping (Data?) -> Void) {
        let tlsOptions = NWProtocolTLS.Options()
        dotSni.withCString { cstr in
            sec_protocol_options_set_tls_server_name(tlsOptions.securityProtocolOptions, cstr)
        }
        sec_protocol_options_set_min_tls_protocol_version(tlsOptions.securityProtocolOptions, .TLSv12)
        let params = NWParameters(tls: tlsOptions)

        let conn = NWConnection(host: NWEndpoint.Host(dotServer),
                                port: NWEndpoint.Port(rawValue: dotPort)!,
                                using: params)
        let state = QueryState()

        let finish: (Data?) -> Void = { [weak self] result in
            guard !state.finished else { return }
            state.finished = true
            state.timeout?.cancel()
            state.timeout = nil                    // Timeout-WorkItem → conn freigeben
            conn.stateUpdateHandler = nil          // Retain-Cycle brechen (conn ↔ finish)
            conn.cancel()                          // Verbindung in JEDEM Pfad schließen (idempotent)
            self?.untrack(conn)
            completion(result)
        }

        // Timeout: hängende Verbindung nach 4s abbrechen (Client wiederholt).
        state.timeout = DispatchWorkItem { conn.cancel() }
        queue.asyncAfter(deadline: .now() + 4, execute: state.timeout!)

        track(conn)
        conn.stateUpdateHandler = { s in
            switch s {
            case .failed, .cancelled:
                finish(nil)
            default:
                break
            }
        }

        // DoT-Framing: 2-Byte-Längenpräfix + DNS-Nachricht (RFC 7858)
        var framed = Data()
        framed.appendUInt16(UInt16(req.dnsData.count))
        framed.append(req.dnsData)

        conn.start(queue: queue)
        conn.send(content: framed, completion: .contentProcessed { error in
            if error != nil { finish(nil); return }
            conn.receive(minimumIncompleteLength: 2, maximumLength: 2) { data, _, _, error in
                guard error == nil, let data, data.count == 2 else { finish(nil); return }
                let len = Int(UInt16(data[0]) << 8 | UInt16(data[1]))
                // Obergrenze: IP(20) + UDP(8) + len ≤ 65535 → len ≤ 65507.
                // Verhindert UInt16-Overflow-Trap in envelope() (8+len bzw. 28+len).
                guard len >= 12, len <= 0xFFFF - 28 else { finish(nil); return }
                conn.receive(minimumIncompleteLength: len, maximumLength: len) { [weak self] body, _, _, error in
                    guard let self, error == nil, let body, body.count == len,
                          body[0] == req.dnsData[0], body[1] == req.dnsData[1],
                          (body[2] & 0x80) != 0 else { finish(nil); return }
                    finish(self.envelope(for: req, dnsAnswer: body))
                }
            }
        })
    }

    // MARK: - Connection-Tracking

    private func track(_ conn: NWConnection) {
        connLock.lock(); liveConnections[ObjectIdentifier(conn)] = conn; connLock.unlock()
    }
    private func untrack(_ conn: NWConnection) {
        connLock.lock(); liveConnections.removeValue(forKey: ObjectIdentifier(conn)); connLock.unlock()
    }

    // MARK: - DNS-Anfrage parsen (QNAME + Validierung)

    private func parseQueryName(_ d: Data) -> (name: String, questionEnd: Int)? {
        let b = [UInt8](d)
        guard b.count >= 12 else { return nil }
        let flags = UInt16(b[2]) << 8 | UInt16(b[3])
        // Nur echte Standard-Queries: QR=0, Opcode=0, QDCOUNT=1
        guard (flags & 0x8000) == 0 else { return nil }
        guard (flags & 0x7800) == 0 else { return nil }
        guard UInt16(b[4]) << 8 | UInt16(b[5]) == 1 else { return nil }

        var off = 12
        var labels: [String] = []
        var nameLen = 0
        while off < b.count {
            let len = Int(b[off])
            if len == 0 { off += 1; break }                   // Root-Label
            if len > 63 || off + 1 + len > b.count { return nil }
            labels.append(String(bytes: b[(off + 1)..<(off + 1 + len)], encoding: .utf8) ?? "")
            nameLen += 1 + len
            guard nameLen <= 253 else { return nil }         // RFC: Name ≤ 253 Oktetts
            off += 1 + len
        }
        guard off + 4 <= b.count else { return nil }         // QTYPE + QCLASS
        return (labels.joined(separator: ".").lowercased(), off + 4)
    }

    // MARK: - IP/UDP-Hülle mit korrekten Checksummen

    private func envelope(for req: Request, dnsAnswer: Data) -> Data {
        var udp = Data()
        udp.appendUInt16(req.dstPort)                         // Quellport = 53
        udp.appendUInt16(req.srcPort)                         // Zielport = Original-Quellport
        udp.appendUInt16(UInt16(8 + dnsAnswer.count))
        udp.appendUInt16(0)                                   // Checksumme (Platzhalter)

        var udpBytes = [UInt8](udp)
        udpBytes.append(contentsOf: [UInt8](dnsAnswer))

        // UDP-Checksumme über Pseudo-Header (RFC 768) + UDP
        var pseudo: [UInt8] = []
        pseudo.append(contentsOf: req.dstIp)                  // src = Tunnel-IP
        pseudo.append(contentsOf: req.srcIp)                  // dst = Client-IP
        pseudo.append(0)
        pseudo.append(17)                                     // UDP
        let udpLen = udpBytes.count
        pseudo.append(UInt8((udpLen >> 8) & 0xFF))
        pseudo.append(UInt8(udpLen & 0xFF))
        pseudo.append(contentsOf: udpBytes)
        let cs = checksum(pseudo)
        udpBytes[6] = UInt8((cs >> 8) & 0xFF)
        udpBytes[7] = UInt8(cs & 0xFF)

        // IPv4-Header (20 Bytes, kein Fragment)
        var ip = [UInt8](repeating: 0, count: 20)
        ip[0] = 0x45
        let totalLen = 20 + udpBytes.count
        ip[2] = UInt8((totalLen >> 8) & 0xFF)
        ip[3] = UInt8(totalLen & 0xFF)
        ip[8] = 64                                            // TTL
        ip[9] = 17                                            // UDP
        ip[12] = req.dstIp[0]; ip[13] = req.dstIp[1]; ip[14] = req.dstIp[2]; ip[15] = req.dstIp[3]
        ip[16] = req.srcIp[0]; ip[17] = req.srcIp[1]; ip[18] = req.srcIp[2]; ip[19] = req.srcIp[3]
        let ipCs = checksum(ip)
        ip[10] = UInt8((ipCs >> 8) & 0xFF)
        ip[11] = UInt8(ipCs & 0xFF)

        var out = Data(ip)
        out.append(contentsOf: udpBytes)
        return out
    }

    /// Internet-Checksumme (RFC 1071) mit Carry-Folding.
    private func checksum(_ buf: [UInt8]) -> UInt16 {
        var sum: UInt32 = 0
        var i = 0
        while i < buf.count {
            let hi = UInt32(buf[i]) << 8
            let lo: UInt32 = (i + 1 < buf.count) ? UInt32(buf[i + 1]) : 0
            sum += hi + lo
            i += 2
        }
        while sum >> 16 != 0 {
            sum = (sum & 0xFFFF) + (sum >> 16)
        }
        return UInt16(~sum & 0xFFFF)
    }
}

fileprivate extension Data {
    mutating func appendUInt16(_ v: UInt16) {
        self.append(UInt8((v >> 8) & 0xFF))
        self.append(UInt8(v & 0xFF))
    }
}
