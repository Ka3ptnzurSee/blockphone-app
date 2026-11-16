#!/usr/bin/env node
// scripts/check-targets.mjs
//
// Sanity-Gate für die nativen Apple-Targets (läuft ohne macOS, ohne Xcode).
//
// Prüft, was bei `expo prebuild` sonst erst auf dem Build-Runner auffällt:
//   1. Jeder Ordner in ./targets hat eine expo-target.config.js mit gültigem type.
//   2. Die Prinzipal-Klasse in der/dem Swift-Datei(en) heißt exakt so, wie
//      @bacons/apple-targets sie in die generierte Info.plist schreibt
//      (sonst startet die Extension zur Laufzeit nicht: NSExtensionPrincipalClass).
//   3. Jedes Target ist im Wrapper-Plugin erreichbar (packettunnel immer,
//      shieldconfig/shieldaction/deviceactivity nur mit Flag) — kein Waisen-Target.
//   4. Keine doppelten Kopien nativen Codes außerhalb von ./targets
//      (die alte `native/ios/`-Kopie ist genau so auseinandergelaufen).
//
// Aufruf: node scripts/check-targets.mjs   (Exit 1 bei Fehler)

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetsDir = join(root, "targets");

// Von @bacons/apple-targets unterstützt (build/target.js → getTargetInfoPlistForType).
const VALID_TYPES = new Set([
  "widget", "clip", "watch", "watch-widget", "action", "share", "safari", "imessage",
  "keyboard", "app-intent", "intent", "intent-ui", "notification-content",
  "notification-service", "account-auth", "bg-download", "credentials-provider",
  "device-activity-monitor", "network-packet-tunnel", "network-app-proxy",
  "network-filter-data", "quicklook-thumbnail", "quicklook-preview", "spotlight",
  "spotlight-delegate", "content-blocker", "file-provider", "file-provider-ui",
  "broadcast-upload", "broadcast-setup-ui", "call-directory", "message-filter",
  "classkit-context", "unwanted-communication", "photo-editing",
  "virtual-conference", "shield-action", "shield-config", "print-service",
  "smart-card", "authentication-services", "wallet", "wallet-ui", "location-push",
  "matter",
]);

// Erwartete Prinzipal-Klasse je Target-Typ (Spiegel von target.js).
const PRINCIPAL_BY_TYPE = {
  "network-packet-tunnel": "PacketTunnelProvider",
  "shield-config": "ShieldConfigurationExtension",
  "shield-action": "ShieldActionExtension",
  "device-activity-monitor": "DeviceActivityMonitorExtension",
};

const ALWAYS = ["packettunnel"];
const FLAGGED = {
  BLOCKPHONE_SHIELD_EXT: ["shieldconfig", "shieldaction"],
  BLOCKPHONE_DEVICE_ACTIVITY: ["deviceactivity"],
};

const problems = [];
const notes = [];

function loadConfig(dir) {
  for (const name of ["expo-target.config.js", "expo-target.config.json"]) {
    const p = join(dir, name);
    if (existsSync(p)) return { path: p, name };
  }
  return null;
}

function swiftSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...swiftSources(p));
    else if (entry.endsWith(".swift")) out.push(p);
  }
  return out;
}

if (!existsSync(targetsDir)) {
  console.error("check-targets: FEHLER — Ordner targets/ fehlt");
  process.exit(1);
}

const dirs = readdirSync(targetsDir).filter((d) => statSync(join(targetsDir, d)).isDirectory());
if (dirs.length === 0) problems.push("targets/ ist leer — kein einziges Apple-Target");

for (const name of dirs) {
  const dir = join(targetsDir, name);
  const cfg = loadConfig(dir);
  if (!cfg) {
    problems.push(`${name}: expo-target.config.js fehlt (wird von @bacons/apple-targets ignoriert)`);
    continue;
  }

  let type;
  if (cfg.name.endsWith(".json")) {
    try {
      type = JSON.parse(readFileSync(cfg.path, "utf8")).type;
    } catch (e) {
      problems.push(`${name}: config JSON kaputt (${e.message})`);
      continue;
    }
  } else {
    // CJS-Config: nur das type-Feld herauslesen, ohne Modul-Side-Effects.
    const src = readFileSync(cfg.path, "utf8");
    const m = src.match(/\btype:\s*["'`]([a-z-]+)["'`]/);
    type = m ? m[1] : undefined;
  }
  if (!type) {
    problems.push(`${name}: kein "type" in der config`);
    continue;
  }
  if (!VALID_TYPES.has(type)) {
    problems.push(`${name}: unbekannter Target-Typ "${type}"`);
    continue;
  }

  // Prinzipal-Klasse (nur für Typen, die eine brauchen)
  const expected = PRINCIPAL_BY_TYPE[type];
  const sources = swiftSources(dir);
  if (expected) {
    const hasClass = sources.some((f) => {
      const s = readFileSync(f, "utf8");
      return new RegExp(`(class|struct|enum)\\s+${expected}\\b`).test(s);
    });
    if (!hasClass) {
      problems.push(
        `${name}: Klasse "${expected}" fehlt in den Swift-Dateien (NSExtensionPrincipalClass → Extension startet nicht)`,
      );
    }
    // Eigene Info.plist darf nur die vom Plugin erwartete Klasse nennen.
    const plist = join(dir, "Info.plist");
    if (existsSync(plist)) {
      const s = readFileSync(plist, "utf8");
      const m = s.match(/NSExtensionPrincipalClass<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.([A-Za-z0-9_]+)<\/string>/);
      if (m && m[1] !== expected) {
        problems.push(`${name}: Info.plist nennt Prinzipal "${m[1]}", erwartet "${expected}"`);
      }
    }
  }
  if (sources.length === 0) problems.push(`${name}: keine Swift-Dateien — Target wäre leer`);

  // Ist das Target im Wrapper-Plugin auch wirklich erreichbar?
  const known =
    ALWAYS.includes(name) || Object.values(FLAGGED).some((list) => list.includes(name));
  if (!known) {
    problems.push(
      `${name}: Target existiert, wird aber von plugins/withAppleTargets.js in KEINEM Flag gebaut`,
    );
  }
}

// Flag-Listen gegen die echte Verzeichnisliste prüfen (Tippfehler).
for (const [flag, list] of Object.entries(FLAGGED)) {
  for (const name of list) {
    if (!dirs.includes(name)) problems.push(`${flag} verweist auf fehlendes Target "${name}"`);
  }
}

// Doppelten nativen Code außerhalb von targets/ aufspüren.
const LEGACY = ["native/ios", "shield/future"];
for (const rel of LEGACY) {
  if (existsSync(join(root, rel))) {
    problems.push(`${rel}: alte Kopie nativen Codes existiert wieder (Quelle der Wahrheit ist targets/)`);
  }
}

const flaggedOn = Object.entries(FLAGGED)
  .filter(([flag]) => ["1", "true", "yes"].includes(String(process.env[flag] || "").trim().toLowerCase()))
  .flatMap(([, list]) => list);
notes.push(`Targets: ${dirs.sort().join(", ")}`);
notes.push(`immer gebaut: ${ALWAYS.join(", ")}`);
notes.push(`dieser Build zusätzlich: ${flaggedOn.length ? flaggedOn.join(", ") : "— (keine Flags gesetzt)"}`);

for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  console.error("\ncheck-targets: FEHLER");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\ncheck-targets: OK");
