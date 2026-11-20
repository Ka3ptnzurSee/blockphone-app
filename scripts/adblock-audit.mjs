// scripts/adblock-audit.mjs — prüft die ausgelieferte Werbe-/Tracker-Liste
// (targets/packettunnel/adblock.json) auf Wirksamkeit und Fehlalarme.
//
// Nutzung: node scripts/adblock-audit.mjs
// Exit 1 nur bei harten Fehlern (kaputtes Format, Fehlalarm auf Kern-Infrastruktur).
//
// WICHTIG zur Aussagekraft: Der Matching-Algorithmus ist hier 1:1 aus
// DnsFilter.swift::matches nachgebaut (Labels splitten, von links kürzen).
// Das prüft die LISTE, nicht den Swift-Code — für den Swift-Code gibt es
// lib/tunnelConfig.test.ts (Quelltext-Assertions) und den CI-Kompilierlauf.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listPath = path.join(root, "targets/packettunnel/adblock.json");
const raw = JSON.parse(readFileSync(listPath, "utf8"));

/** 1:1 wie DnsFilter.swift::clean — trailing dots weg, lowercase. */
const clean = (arr) =>
  arr
    .map((d) => String(d).toLowerCase().trim().replace(/^\.+|\.+$/g, ""))
    .filter((d) => d.length > 0);

/** 1:1 wie DnsFilter.swift::matches. */
function matches(name, set) {
  const parts = name.toLowerCase().split(".");
  while (parts.length > 0) {
    if (set.has(parts.join("."))) return true;
    parts.shift();
  }
  return false;
}

const set = new Set(clean(raw));

// --- Format ---------------------------------------------------------------
const upper = raw.filter((d) => d !== String(d).toLowerCase()).length;
const trailingDot = raw.filter((d) => String(d).trim().endsWith(".")).length;
const empty = raw.filter((d) => String(d).trim() === "").length;
const wildcard = raw.filter((d) => d.includes("*")).length;
const isIp = raw.filter((d) => /^\d{1,3}(\.\d{1,3}){3}$/.test(d)).length;
const tooLong = raw.filter((d) => String(d).length > 253).length;
const bareTld = raw.filter((d) => !String(d).includes(".")).length;
const dupes = raw.length - set.size;

// --- Wirksamkeit: greift Subdomain-Matching? ------------------------------
const adSamples = [
  "doubleclick.net",
  "googlesyndication.com",
  "google-analytics.com",
  "adservice.google.com",
  "scorecardresearch.com",
  "adsrvr.org",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "moatads.com",
  "amazon-adsystem.com",
  "connect.facebook.net",
  "clarity.ms",
  "amplitude.com",
  "segment.io",
  "admob.com",
  "app-measurement.com",
  "branch.io",
  "adjust.com",
  "appsflyer.com",
];
const trackerCoverage = adSamples.map((d) => [d, matches(d, set)]);
const missingTrackers = trackerCoverage.filter(([, ok]) => !ok).map(([d]) => d);

// Subdomain-Test: gelistete Eltern-Domain muss Subdomains mitnehmen.
const subdomainProbe = [
  ["ads.doubleclick.net", "doubleclick.net"],
  ["www.googletagmanager.com", null],
  ["deep.sub.criteo.com", "criteo.com"],
];
const subdomainOk = subdomainProbe
  .filter(([, parent]) => parent)
  .map(([host, parent]) => [host, matches(host, set), matches(parent, set)]);

// --- Fehlalarme: Kern-Infrastruktur darf NICHT geblockt werden ------------
const mustResolve = [
  "apple.com",
  "www.apple.com",
  "icloud.com",
  "gstatic.com",
  "apis.google.com",
  "whatsapp.net",
  "whatsapp.com",
  "telegram.org",
  "signal.org",
  "github.com",
  "amazonaws.com",
  "cloudflare.com",
  "spotify.com",
  "htw-dresden.de",
  "bildungsportal.sachsen.de",
  "paypal.com",
  "deutsche-bank.de",
  "elster.de",
];
const falsePositives = mustResolve.filter((d) => matches(d, set));

// --- Near-Misses: darf NICHT als Tracker gelten ---------------------------
const nearMisses = ["notdoubleclick.net", "doubleclick.net.evil.com", "criteo.com.br"];
const nearMissHits = nearMisses.filter((d) => matches(d, set));

console.log(`Liste: ${listPath.replace(root + "/", "")}`);
console.log(`Einträge roh=${raw.length} eindeutig=${set.size} Duplikate=${dupes}`);
console.log(
  `Format: leer=${empty} uppercase=${upper} trailingDot=${trailingDot} wildcard=${wildcard} ` +
    `IP-Literal=${isIp} >253=${tooLong} ohne-Punkt=${bareTld}`,
);
console.log(
  `Tracker-Abdeckung: ${adSamples.length - missingTrackers.length}/${adSamples.length}` +
    (missingTrackers.length ? ` — fehlt: ${missingTrackers.join(", ")}` : ""),
);
for (const [host, hostHit, parentHit] of subdomainOk) {
  console.log(`Subdomain: ${host} blockiert=${hostHit} (Eltern ${parentHit ? "gelistet" : "fehlt"})`);
}
console.log(
  `Fehlalarme auf Kern-Infrastruktur: ${falsePositives.length}` +
    (falsePositives.length ? ` — ${falsePositives.join(", ")}` : " (keine)"),
);
console.log(`Near-Miss fälschlich geblockt: ${nearMissHits.length}${nearMissHits.length ? " — " + nearMissHits.join(", ") : " (keine)"}`);

// Harte Fehler: kaputtes Format oder blockierte Kern-Infrastruktur.
const hardFailures = [];
if (empty > 0 || wildcard > 0 || tooLong > 0 || bareTld > 0) {
  hardFailures.push("Formatfehler in der Liste (leer/wildcard/>253/ohne Punkt)");
}
if (falsePositives.length > 0) hardFailures.push(`Fehlalarm: ${falsePositives.join(", ")}`);
if (adSamples.length - missingTrackers.length < adSamples.length * 0.8) {
  hardFailures.push(`Tracker-Abdeckung unter 80 % (${adSamples.length - missingTrackers.length}/${adSamples.length})`);
}
if (hardFailures.length) {
  console.error("\nROT: " + hardFailures.join(" | "));
  process.exit(1);
}
console.log("\nGRÜN: Liste formatfest, keine Fehlalarme auf Kern-Infrastruktur, Abdeckung ≥ 80 %.");
