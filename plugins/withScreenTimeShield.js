// withScreenTimeShield.js — Expo Config Plugin
//
// Setzt beim `expo prebuild` die FamilyControls-Entitlements der Haupt-App.
// Die App-Extension-Targets (ShieldConfig/ShieldAction/DeviceActivityMonitor)
// müssen einmalig in Xcode angelegt werden — siehe native/README.md.
//
// Registriert in app.json unter "plugins": ["./plugins/withScreenTimeShield"].

const { withEntitlementsPlist } = require("@expo/config-plugins");

module.exports = function withScreenTimeShield(config) {
  return withEntitlementsPlist(config, (cfg) => {
    // Screen-Time / Family Controls (iOS 16+). Ohne dieses Entitlement
    // schlägt AuthorizationCenter.requestAuthorization fehl.
    cfg.modResults["com.apple.developer.family-controls"] = true;

    // App-Gruppe (teilt Einstellungen zwischen App + Extensions via UserDefaults/Container).
    // Bundle-ID der App: com.meister.blockphone → Gruppe: group.com.meister.blockphone
    const group = "group." + (config.ios?.bundleIdentifier || "com.meister.blockphone");
    // Bestehenden Wert respektieren — kann Array ODER einzelner String sein
    // (Single-Value-Plist). [...string] würde den String in Zeichen zerlegen.
    const raw = cfg.modResults["com.apple.security.application-groups"];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!existing.includes(group)) existing.push(group);
    cfg.modResults["com.apple.security.application-groups"] = existing;

    return cfg;
  });
};
