/** @type {import('@bacons/apple-targets/app.plugin').Config} */
// Eigener Sperr-Screen (statt des iOS-Standard-Shields).
//
// Aktiv nur mit BLOCKPHONE_SHIELD_EXT=1 (siehe plugins/withAppleTargets.js),
// weil das Target ein eigenes Provisioning-Profil mit
// com.apple.developer.family-controls braucht.
//
// Bundle-ID: com.meister.blockphone.ShieldConfiguration
// Extension-Point: com.apple.ManagedSettingsUI.shield-configuration-service
// Prinzipal-Klasse (vom Plugin erwartet): ShieldConfigurationExtension
module.exports = {
  type: "shield-config",
  name: "ShieldConfiguration",
  displayName: "Blockphone Shield",
  bundleIdentifier: ".ShieldConfiguration",
  deploymentTarget: "16.0",
  frameworks: ["ManagedSettings", "ManagedSettingsUI"],
  // Kein App-Group-Entitlement: dieser Screen liest keine geteilten Daten.
  // Jedes zusätzliche Entitlement muss im Provisioning-Profil freigegeben sein.
  entitlements: {
    "com.apple.developer.family-controls": true,
  },
};
