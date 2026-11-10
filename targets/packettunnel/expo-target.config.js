/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "network-packet-tunnel",
  name: "PacketTunnelProvider",
  displayName: "Blockphone DNS",
  // Punkt-Präfix → wird an die Bundle-ID der Haupt-App gehängt:
  // com.meister.blockphone.PacketTunnelProvider
  bundleIdentifier: ".PacketTunnelProvider",
  deploymentTarget: "16.0",
  frameworks: ["NetworkExtension"],
  entitlements: {
    "com.apple.developer.networking.networkextension": ["packet-tunnel-provider"],
    "com.apple.developer.networking.vpn.api": ["allow-vpn"],
  },
};
