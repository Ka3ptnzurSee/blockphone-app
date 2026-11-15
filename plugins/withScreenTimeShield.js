const fs = require("fs");
const path = require("path");
const { withEntitlementsPlist, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

// Screen-Time-Shield (Family Controls). Abschaltbar mit SCREENTIME_SHIELD=0.
const ENABLED = process.env.SCREENTIME_SHIELD !== "0";
const NATIVE_FILES = ["ScreenTimeShield.swift", "ScreenTimeShieldBridge.m"];

function withEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.family-controls"] = true;
    const group = "group." + (config.ios?.bundleIdentifier || "com.meister.blockphone");
    const raw = cfg.modResults["com.apple.security.application-groups"];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!existing.includes(group)) existing.push(group);
    cfg.modResults["com.apple.security.application-groups"] = existing;
    return cfg;
  });
}

function withNativeSources(config) {
  config = withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, "shield", "AppTarget");
      const dest = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of NATIVE_FILES) {
        const from = path.join(src, f);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, f));
      }
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const groupKey = proj.findPBXGroupKey({ name: appName });
    for (const f of NATIVE_FILES) {
      const rel = appName + "/" + f;
      if (!proj.hasFile(rel)) {
        proj.addSourceFile(rel, { target: proj.getFirstTarget().uuid }, groupKey);
      }
    }
    return cfg;
  });

  return config;
}

module.exports = function withScreenTimeShield(config) {
  if (!ENABLED) return config;
  return withNativeSources(withEntitlements(config));
};

