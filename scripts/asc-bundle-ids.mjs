#!/usr/bin/env node
// scripts/asc-bundle-ids.mjs — Apple-Targets provisionierbar machen.
//
// Legt die Bundle-IDs der drei Screen-Time-Extensions an (idempotent) und
// versucht, die nötigen Capabilities per ASC-API zu setzen. Was die API nicht
// darf (FAMILY_CONTROLS für Extensions, App-Group-Zuweisung), wird explizit
// als Portal-Aufgabe ausgegeben — nicht stillschweigend verschluckt.
//
// Nutzung:  node scripts/asc-bundle-ids.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const keys = JSON.parse(fs.readFileSync(path.join(projectDir, "credentials", "keys.json"), "utf8"));

const KEY_PATH = process.env.ASC_KEY_PATH || path.join(projectDir, keys.ascApiKey.keyPath);
const KEY_ID = process.env.ASC_KEY_ID || keys.ascApiKey.keyId;
const ISSUER_ID = process.env.ASC_ISSUER_ID || keys.ascApiKey.issuerId;
const DRY = process.argv.includes("--dry-run");

export const APP_GROUP = "group.com.meister.blockphone";

export const TARGETS = [
  { bundleId: "com.meister.blockphone.ShieldConfiguration", name: "Blockphone Shield", type: "shield-config" },
  { bundleId: "com.meister.blockphone.ShieldAction", name: "Blockphone Shield Action", type: "shield-action" },
  { bundleId: "com.meister.blockphone.DeviceActivityMonitor", name: "Blockphone Zeitlimits", type: "device-activity-monitor" },
];

export function makeJwt() {
  const key = fs.readFileSync(KEY_PATH, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data =
    enc({ alg: "ES256", kid: KEY_ID, typ: "JWT" }) +
    "." +
    enc({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" });
  return data + "." + crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

export async function api(method, endpoint, body, token = makeJwt()) {
  const res = await fetch("https://api.appstoreconnect.apple.com" + endpoint, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(`${method} ${endpoint} -> ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Exakter Vergleich — `filter[identifier]` matcht in der ASC-API als PREFIX. */
async function findBundleId(identifier, token) {
  const r = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=50`, null, token);
  return (r.data || []).find((b) => b.attributes.identifier === identifier) || null;
}

async function capabilities(bundleRowId, token) {
  const r = await api("GET", `/v1/bundleIds/${bundleRowId}/bundleIdCapabilities`, null, token);
  return (r.data || []).map((d) => d.attributes.capabilityType);
}

async function addCapability(bundleRowId, capabilityType, token) {
  return api(
    "POST",
    "/v1/bundleIdCapabilities",
    {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundleRowId } } },
      },
    },
    token,
  );
}

const token = makeJwt();
const portalTodo = [];
const report = [];

for (const t of TARGETS) {
  let row = await findBundleId(t.bundleId, token);
  if (!row) {
    if (DRY) {
      report.push(`+ ${t.bundleId} (würde angelegt)`);
      continue;
    }
    const created = await api(
      "POST",
      "/v1/bundleIds",
      {
        data: {
          type: "bundleIds",
          attributes: { identifier: t.bundleId, name: t.name, platform: "UNIVERSAL" },
        },
      },
      token,
    );
    row = created.data;
    report.push(`+ ${t.bundleId} angelegt (id ${row.id})`);
  } else {
    report.push(`= ${t.bundleId} existiert (id ${row.id})`);
  }

  // Capabilities: FAMILY_CONTROLS ist laut API kein gültiger Wert für
  // Extension-Bundle-IDs — wir versuchen es trotzdem und protokollieren die
  // exakte Antwort, statt es zu behaupten.
  const before = await capabilities(row.id, token);
  for (const cap of ["FAMILY_CONTROLS", "APP_GROUPS"]) {
    if (before.includes(cap)) {
      report.push(`  · ${cap} schon gesetzt`);
      continue;
    }
    if (DRY) {
      report.push(`  · ${cap} (würde gesetzt)`);
      continue;
    }
    try {
      await addCapability(row.id, cap, token);
      report.push(`  ✓ ${cap} gesetzt`);
    } catch (e) {
      const detail = (e.body?.errors || []).map((x) => `${x.code}: ${x.detail}`).join(" | ") || String(e.message);
      report.push(`  ✗ ${cap} nicht per API (${e.status}): ${detail}`);
      portalTodo.push(`${t.bundleId}: ${cap} im Portal freigeben`);
    }
  }
}

console.log("=== Bundle-IDs ===");
report.forEach((l) => console.log(l));

if (portalTodo.length) {
  console.log("\n=== Portal-Aufgaben (API kann das nicht) ===");
  portalTodo.forEach((l) => console.log("- " + l));
  console.log(`- App Group ${APP_GROUP}: anlegen und den App-IDs zuweisen (Apps/Identifiers → App Groups)`);
}

// Immer prüfen: hat die Haupt-App FAMILY_CONTROLS + APP_GROUPS?
const main = await findBundleId("com.meister.blockphone", token);
if (main) {
  const caps = await capabilities(main.id, token);
  console.log(
    `\nHaupt-App: FAMILY_CONTROLS=${caps.includes("FAMILY_CONTROLS")} APP_GROUPS=${caps.includes("APP_GROUPS")} FAMILY_CONTROLS_DISTRIBUTION=${caps.includes("FAMILY_CONTROLS_DISTRIBUTION")}`,
  );
}
