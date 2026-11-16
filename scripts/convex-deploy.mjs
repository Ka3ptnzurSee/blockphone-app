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
//   1. URL bestimmen (in dieser Reihenfolge):
//        --url <url>            explizit
//        CONVEX_URL             Env
//        .env.local / .env      dort schreibt `npx convex dev` CONVEX_URL und
//                               CONVEX_DEPLOYMENT=<prod|dev>:<slug> hinein
//      Aus CONVEX_DEPLOYMENT wird die URL gebaut: https://<slug>.convex.cloud.
//      (`convex deployment info` gibt es NICHT — geprüft 16.11.2026; der
//      Unterbefehl kennt nur select/create/token/usage/usage-limits.)
//   2. URL in eas.json → build.preview.env / build.production.env schreiben.
//   3. .env.local schreiben (für lokale Builds / expo start) — CONVEX_URL bleibt
//      dabei erhalten, damit nachfolgende Aufrufe die Deployment-Referenz nicht
//      verlieren.
//
// Aufruf: node scripts/convex-deploy.mjs [--url https://xxx.convex.cloud] [--dry-run]
//
// Aufruf: node scripts/convex-deploy.mjs [--url https://xxx.convex.cloud] [--dry-run]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILES = [".env.local", ".env"];
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlFlag = args.indexOf("--url");
const CLR = { ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };

function fail(msg, hint) {
  console.error(`${CLR.err}✗ ${msg}${CLR.off}`);
  if (hint) console.error(`${CLR.dim}  ${hint}${CLR.off}`);
  process.exit(1);
}

/** Liest KEY=VALUE aus einer .env-Datei (nur die zwei Schlüssel, die zählen). */
function readEnvFile(file) {
  const path = join(root, file);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(CONVEX_URL|CONVEX_DEPLOYMENT)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** "prod:fluffy-panda-123" → "https://fluffy-panda-123.convex.cloud" */
function urlFromDeploymentRef(ref) {
  if (!ref) return null;
  const slug = String(ref).includes(":") ? String(ref).split(":").pop() : String(ref);
  return /^[a-z0-9-]+$/i.test(slug) ? `https://${slug}.convex.cloud` : null;
}

function resolveUrl() {
  if (urlFlag !== -1 && args[urlFlag + 1]) return args[urlFlag + 1];
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  if (process.env.CONVEX_DEPLOYMENT) {
    const fromRef = urlFromDeploymentRef(process.env.CONVEX_DEPLOYMENT);
    if (fromRef) return fromRef;
  }
  for (const file of ENV_FILES) {
    const env = readEnvFile(file);
    if (env.CONVEX_URL) return env.CONVEX_URL;
    const fromRef = urlFromDeploymentRef(env.CONVEX_DEPLOYMENT);
    if (fromRef) return fromRef;
  }
  return null;
}

const url = resolveUrl();
if (!url) {
  fail(
    "Kein Convex-Deployment gefunden (kein --url, kein CONVEX_URL, keine CONVEX_DEPLOYMENT in .env.local/.env).",
    "Einmalig: npx convex dev --once   → danach dieses Skript erneut (oder --url <https://x.convex.cloud>).",
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

// .env.local gezielt ergänzen statt überschreiben — dort stehen die
// Deployment-Referenzen, die `npx convex dev` gepflegt hat.
const envPath = join(root, ".env.local");
const line = `EXPO_PUBLIC_CONVEX_URL=${url}`;
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
const kept = existing.filter((l) => l.trim() && !l.startsWith("EXPO_PUBLIC_CONVEX_URL="));
writeFileSync(envPath, [...kept, line, ""].join("\n"));

console.log(`${CLR.ok}✓${CLR.off} EXPO_PUBLIC_CONVEX_URL=${url}`);
console.log(`  · eas.json (production, preview) — ${changed} Profil(e) aktualisiert`);
console.log("  · .env.local");
console.log(`${CLR.dim}  Nächster Build inlined die URL. Lokal: npx expo start --clear${CLR.off}`);
