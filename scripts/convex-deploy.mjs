#!/usr/bin/env node
// scripts/convex-deploy.mjs
//
// Hängt ein bestehendes Convex-Deployment in den iOS-Build.
//
// Problem, das dieses Skript löst: `EXPO_PUBLIC_CONVEX_URL` muss zur BUILDZEIT
// im Bundle stehen (Expo inlined EXPO_PUBLIC_*). Steht die Variable weder in
// eas.json noch als EAS-Secret, ist der Server-Teil der App stumm.
//
// Ablauf:
//   1. URL bestimmen: CONVEX_URL (Env) → sonst `npx convex deployment info` im
//      Projekt (deployt seinerseits nichts).
//   2. URL in eas.json → build.preview.env / build.production.env schreiben.
//   3. .env.local schreiben (für lokale Builds / expo start).
//
// Aufruf: node scripts/convex-deploy.mjs [--url https://xxx.convex.cloud] [--dry-run]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlFlag = args.indexOf("--url");
const CLR = { ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };

function fail(msg, hint) {
  console.error(`${CLR.err}✗ ${msg}${CLR.off}`);
  if (hint) console.error(`${CLR.dim}  ${hint}${CLR.off}`);
  process.exit(1);
}

function resolveUrl() {
  if (urlFlag !== -1 && args[urlFlag + 1]) return args[urlFlag + 1];
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  try {
    const out = execFileSync("npx", ["convex", "deployment", "info"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60000,
    });
    const m = out.match(/https:\/\/[a-z0-9-]+\.convex\.(cloud|site)/i);
    if (m) return m[0];
  } catch {
    /* kein Login / kein Deployment → unten sauber melden */
  }
  return null;
}

const url = resolveUrl();
if (!url) {
  fail(
    "Kein Convex-Deployment gefunden (CONVEX_URL leer, `npx convex deployment info` ohne Ergebnis).",
    "Einmalig: npx convex dev --once   → danach dieses Skript erneut.",
  );
}
if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud\/?$/i.test(url)) {
  fail(`Unerwartete Convex-URL: ${url}`, "Erwartet: https://<deployment>.convex.cloud");
}

const easPath = join(root, "eas.json");
if (!existsSync(easPath)) fail("eas.json fehlt");

const eas = JSON.parse(readFileSync(easPath, "utf8"));
eas.build = eas.build || {};
let changed = 0;
for (const profile of ["production", "preview"]) {
  eas.build[profile] = eas.build[profile] || {};
  eas.build[profile].env = eas.build[profile].env || {};
  if (eas.build[profile].env.EXPO_PUBLIC_CONVEX_URL !== url) {
    eas.build[profile].env.EXPO_PUBLIC_CONVEX_URL = url;
    changed += 1;
  }
}

if (dryRun) {
  console.log(`${CLR.warn}--dry-run${CLR.off} — eas.json würde geschrieben:\n`);
  console.log(JSON.stringify({ build: { production: eas.build.production, preview: eas.build.preview } }, null, 2));
  process.exit(0);
}

writeFileSync(easPath, JSON.stringify(eas, null, 2) + "\n");
writeFileSync(join(root, ".env.local"), `EXPO_PUBLIC_CONVEX_URL=${url}\n`);

console.log(`${CLR.ok}✓${CLR.off} EXPO_PUBLIC_CONVEX_URL=${url}`);
console.log(`  · eas.json (production, preview) — ${changed} Profil(e) aktualisiert`);
console.log("  · .env.local");
console.log(`${CLR.dim}  Nächster Build inlined die URL. Lokal: npx expo start --clear${CLR.off}`);
