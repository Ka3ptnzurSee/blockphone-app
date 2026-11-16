// withNetworkBlocker.js — Expo Config Plugin
//
// Setzt beim `expo prebuild` die Network-Extension-Entitlements der Haupt-App
// für den DNS-Blocking-Tunnel (PacketTunnelProvider = Personal VPN).
//
// Die Extension-Targets werden NICHT hier, sondern über ./targets/*+plugins/withAppleTargets.js
// erzeugt (Quelle der Wahrheit: targets/). Siehe docs/NATIVE-STRUKTUR.md.
//
// Registriert in app.json unter "plugins": ["./plugins/withNetworkBlocker"].

const { withEntitlementsPlist } = require("@expo/config-plugins");

// Die Entitlements (Network Extension, Personal VPN, App Group) stehen NICHT im
// App-Store-Profil, solange Apple sie nicht freigegeben hat. Mit ihnen bricht das
// Signieren ab ("provisioning profile doesn't include entitlement").
// Deshalb nur aktiv, wenn der System-Shield ausdrücklich gebaut werden soll:
//   BLOCKPHONE_SYSTEM_SHIELD=1 eas build -p ios --profile production
const ENABLED = process.env.BLOCKPHONE_SYSTEM_SHIELD === "1";

module.exports = function withNetworkBlocker(config) {
  if (!ENABLED) return config;
  return withEntitlementsPlist(config, (cfg) => {
    // Network Extension (PacketTunnelProvider) für das lokale VPN
    cfg.modResults["com.apple.developer.networking.networkextension"] = true;
    // Personal VPN (allow-vpn = Nutzer-VPN, kein MDM/per-app-VPN)
    cfg.modResults["com.apple.developer.networking.vpn.api"] = ["allow-vpn"];

    // App-Group (teilt die Domain-Blocklist mit der Extension)
    const group = "group." + (config.ios?.bundleIdentifier || "com.meister.blockphone");
    const raw = cfg.modResults["com.apple.security.application-groups"];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!existing.includes(group)) existing.push(group);
    cfg.modResults["com.apple.security.application-groups"] = existing;

    return cfg;
  });
};
