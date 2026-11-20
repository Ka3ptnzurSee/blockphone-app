// lib/tunnelConfig.test.ts — Regressionsschutz für die Tunnel-Netzwerkkonfiguration.
//
// Warum: Der DNS-Blocker kann nur wirken, wenn iOS die DNS-Queries überhaupt an
// den Tunnel schickt. Genau das hing an EINER Zeile (`dns.matchDomains = [""]`):
// Der Tunnel ist absichtlich nicht die Default-Route (includedRoutes =
// 10.8.0.1/32), und laut Apple-Doku gilt ohne den leeren matchDomain nur der
// System-Resolver — der Werbeblocker blockte dann 0 Domains, ohne Fehler.
//
// Der Test liest die Swift-Quelle (kein Swift-Compiler auf diesem Host) und
// prüft die drei Bedingungen, die zusammen das Blocking ergeben.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swift = readFileSync(
  path.join(root, "targets/packettunnel/PacketTunnelProvider.swift"),
  "utf8",
);

test("Tunnel: DNS-Server liegt im Tunnel (sonst gibt es keinen Resolver)", () => {
  assert.match(swift, /NEDNSSettings\(servers:\s*\["10\.8\.0\.1"\]\)/);
});

test('Tunnel: matchDomains = [""] — ohne die Default-Domain gehen alle Queries am Tunnel vorbei', () => {
  assert.match(swift, /dns\.matchDomains\s*=\s*\[""\]/);
});

test("Tunnel: nur die DNS-Adresse wird geroutet (Split-Tunnel bleibt erhalten)", () => {
  assert.match(
    swift,
    /ipv4\.includedRoutes\s*=\s*\[NEIPv4Route\(destinationAddress:\s*"10\.8\.0\.1"/,
  );
  // Keine Default-Route: sonst würde aller Traffic durch den Tunnel laufen.
  assert.ok(!/includedRoutes\s*=\s*\[NEIPv4Route\.default\(\)\]/.test(swift));
});

test("Tunnel: eingeschalteter Werbeblocker wird beim Start protokolliert", () => {
  // Ohne diese Zeile ist "Werbeblocker an, blockt aber nichts" nicht messbar.
  assert.match(swift, /NSLog\("\[Blockphone\] Tunnel-Start/);
});
