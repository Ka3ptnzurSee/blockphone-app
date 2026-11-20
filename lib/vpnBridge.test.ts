// lib/vpnBridge.test.ts — Contract zwischen JS und Swift.
//
// Warum: Die App steuert den DNS-Tunnel über ein Expo-Modul. JS ruft
// `VpnManager.start(domains, allowlist, mode, ads)`, Swift exponiert
// `AsyncFunction("start") { (domains, allowlist, mode, ads) }`. Ändert eine
// Seite Name, Anzahl oder Reihenfolge der Parameter, kompiliert beides weiter —
// aber zur Laufzeit wirft Expo "Argument count mismatch" oder, schlimmer,
// vertauscht `mode` und `ads` (dann ist "Internet aus" plötzlich ein Adblocker).
// Deshalb hier ein Quelltext-Contract-Test (kein Swift-Compiler auf dem Host).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const bridge = () => read("modules/vpn-manager/index.ts");
const swift = () => read("modules/vpn-manager/ios/VpnManagerModule.swift");
const caller = () => read("lib/vpn.ts");

/** JS-Methodennamen des NativeModule-Interfaces (start/stop/status/setBlocklist). */
function jsMethods(): string[] {
  const block = bridge();
  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
}

/** In Swift exponierte Funktionsnamen: AsyncFunction("name") oder Function("name"). */
function swiftFunctions(): string[] {
  return [...swift().matchAll(/(?:Async)?Function\("(\w+)"/g)].map((m) => m[1]);
}

test("Bridge: jede JS-Methode ist in Swift exponiert", () => {
  const swiftNames = new Set(swiftFunctions());
  assert.ok(jsMethods().length >= 4, "Interface sollte start/stop/status/setBlocklist haben");
  for (const m of jsMethods()) {
    assert.ok(swiftNames.has(m), `JS-Methode "${m}" fehlt in VpnManagerModule.swift`);
  }
});

test("Bridge: der Modulname passt auf requireOptionalNativeModule(\"VpnManager\")", () => {
  assert.match(swift(), /Name\("VpnManager"\)/);
  assert.match(bridge(), /requireOptionalNativeModule<VpnNativeModule>\("VpnManager"\)/);
});

test("Bridge: start() hat in beiden Sprachen dieselben 4 Parameter in derselben Reihenfolge", () => {
  const swiftStart = swift().match(/AsyncFunction\("start"\)\s*\{\s*\(([^)]*)\)/);
  assert.ok(swiftStart, "AsyncFunction(\"start\") nicht gefunden");
  // "domains: [String], allowlist: [String], mode: String, ads: Bool"
  const swiftArgs = swiftStart![1].split(",").map((a) => a.split(":")[0].trim());
  assert.deepEqual(swiftArgs, ["domains", "allowlist", "mode", "ads"]);

  const jsStart = bridge().match(/start\(\s*([^)]*?),?\s*\): Promise<boolean>/s);
  assert.ok(jsStart, "start(...) im TS-Interface nicht gefunden");
  const jsArgs = jsStart![1].split(/,\s*/).map((a) => a.trim()).filter(Boolean);
  assert.deepEqual(jsArgs, ["domains: string[]", "allowlist: string[]", 'mode: "blocklist" | "allowlist"', "ads: boolean"]);
});

test("Bridge: die App ruft start() mit genau diesen 4 Argumenten auf", () => {
  // VpnManager.start(domains, allowlist, mode, ads) — Position 4 ist ads,
  // nicht mode: eine Vertauschung würde still das falsche Feature schalten.
  for (const m of caller().matchAll(/VpnManager\.start\(([^)]*)\)/g)) {
    const args = m[1].split(",").map((a) => a.trim()).filter(Boolean);
    assert.equal(args.length, 4, `VpnManager.start(${m[1]}) hat ${args.length} statt 4 Argumente`);
  }
});

test("Bridge: Extension-Bundle-ID in App und Provider identisch", () => {
  const ids = [...swift().matchAll(/providerBundleId\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 1);
  assert.equal(new Set(ids).size, 1, `unterschiedliche Bundle-IDs: ${ids.join(" / ")}`);
  // ... und sie muss zum Target-Ordner passen (Ordnername = letzter Teil).
  assert.match(ids[0], /^com\.meister\.blockphone\.PacketTunnelProvider$/);
});
