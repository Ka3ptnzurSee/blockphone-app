// withAppleTargets.js — Wrapper um @bacons/apple-targets
//
// WARUM: `@bacons/apple-targets` liest ALLE Unterordner von ./targets mit einer
// `expo-target.config.js` und baut daraus Xcode-Targets. Ohne Filter würde also
// auch ein Target gebaut, dessen Entitlement Apple noch nicht freigegeben hat —
// der Build bricht dann beim Signieren ab ("provisioning profile doesn't
// include entitlement").
//
// Dieser Wrapper setzt darum pro Build eine explizite Target-Liste (`match`):
//
//   immer                     : packettunnel   (DNS-Tunnel, ships seit Build 148)
//   BLOCKPHONE_SHIELD_EXT=1       + shieldconfig, shieldaction
//                                   (eigener Sperr-Screen + Buttons; brauchen
//                                    com.apple.developer.family-controls im
//                                    eigenen Provisioning-Profil)
//   BLOCKPHONE_DEVICE_ACTIVITY=1  + deviceactivity
//                                   (Zeitlimits im Hintergrund; braucht
//                                    Family Controls + App Group im Profil)
//
// Warum standardmäßig AUS: jede Extension ist eine eigene Bundle-ID → eigenes
// App-ID + eigenes Provisioning-Profil. `com.apple.developer.family-controls`
// lässt sich per App-Store-Connect-API NICHT freischalten (kein gültiger
// capabilityType, verifiziert 15.11.2026) — das muss im Developer-Portal von
// Hand passieren. Erst danach den Build mit dem passenden Flag starten.
//
// Also: Expo Config Plugin registriert in app.json als
//   ["./plugins/withAppleTargets.js"]
const { existsSync } = require("node:fs");
const { join, dirname } = require("node:path");

const appleTargets = require("@bacons/apple-targets/app.plugin");

const ROOT = "./targets";

// Flags sind "1" / "true" — alles andere ist aus (auch wenn versehentlich "0"
// oder ein leerer String gesetzt ist).
function on(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Liste der Targets, die in diesem Build gebaut werden (rein, testbar). */
function targetsFor(env = process.env) {
  const list = ["packettunnel"];
  if (on(env.BLOCKPHONE_SHIELD_EXT)) list.push("shieldconfig", "shieldaction");
  if (on(env.BLOCKPHONE_DEVICE_ACTIVITY)) list.push("deviceactivity");
  return list;
}

/** Glob für @bacons/apple-targets: "a" bzw. "{a,b,c}". */
function matchFor(list) {
  return list.length === 1 ? list[0] : `{${list.join(",")}}`;
}

module.exports = function withAppleTargets(config) {
  const list = targetsFor();

  // Ein Flag darf nie still ins Leere laufen: fehlt der Ordner, matcht der
  // Glob nichts und der Build wäre ohne die Extension — ohne Fehlermeldung.
  const projectRoot = config._internal?.projectRoot || dirname(__dirname);
  const missing = list.filter((name) => !existsSync(join(projectRoot, ROOT, name)));
  if (missing.length) {
    throw new Error(
      `[apple-targets] Target-Ordner fehlt: ${missing.join(", ")} — ` +
        `erwartet unter ${ROOT}/<name>/expo-target.config.js`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[apple-targets] baue ${list.length} Target(s): ${list.join(", ")}`);
  return appleTargets(config, { root: ROOT, match: matchFor(list) });
};

module.exports.targetsFor = targetsFor;
module.exports.matchFor = matchFor;
