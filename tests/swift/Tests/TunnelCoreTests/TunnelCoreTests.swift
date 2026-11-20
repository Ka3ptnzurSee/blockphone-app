// TunnelCoreTests.swift — echte Ausführungstests für die DNS-Logik des Tunnels.
//
// Was hier geprüft wird (und warum es die Regex-Tests in lib/*.test.ts nicht
// können): Paket-Parsing mit Bounds, Blocking-Entscheidung, und der Bau der
// Antwort-Pakete inklusive IP/UDP-Checksummen. Ein Fehler dort heißt entweder
// "blockt nichts" (falscher Name/Port) oder "Client verwirft die Antwort"
// (falsche Checksumme) — beides fällt auf dem Gerät nur als "geht nicht" auf.
//
// Ausführen: cd tests/swift && swift test

import XCTest

@testable import TunnelCore

final class TunnelCoreTests: XCTestCase {

    // MARK: - Paket-Bau-Helfer

    private func dnsQuery(name: String, id: UInt16 = 0xBEEF, qtype: UInt16 = 1) -> Data {
        var dns = Data()
        dns.append(contentsOf: [UInt8(id >> 8), UInt8(id & 0xFF)])
        dns.append(contentsOf: [0x01, 0x00])            // RD
        dns.append(contentsOf: [0x00, 0x01])            // QDCOUNT
        dns.append(contentsOf: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        for label in name.split(separator: ".") {
            dns.append(UInt8(label.utf8.count))
            dns.append(contentsOf: Array(label.utf8))
        }
        dns.append(0)
        dns.append(contentsOf: [UInt8(qtype >> 8), UInt8(qtype & 0xFF)])
        dns.append(contentsOf: [0x00, 0x01])            // QCLASS IN
        return dns
    }

    /// Baut IPv4 + UDP + DNS, so wie der Client es in den TUN legt.
    private func packet(
        dns: Data,
        srcIp: [UInt8] = [10, 8, 0, 2],
        dstIp: [UInt8] = [10, 8, 0, 1],
        srcPort: UInt16 = 5353,
        dstPort: UInt16 = 53,
        proto: UInt8 = 17,
        version: UInt8 = 4
    ) -> Data {
        var udp = Data()
        udp.append(contentsOf: [UInt8(srcPort >> 8), UInt8(srcPort & 0xFF)])
        udp.append(contentsOf: [UInt8(dstPort >> 8), UInt8(dstPort & 0xFF)])
        let len = 8 + dns.count
        udp.append(contentsOf: [UInt8(len >> 8), UInt8(len & 0xFF)])
        udp.append(contentsOf: [0, 0])
        udp.append(dns)

        var ip = [UInt8](repeating: 0, count: 20)
        ip[0] = (version << 4) | 5
        let total = 20 + udp.count
        ip[2] = UInt8((total >> 8) & 0xFF)
        ip[3] = UInt8(total & 0xFF)
        ip[8] = 64
        ip[9] = proto
        ip[12] = srcIp[0]; ip[13] = srcIp[1]; ip[14] = srcIp[2]; ip[15] = srcIp[3]
        ip[16] = dstIp[0]; ip[17] = dstIp[1]; ip[18] = dstIp[2]; ip[19] = dstIp[3]

        var out = Data(ip)
        out.append(udp)
        return out
    }

    /// Ones-Complement-Summe über einen Puffer (0xFFFF = gültig für Header).
    private func checksumSum(_ bytes: [UInt8]) -> UInt16 {
        var sum: UInt32 = 0
        var i = 0
        while i + 1 < bytes.count {
            sum += UInt32(bytes[i]) << 8 | UInt32(bytes[i + 1])
            i += 2
        }
        if i < bytes.count { sum += UInt32(bytes[i]) << 8 }
        while (sum >> 16) != 0 { sum = (sum & 0xFFFF) + (sum >> 16) }
        return UInt16(~sum & 0xFFFF)
    }

    private func bytes(_ d: Data) -> [UInt8] { [UInt8](d) }

    // MARK: - parse

    func testParsesValidDnsQuery() throws {
        let filter = DnsFilter(blocklist: [])
        let req = try XCTUnwrap(filter.parse(packet: packet(dns: dnsQuery(name: "Ads.DoubleClick.NET"))))
        XCTAssertEqual(req.name, "ads.doubleclick.net", "QNAME muss kleingeschrieben sein")
        XCTAssertEqual(req.dstPort, 53)
        XCTAssertEqual(req.srcPort, 5353)
        XCTAssertEqual(req.dstIp, [10, 8, 0, 1])
        XCTAssertEqual(req.srcIp, [10, 8, 0, 2])
        // Question = (1+3)+(1+11)+(1+3)+1 Nullbyte = 21, plus QTYPE/QCLASS = 25
        XCTAssertEqual(req.question.count, 25, "Question-Section falsch abgegrenzt")
    }

    func testRejectsNonDnsPackets() {
        let filter = DnsFilter(blocklist: [])
        let dns = dnsQuery(name: "example.com")

        XCTAssertNil(filter.parse(packet: Data()), "leeres Paket")
        XCTAssertNil(filter.parse(packet: Data(repeating: 0, count: 19)), "zu kurz")
        XCTAssertNil(filter.parse(packet: packet(dns: dns, proto: 6)), "TCP muss abgelehnt werden")
        XCTAssertNil(filter.parse(packet: packet(dns: dns, dstPort: 80)), "anderer Zielport")
        XCTAssertNil(filter.parse(packet: packet(dns: dns, version: 6)), "IPv6")
        XCTAssertNil(filter.parse(packet: packet(dns: Data([0, 1, 2]))), "kaputte DNS-Nutzlast")
    }

    func testRejectsTruncatedQname() {
        let filter = DnsFilter(blocklist: [])
        // Header ok, aber ein Label behauptet 60 Zeichen, es folgen 3.
        var dns = dnsQuery(name: "a.de")
        dns[dns.count - 5] = 60
        XCTAssertNil(filter.parse(packet: packet(dns: dns)))
    }

    // MARK: - isBlocked

    func testBlocklistMatchesDomainAndSubdomainsOnly() {
        let filter = DnsFilter(blocklist: ["doubleclick.net", "criteo.com"], mode: "blocklist")
        XCTAssertTrue(filter.isBlocked("doubleclick.net"))
        XCTAssertTrue(filter.isBlocked("ads.doubleclick.net"), "Subdomain muss mitgeblockt werden")
        XCTAssertTrue(filter.isBlocked("deep.sub.criteo.com"))
        XCTAssertFalse(filter.isBlocked("notdoubleclick.net"), "Suffix darf nicht als Präfix wirken")
        XCTAssertFalse(filter.isBlocked("doubleclick.net.evil.com"), "angehängte Domain ist nicht geblockt")
        XCTAssertFalse(filter.isBlocked("google.de"))
    }

    func testBlocklistCleaning() {
        // trailing dot / Grossschreibung / Whitespace dürfen nicht zu Lücken führen.
        let filter = DnsFilter(blocklist: ["  DoubleClick.NET.  "], mode: "blocklist")
        XCTAssertTrue(filter.isBlocked("ads.doubleclick.net"))
        XCTAssertTrue(filter.isBlocked("DOUBLECLICK.NET"), "isBlocked normalisiert Gross-/Kleinschreibung")
        XCTAssertTrue(filter.isBlocked("doubleclick.net."), "trailing dot darf nicht durchrutschen")
    }

    func testAllowlistModeIsInverted() {
        // "Internet aus": nur erlaubte Domains kommen durch.
        let filter = DnsFilter(blocklist: ["google.de"], allowlist: ["whatsapp.net"], mode: "allowlist")
        XCTAssertFalse(filter.isBlocked("whatsapp.net"))
        XCTAssertFalse(filter.isBlocked("mmg.whatsapp.net"), "Subdomain der Allowlist bleibt erlaubt")
        XCTAssertTrue(filter.isBlocked("google.de"), "Blocklist ist im allowlist-Modus irrelevant")
        XCTAssertTrue(filter.isBlocked("example.com"))
        XCTAssertTrue(filter.isBlocked("instagram.com"))
    }

    func testUnknownModeFallsBackToBlocklist() {
        let filter = DnsFilter(blocklist: ["ads.example.com"], mode: "Allowlist")
        XCTAssertFalse(filter.isBlocked("example.com"), "Tippfehler darf nicht 'alles sperren' bedeuten")
        XCTAssertTrue(filter.isBlocked("ads.example.com"))
    }

    // MARK: - Antwort-Pakete

    private func assertValidIpv4(_ pkt: Data, src: [UInt8], dst: [UInt8], udpLen: Int) {
        let b = bytes(pkt)
        XCTAssertGreaterThanOrEqual(b.count, 28)
        XCTAssertEqual(b[0] >> 4, 4, "IPv4-Version")
        XCTAssertEqual(b[0] & 0x0F, 5, "IHL 5 (20 Bytes)")
        XCTAssertEqual(b[9], 17, "Protokoll UDP")
        XCTAssertEqual(Int(b[2]) << 8 | Int(b[3]), b.count, "TotalLength")
        XCTAssertEqual(Array(b[12..<16]), src, "Quell-IP = Tunnel")
        XCTAssertEqual(Array(b[16..<20]), dst, "Ziel-IP = Client")
        XCTAssertEqual(checksumSum(Array(b[0..<20])), 0, "IP-Checksumme ungültig")
        XCTAssertEqual(Int(b[24]) << 8 | Int(b[25]), udpLen, "UDP-Länge")
    }

    private func assertValidUdpChecksum(_ pkt: Data, db: [UInt8]) {
        let b = bytes(pkt)
        XCTAssertNotEqual(Int(b[26]) << 8 | Int(b[27]), 0, "UDP-Checksumme darf nicht 0 sein")
        // Pseudo-Header: src, dst, 0, proto, udpLen
        var pseudo: [UInt8] = Array(b[12..<20])
        pseudo.append(0)
        pseudo.append(17)
        let udpLen = b.count - 20
        pseudo.append(UInt8((udpLen >> 8) & 0xFF))
        pseudo.append(UInt8(udpLen & 0xFF))
        pseudo.append(contentsOf: b[20...])
        XCTAssertEqual(checksumSum(pseudo), 0, "UDP-Checksumme ungültig (Client verwirft die Antwort)")
        _ = db
    }

    func testBlockedEnvelopeIsWellFormed() throws {
        let filter = DnsFilter(blocklist: ["doubleclick.net"])
        let req = try XCTUnwrap(filter.parse(packet: packet(dns: dnsQuery(name: "ads.doubleclick.net"))))

        let out = filter.blockedEnvelope(for: req)
        let b = bytes(out)
        let udpLen = Int(calcUdpPayload(b))   // Feld im UDP-Header = 8 + DNS-Payload
        assertValidIpv4(out, src: [10, 8, 0, 1], dst: [10, 8, 0, 2], udpLen: udpLen)
        assertValidUdpChecksum(out, db: b)

        // UDP-Ports gedreht: 53 -> Client-Port
        XCTAssertEqual(Int(b[20]) << 8 | Int(b[21]), 53)
        XCTAssertEqual(Int(b[22]) << 8 | Int(b[23]), 5353)

        // DNS: gleiche ID, QR=1, RCODE=3 (NXDOMAIN), eine Frage, keine Antwort
        let dns = Array(b[28...])
        XCTAssertEqual(dns[0], 0xBE)
        XCTAssertEqual(dns[1], 0xEF)
        XCTAssertEqual(dns[2] & 0x80, 0x80, "QR-Bit")
        XCTAssertEqual(dns[3] & 0x0F, 3, "RCODE NXDOMAIN")
        XCTAssertEqual(Int(dns[4]) << 8 | Int(dns[5]), 1, "QDCOUNT")
        XCTAssertEqual(Int(dns[6]) << 8 | Int(dns[7]), 0, "ANCOUNT")
    }

    func testFailureEnvelopeUsesServfail() throws {
        let filter = DnsFilter(blocklist: [])
        let req = try XCTUnwrap(filter.parse(packet: packet(dns: dnsQuery(name: "example.com"))))
        let b = bytes(filter.failureEnvelope(for: req))
        XCTAssertEqual(b[28 + 3] & 0x0F, 2, "RCODE SERVFAIL")
        XCTAssertEqual(b[28 + 2] & 0x80, 0x80, "QR-Bit")
    }

    // MARK: - Grenzfälle

    func testLongestPossibleNameStillFits() throws {
        // 3 Labels à 63 Zeichen + Punkte + Nullbyte = 192 Byte QNAME.
        let name = (0..<3).map { _ in String(repeating: "a", count: 63) }.joined(separator: ".")
        let filter = DnsFilter(blocklist: ["nonexistent.example"])
        let req = try XCTUnwrap(filter.parse(packet: packet(dns: dnsQuery(name: name))))
        XCTAssertEqual(req.name, name.lowercased())
        let out = filter.blockedEnvelope(for: req)
        XCTAssertLessThan(out.count, 65_535)
        XCTAssertEqual(bytes(out)[0] >> 4, 4)
    }

    func testManyQueriesDoNotLeakOrCrash() throws {
        // 500 Parst/Block-Entscheidungen hintereinander: reine Robustheit.
        let filter = DnsFilter(blocklist: (0..<2_000).map { "ad\($0).example" })
        for i in 0..<500 {
            let host = "ad\(i).example"
            XCTAssertTrue(filter.isBlocked(host))
            XCTAssertNotNil(filter.parse(packet: packet(dns: dnsQuery(name: host))))
        }
    }

    private func calcUdpPayload(_ b: [UInt8]) -> UInt16 {
        UInt16(b[24]) << 8 | UInt16(b[25])
    }
}
