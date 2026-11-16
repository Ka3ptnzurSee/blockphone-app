const { withEntitlementsPlist } = require("expo/config-plugins");

// Screen-Time-Entitlements (Family Controls).
//
// Die Sperr-Logik selbst ist seit Build 148 ein **Expo-Modul**
// (modules/screentime-shield, per Autolinking eingebunden). Dieses Plugin setzt
// nur noch die Entitlements — vorher hat es zusätzlich Swift-Dateien in den
// Xcode-Target kopiert (Legacy-RCT-Modul), was in RN 0.86 / Expo SDK 57 nicht
// mehr zuverlässig erreichbar war.
//
// Abschaltbar mit SCREENTIME_SHIELD=0.
const ENABLED = process.env.SCREENTIME_SHIELD !== "0";

// App Group nur, wenn sie im Apple-Profil wirklich freigeschaltet ist
// (Portal/Provisioning). Ohne Freigabe liefert
// `containerURL(forSecurityApplicationGroupIdentifier:)` nil — dann schreibt
// weder der DNS-Tunnel noch die Auswahl etwas dorthin.
//
// Automatisch an, sobald das DeviceActivity-Target gebaut wird
// (BLOCKPHONE_DEVICE_ACTIVITY=1): diese Extension liest die Auswahl aus der
// App Group — ohne sie wäre das Zeitlimit-Target funktionslos.
const APP_GROUP = "group.com.meister.blockphone";
const DEVICE_ACTIVITY = ["1", "true", "yes"].includes(
  String(process.env.BLOCKPHONE_DEVICE_ACTIVITY || "").trim().toLowerCase(),
);

module.exports = function withScreenTimeShield(config) {
  if (!ENABLED) return config;
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.family-controls"] = true;
    if (process.env.APP_GROUP === "1" || DEVICE_ACTIVITY) {
      const raw = cfg.modResults["com.apple.security.application-groups"];
      const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!existing.includes(APP_GROUP)) existing.push(APP_GROUP);
      cfg.modResults["com.apple.security.application-groups"] = existing;
    }
    return cfg;
  });
};
