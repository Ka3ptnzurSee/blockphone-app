// scripts/build-adblocklist.mjs — baut die Werbe-/Tracker-Domainliste für den
// DNS-Tunnel.
//
// Quelle (Default): StevenBlack/hosts (merged adware+malware, ~77k Domains).
// Der Filter macht Suffix-Matching — deshalb werden Subdomains verworfen, deren
// Eltern-Domain ohnehin gelistet ist ("ads.doubleclick.net" ist redundant, wenn
// "doubleclick.net" geblockt wird). Ergebnis: ~41k Wurzel-Domains.
//
// Ausgabe:
//   targets/packettunnel/adblock.json   → Bundle-Ressource der Tunnel-Extension
//   lib/adBlocklist.ts                  → nur die Anzahl (für die UI)
//
// Nutzung:  node scripts/build-adblocklist.mjs [url-oder-datei]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT_JSON = path.join(root, "targets/packettunnel/adblock.json");
const OUT_TS = path.join(root, "lib/adBlocklist.ts");

const SRC =
  process.argv[2] || "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts";

const SKIP = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
  "ip6-allnodes",
  "ip6-allrouters",
  "0.0.0.0",
]);

async function loadText(src) {
  if (/^https?:\/\//.test(src)) {
    // Timeout, damit ein hängender Download den Build nicht blockiert.
    const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
    return await res.text();
  }
  return fs.readFileSync(src, "utf8");
}

function parseHosts(text) {
  const domains = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const ip = parts[0];
    if (ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::1") continue;
    const host = parts[1].toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!host || SKIP.has(host)) continue;
    if (!/^[a-z0-9._-]+$/.test(host)) continue;
    if (!host.includes(".")) continue;
    domains.add(host);
  }
  return domains;
}

// Suffix-Matching: nur die obersten gelisteten Domains behalten.
function collapse(domains) {
  const out = [];
  for (const d of domains) {
    const parts = d.split(".");
    let redundant = false;
    for (let i = 1; i < parts.length - 1; i++) {
      if (domains.has(parts.slice(i).join("."))) {
        redundant = true;
        break;
      }
    }
    if (!redundant) out.push(d);
  }
  return out.sort();
}

const text = await loadText(SRC);
const parsed = parseHosts(text);
const minimal = collapse(parsed);

// Sanity-Gate: eine kaputte/leere Quelle darf die ausgelieferte Liste NICHT
// überschreiben (sonst schifft der Build einen wirkungslosen Blocker).
const MIN_PARSED = 1_000;
const MIN_MINIMAL = 500;
if (parsed.size < MIN_PARSED || minimal.length < MIN_MINIMAL) {
  console.error(
    `abgebrochen: nur ${parsed.size} Domains geparst / ${minimal.length} Wurzel-Domains ` +
      `(minimum ${MIN_PARSED}/${MIN_MINIMAL}). Quelle: ${SRC}`,
  );
  process.exit(1);
}

fs.writeFileSync(OUT_JSON, JSON.stringify(minimal));

fs.writeFileSync(
  OUT_TS,
  `// AUTO-GENERIERT von scripts/build-adblocklist.mjs — nicht von Hand bearbeiten.
// Quelle: ${SRC}
// ${parsed.size} Domains aus der Quelle → ${minimal.length} Wurzel-Domains
// (Subdomains sind per Suffix-Match abgedeckt).

/** Anzahl der Werbe-/Tracker-Domains, die der DNS-Tunnel blockt. */
export const AD_DOMAIN_COUNT = ${minimal.length};

/** Stand der Liste (ISO-Datum). */
export const AD_LIST_DATE = "${new Date().toISOString().slice(0, 10)}";
`,
);

const bytes = fs.statSync(OUT_JSON).size;
console.log(
  `ok: ${parsed.size} Domains → ${minimal.length} Wurzel-Domains (${(bytes / 1024).toFixed(0)} kB)`,
);
