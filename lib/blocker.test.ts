import { test } from "node:test";
import assert from "node:assert/strict";
import { b64, isAllowedUrl, isPrivateIPv4, ruleIp, blockedIps, MARKER } from "./blocker";

test("b64: RFC 4648 Grundfälle", () => {
  assert.equal(b64(""), "");
  assert.equal(b64("admin:"), "YWRtaW46");
  assert.equal(b64("admin"), "YWRtaW4=");
  assert.equal(b64("a"), "YQ==");
});

test("b64: UTF-8 (Umlaute, €, Emoji)", () => {
  assert.equal(b64("ü"), "w7w=");
  assert.equal(b64("€"), "4oKs");
  assert.equal(b64("😀"), "8J+YgA==");
});

test("isPrivateIPv4: private Ranges", () => {
  for (const ip of ["10.0.0.1", "192.168.0.221", "172.16.0.1", "172.31.255.1", "127.0.0.1"]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
});

test("isPrivateIPv4: öffentlich / Bypass / Oktett-Fehler", () => {
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("192.168.0.1.attacker.com"), false); // kein Präfix-Match
  assert.equal(isPrivateIPv4("999.1.1.1"), false); // Oktett > 255
});

test("isAllowedUrl: Bypass-Schutz (Hostnamen-Präfix)", () => {
  assert.equal(isAllowedUrl("http://192.168.0.1.attacker.com"), false);
  assert.equal(isAllowedUrl("http://10.0.0.1.evil.com"), false);
  assert.equal(isAllowedUrl("http://127.0.0.1.x.com"), false);
  assert.equal(isAllowedUrl("http://evil.com"), false);
  assert.equal(isAllowedUrl("ftp://x"), false);
});

test("isAllowedUrl: erlaubte Ziele", () => {
  assert.equal(isAllowedUrl("http://192.168.0.221:3000"), true);
  assert.equal(isAllowedUrl("http://localhost:3000"), true);
  assert.equal(isAllowedUrl("http://raspi.local"), true);
  assert.equal(isAllowedUrl("https://192.168.0.221"), true);
  assert.equal(isAllowedUrl("https://raspi.local"), true);
  assert.equal(isAllowedUrl("HTTPS://localhost"), true);
});

test("isAllowedUrl: https nur zu privaten/lokalen Hosts (kein Datenabfluss)", () => {
  assert.equal(isAllowedUrl("https://anything.example"), false);
  assert.equal(isAllowedUrl("https://evil.com"), false);
  assert.equal(isAllowedUrl("https://192.168.0.1.attacker.com"), false);
});

test("ruleIp: Endanker (25 matcht nicht 253)", () => {
  assert.equal(ruleIp("/.*/$client=192.168.0.88  # CENTRAL-BLOCK"), "192.168.0.88");
  assert.equal(ruleIp("$client=192.168.0.25"), "192.168.0.25");
  assert.equal(ruleIp("ohne client"), null);
});

test("blockedIps: nur CENTRAL-BLOCK-Marker", () => {
  const rules = [
    "/.*/$client=192.168.0.88  # CENTRAL-BLOCK",
    "/.*/$client=192.168.0.215  # CENTRAL-BLOCK",
    "||example.com^", // fremde Regel ohne Marker
  ];
  const s = blockedIps(rules);
  assert.deepEqual([...s].sort(), ["192.168.0.215", "192.168.0.88"]);
  assert.equal(MARKER, "# CENTRAL-BLOCK");
});
