module.exports = {
  type: "extension",
  name: "DeviceActivityMonitor",
  frameworks: ["DeviceActivity", "FamilyControls", "ManagedSettings"],
  entitlements: {
    "com.apple.developer.family-controls": true,
    "com.apple.security.application-groups": ["group.com.meister.blockphone"],
  },
};

