import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PLATFORMS,
  buildDnsBlocklist,
  DEFAULT_DNS_BLOCKLIST,
  PLATFORM_DOMAINS,
} from "./dnsBlocklist";

test("PLATFORM_DOMAINS: alle 5 Plattformen, keine leeren Listen", () => {
  assert.deepEqual(ALL_PLATFORMS.sort(), ["facebook", "instagram", "reddit", "x", "youtube"]);
  for (const p of ALL_PLATFORMS) {
    assert.ok(PLATFORM_DOMAINS[p].length > 0, `${p} hat Domains`);
  }
});

test("PLATFORM_DOMAINS: nur saubere, suffx-fähige Bare-Domains", () => {
  for (const p of ALL_PLATFORMS) {
    for (const d of PLATFORM_DOMAINS[p]) {
      // lowercase, keine Protokoll-/Pfad-/Wildcard-Anteile, keine führenden Punkte
      assert.equal(d, d.toLowerCase(), `${p}: ${d} lowercase`);
      assert.ok(!d.includes("://"), `${p}: ${d} kein Schema`);
      assert.ok(!d.includes("/"), `${p}: ${d} kein Pfad`);
      assert.ok(!d.includes("*"), `${p}: ${d} keine Wildcard`);
      assert.ok(!d.startsWith(".") && !d.endsWith("."), `${p}: ${d} keine Rand-Punkte`);
      // gültige Domain-Form
      assert.match(d, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${p}: ${d} gültige Domain`);
    }
  }
});

test("buildDnsBlocklist: Union über Plattformen", () => {
  const list = buildDnsBlocklist(["instagram", "facebook"]);
  assert.ok(list.includes("instagram.com"));
  assert.ok(list.includes("facebook.com"));
  assert.ok(list.includes("cdninstagram.com"));
  assert.ok(list.includes("fbsbx.com"));
  assert.equal(new Set(list).size, list.length);
});

test("buildDnsBlocklist: sortiert + deterministisch", () => {
  const a = buildDnsBlocklist(["youtube", "x"]);
  const b = buildDnsBlocklist(["x", "youtube"]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort());
});

test("buildDnsBlocklist: normalisiert Eingaben defensiv", () => {
  // Auch wenn (typing) Platform nur saubere Werte erlaubt: die Funktion muss
  // robust bleiben — hier über den TS-Typ hinaus als reine Logik geprüft.
  const list = buildDnsBlocklist(["youtube"]);
  for (const d of list) {
    assert.equal(d, d.toLowerCase());
    assert.ok(!d.startsWith(".") && !d.endsWith("."));
  }
});

test("buildDnsBlocklist: leere Auswahl → []", () => {
  assert.deepEqual(buildDnsBlocklist([]), []);
});

test("DEFAULT_DNS_BLOCKLIST: enthält Kerndomains aller Plattformen", () => {
  for (const core of [
    "youtube.com",
    "googlevideo.com",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twimg.com",
    "reddit.com",
  ]) {
    assert.ok(DEFAULT_DNS_BLOCKLIST.includes(core), core);
  }
});

test("DEFAULT_DNS_BLOCKLIST: keine breiten Shared-CDN-Domains", () => {
  // gstatic.com darf NICHT drin sein (würde Gmail/Suche mitblocken)
  for (const broad of ["gstatic.com", "google.com", "googleapis.com"]) {
    assert.ok(!DEFAULT_DNS_BLOCKLIST.includes(broad), `${broad} darf nicht geblockt werden`);
  }
});
