// swift-tools-version:5.9
//
// Eigenständiges SwiftPM-Paket, damit die Tunnel-Logik (DnsFilter.swift) mit
// `swift test` WIRKLICH ausgeführt wird — bisher prüften die Node-Tests nur den
// Quelltext per Regex. Network.framework gibt es nur unter macOS/iOS, deshalb
// läuft dieser Test im CI auf einem macos-Runner.
//
// Die Quelle wird nicht dupliziert: der CI-Schritt kopiert
// targets/packettunnel/DnsFilter.swift nach Sources/TunnelCore/. Damit kann die
// Datei nicht auseinanderlaufen.
import PackageDescription

let package = Package(
    name: "BlockphoneTunnel",
    platforms: [.macOS(.v12)],
    targets: [
        .target(name: "TunnelCore", path: "Sources/TunnelCore"),
        .testTarget(name: "TunnelCoreTests", dependencies: ["TunnelCore"], path: "Tests/TunnelCoreTests"),
    ]
)
