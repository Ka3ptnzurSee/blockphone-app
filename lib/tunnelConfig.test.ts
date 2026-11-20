// lib/tunnelConfig.test.ts — Regressionsschutz für die Tunnel-Netzwerkkonfiguration
// und die DNS-Fail-open-Kette.
//
// Warum: Der DNS-Blocker kann nur wirken, wenn iOS die DNS-Queries überhaupt an
// den Tunnel schickt. Genau das hing an EINER Zeile (`matchDomains = [""]`):
// Der Tunnel ist absichtlich nicht die Default-Route (includedRoutes =
// 10.8.0.1/32), und laut Apple-Doku gilt ohne den leeren matchDomain nur der
// System-Resolver — der Werbeblocker blockte dann 0 Domains, ohne Fehler.
//
// Zweite Zusicherung: Weil der Tunnel seit diesem Fix der EINZIGE Resolver ist,
// darf ein Request niemals stumm verworfen werden (SERVFAIL statt Paket-Drop).
//
// Der Test liest die Swift-Quellen (kein Swift-Compiler auf diesem Host) und
// entfernt vorher Kommentarzeilen — sonst würde ein auskommentierter Fix als
// "vorhanden" durchgehen.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Swift-Quelle ohne `//`-Kommentarzeilen (Block-Kommentare bleiben, selten genutzt). */
function code(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const tunnel = () => code("targets/packettunnel/PacketTunnelProvider.swift");
const filter = () => code("targets/packettunnel/DnsFilter.swift");

test("Tunnel: DNS-Server liegt im Tunnel (sonst gibt es keinen Resolver)", () => {
  assert.match(tunnel(), /NEDNSSettings\(servers:\s*\["10\.8\.0\.1"\]\)/);
});

test('Tunnel: matchDomains = [""] — ohne Default-Domain gehen alle Queries am Filter vorbei', () => {
  // Bewusst ohne Variablennamen-Bindung: `dns.matchDomains`, `settings.dnsSettings…
  // .matchDomains` und `x!.matchDomains` müssen alle als Treffer gelten.
  assert.match(tunnel(), /\.matchDomains\s*=\s*\[""\]/);
});

test("Tunnel: nur die DNS-Adresse wird geroutet (keine Default-Route)", () => {
  const src = tunnel();
  assert.match(src, /includedRoutes\s*=\s*\[NEIPv4Route\(destinationAddress:\s*"10\.8\.0\.1"/);
  // Kein Default-Route-Muster, egal in welcher Schreibweise.
  assert.ok(!/NEIPv4Route\.default\(\)/.test(src), "NEIPv4Route.default() würde allen Traffic tunneln");
  assert.ok(
    !/destinationAddress:\s*"0\.0\.0\.0"/.test(src),
    'includedRoutes 0.0.0.0/0 würde die Extension-Verbindung wieder in den TUN ziehen (DNS-Loop)',
  );
});

test("Tunnel: eingeschalteter Werbeblocker wird beim Start protokolliert", () => {
  // Ohne diese Zeile ist "Werbeblocker an, blockt aber nichts" nicht messbar.
  assert.match(tunnel(), /NSLog\("\[Blockphone\] Tunnel-Start/);
});

test("Filter: mehrere Upstreams statt eines einzelnen Anbieters", () => {
  const src = filter();
  assert.match(src, /upstreams:\s*\[\(host:\s*String,\s*sni:\s*String\)\]/);
  assert.match(src, /"1\.1\.1\.1"/);
  assert.match(src, /"8\.8\.8\.8"/);
});

test("Filter: kein stiller Paket-Drop — SERVFAIL wird erzeugt", () => {
  const src = filter();
  assert.match(src, /func failureEnvelope\(for req: Request\)/);
  assert.match(src, /rcode:\s*2/, "SERVFAIL muss als RCODE 2 gebaut werden");
  // forward() darf bei Überlast/Fehlschlag nicht nil weitergeben.
  assert.ok(!/guard semaphore\.wait\(timeout: \.now\(\)\) == \.success else \{\s*\n\s*completion\(nil\)/.test(src));
});
