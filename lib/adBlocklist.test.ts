// Sanity-Checks der generierten Werbe-/Tracker-Liste (Ressource des DNS-Tunnels).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adSuffixMatch } from "./testHelpers/adSuffixMatch";
import { AD_DOMAIN_COUNT, AD_LIST_DATE } from "./adBlocklist";

const json = JSON.parse(readFileSync("targets/packettunnel/adblock.json", "utf8")) as string[];

test("adblock.json ist nicht leer und passt zum Zähler", () => {
  assert.ok(json.length > 10_000, `nur ${json.length} Domains`);
  assert.equal(json.length, AD_DOMAIN_COUNT);
  assert.match(AD_LIST_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test("Einträge sind normale Hostnamen (kein Punkt/Wildcard/Pfad, klein)", () => {
  for (const d of json.slice(0, 5000)) {
    assert.ok(!d.startsWith("."), `Punkt: ${d}`);
    assert.ok(!d.includes("*"), `Wildcard: ${d}`);
    assert.ok(!d.includes("/"), `Pfad: ${d}`);
    assert.equal(d, d.toLowerCase());
  }
});

test("Suffix-Match blockt Werbe-Hosts und lässt normale Seiten durch", () => {
  const set = new Set(json);
  assert.ok(adSuffixMatch("doubleclick.net", set), "doubleclick fehlt");
  assert.ok(adSuffixMatch("a.b.doubleclick.net", set), "Suffix-Match fehlt");
  assert.ok(!adSuffixMatch("web.de", set));
  assert.ok(!adSuffixMatch("", set));
  assert.ok(!adSuffixMatch(".", set));
  assert.ok(!adSuffixMatch("notdoubleclick.net", set));
});
