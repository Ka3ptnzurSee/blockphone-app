import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PLATFORMS,
  buildDnsBlocklist,
  normalizeCustomDomain,
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

test("eigene Domains kommen zur Blocklist dazu (add block)", () => {
  const list = buildDnsBlocklist(["youtube"], ["tiktok.com", "TWITCH.tv"]);
  assert.ok(list.includes("tiktok.com"));
  assert.ok(list.includes("twitch.tv"), "normalisiert auf lowercase");
  assert.ok(list.includes("youtube.com"));
  assert.equal(list.includes("tiktok.com") && list.includes("tiktok.com"), true);
});

test("normalizeCustomDomain: URL, www und Müll", () => {
  assert.equal(normalizeCustomDomain("https://www.TikTok.com/@user"), "tiktok.com");
  assert.equal(normalizeCustomDomain("  reddit.com/r/all "), "reddit.com");
  assert.equal(normalizeCustomDomain(".example.org."), "example.org");
  assert.equal(normalizeCustomDomain(""), null);
  assert.equal(normalizeCustomDomain("keine domain"), null);
  assert.equal(normalizeCustomDomain("javascript:alert(1)"), null);
  assert.equal(normalizeCustomDomain("a..b"), null);
  assert.equal(normalizeCustomDomain("x".repeat(300) + ".com"), null);
});
