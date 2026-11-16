/** @type {import('@bacons/apple-targets/app.plugin').Config} */
// Button-Aktionen auf dem eigenen Sperr-Screen.
//
// Aktiv nur mit BLOCKPHONE_SHIELD_EXT=1 (siehe plugins/withAppleTargets.js).
//
// Bundle-ID: com.meister.blockphone.ShieldAction
// Extension-Point: com.apple.ManagedSettings.shield-action-service
// Prinzipal-Klasse (vom Plugin erwartet): ShieldActionExtension
module.exports = {
  type: "shield-action",
  name: "ShieldAction",
  displayName: "Blockphone Shield Action",
  bundleIdentifier: ".ShieldAction",
  deploymentTarget: "16.0",
  frameworks: ["ManagedSettings"],
  // Kein App-Group-Entitlement: dieser Screen liest keine geteilten Daten.
  // Jedes zusätzliche Entitlement muss im Provisioning-Profil freigegeben sein.
  entitlements: {
    "com.apple.developer.family-controls": true,
  },
};
