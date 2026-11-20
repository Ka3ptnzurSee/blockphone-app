// lib/vpnMode.test.ts — Verhaltensregeln der beiden DNS-Modi.
//
// Warum: "blocklist" und "allowlist" sind inverse Welten, und der Code hat zwei
// Fallen, die man beim Lesen leicht übersieht:
//   1. Im allowlist-Modus ("Internet aus") darf die Werbe-Liste NICHT angehängt
//      werden — sonst wäre "alles ausser Allowlist" von 41k Werbe-Domains
//      durchsetzt und die Allowlist wirkungslos.
//   2. isBlocked muss im allowlist-Modus invertieren (alles sperren, was nicht
//      erlaubt ist), sonst passiert gar nichts.
// Beides ist Swift-Logik im Tunnel; ein echter Ausführungstest bräuchte ein
// iOS-Gerät. Deshalb hier Quelltext-Assertions plus echte JS-Messungen an der
// Blocklist, die den Tunnel befüllt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildDnsBlocklist } from "./dnsBlocklist";
import { AD_DOMAIN_COUNT } from "./adBlocklist";
import type { Platform } from "./browser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = (rel: string) =>
  readFileSync(path.join(root, rel), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
const tunnel = () => code("targets/packettunnel/PacketTunnelProvider.swift");
const filter = () => code("targets/packettunnel/DnsFilter.swift");

test("allowlist-Modus: Werbe-Liste wird NICHT angehängt", () => {
  // Erwartetes Muster: if rules.ads && rules.mode != "allowlist" { … }
  assert.match(tunnel(), /if\s+rules\.ads\s*&&\s*rules\.mode\s*!=\s*"allowlist"/);
});

test("allowlist-Modus: isBlocked invertiert (alles ausser Allowlist sperren)", () => {
  const src = filter();
  assert.match(src, /if\s+mode\s*==\s*"allowlist"\s*\{/);
  assert.match(src, /return\s*!Self\.matches\(name,\s*in:\s*allowlist\)/);
});

test("Modus-Normalisierung: alles ausser \"allowlist\" verhält sich wie blocklist", () => {
  // Ein Tippfehler aus dem JS ("Allowlist") darf nicht still "alles erlauben".
  assert.match(filter(), /mode\s*==\s*"allowlist"\s*\?\s*"allowlist"\s*:\s*"blocklist"/);
});

test("Blocklist-Deckel: die App begrenzt die Einträge vor dem Start", () => {
  // 50k Einträge als Obergrenze — eine riesige providerConfiguration würde den
  // Tunnel-Start (Plist-Grösse, Startzeit) sprengen. Der Deckel sitzt bewusst
  // app-seitig in VpnService.clean, nicht im Tunnel.
  const app = code("modules/vpn-manager/ios/VpnManagerModule.swift");
  assert.match(app, /prefix\(50_000\)/);
});

test("Werbe-Liste ist als Ressource deklariert und nicht im providerConfiguration-Pfad", () => {
  // 41k Domains gehören NICHT in die VPN-Konfiguration (Plist-Limit) — sie
  // müssen aus dem Bundle kommen.
  const src = tunnel();
  assert.match(src, /Bundle\.main\.url\(forResource:\s*"adblock"/);
  const js = code("lib/vpn.ts");
  assert.ok(!/adblock/i.test(js), "lib/vpn.ts darf die Werbe-Liste nicht mitschicken");
});

test("Plattform-Blocklist bleibt klein genug für providerConfiguration", () => {
  const platforms: Platform[] = ["tiktok", "instagram", "youtube", "snapchat", "facebook"];
  const domains = buildDnsBlocklist(platforms);
  const kb = JSON.stringify(domains).length / 1024;
  assert.ok(domains.length > 0, "Plattform-Auswahl muss Domains liefern");
  assert.ok(kb < 64, `providerConfiguration wäre ${kb.toFixed(1)} KB — zu gross für die VPN-Plist`);
});

test("Werbe-Liste und Zähler in der UI stimmen überein", () => {
  const json = JSON.parse(readFileSync(path.join(root, "targets/packettunnel/adblock.json"), "utf8"));
  assert.equal(json.length, AD_DOMAIN_COUNT);
  assert.ok(AD_DOMAIN_COUNT > 30_000, "Liste ist unerwartet klein — Build-Quelle prüfen");
});
