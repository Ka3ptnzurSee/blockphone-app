/** @type {import('@bacons/apple-targets/app.plugin').Config} */
// Zeitlimits im Hintergrund (DeviceActivity): startet/beendet Intervalle und
// re-appliziert den Shield, damit Limits auch ohne offene App greifen.
//
// Aktiv nur mit BLOCKPHONE_DEVICE_ACTIVITY=1 (siehe plugins/withAppleTargets.js),
// weil das Target ein eigenes Provisioning-Profil mit
// com.apple.developer.family-controls + App Group braucht.
//
// Bundle-ID: com.meister.blockphone.DeviceActivityMonitor
// Extension-Point: com.apple.deviceactivity.monitor-extension
// Prinzipal-Klasse (vom Plugin erwartet): DeviceActivityMonitorExtension
module.exports = {
  type: "device-activity-monitor",
  name: "DeviceActivityMonitor",
  displayName: "Blockphone Zeitlimits",
  bundleIdentifier: ".DeviceActivityMonitor",
  deploymentTarget: "16.0",
  frameworks: ["DeviceActivity", "FamilyControls", "ManagedSettings"],
  entitlements: {
    "com.apple.developer.family-controls": true,
    "com.apple.security.application-groups": ["group.com.meister.blockphone"],
  },
};
