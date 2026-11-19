#!/usr/bin/env node
// scripts/asc-ext-profiles.mjs — Provisioning-Profile fuer die Screen-Time-
// Extensions anlegen (idempotent) und die ECHTEN Entitlements aus der
// .mobileprovision auslesen.
//
// Warum: ein Shield-/DeviceActivity-Extension-Target laesst sich nur bauen,
// wenn sein Profil die Capability `com.apple.developer.family-controls`
// enthaelt. Die ASC-API kann diese Capability nicht setzen (409
// ENTITY_ERROR.ATTRIBUTE.TYPE) — das geht nur im Developer-Portal.
// Dieses Skript beantwortet die Frage messbar: steht sie im Profil oder nicht?
//
// Nutzung:
//   node scripts/asc-ext-profiles.mjs            # anlegen/pruefen + Tabelle
//   node scripts/asc-ext-profiles.mjs --dry-run  # nur lesen, nichts anlegen
//   node scripts/asc-ext-profiles.mjs --out credentials  # .mobileprovision ablegen
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, TARGETS, APP_GROUP } from "./asc-bundle-ids.mjs";
import plist from "plist";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry-run");
// Nach einer Capability-Aenderung im Portal sind die alten Profile WERTLOS
// (Entitlements sind eingebacken) — dann mit --recreate neu erzeugen.
const RECREATE = process.argv.includes("--recreate");
const outIdx = process.argv.indexOf("--out");
const OUT_DIR = outIdx > -1 ? path.resolve(projectDir, process.argv[outIdx + 1]) : null;

const MAIN = "com.meister.blockphone";
const ALL = [{ bundleId: MAIN, name: "Blockphone" }, ...TARGETS];

async function listAll(endpoint) {
  let url = endpoint + (endpoint.includes("?") ? "&" : "?") + "limit=200";
  const out = [];
  for (let page = 0; page < 20; page++) {
    const res = await api("GET", url);
    out.push(...(res.data || []));
    const next = res.links && res.links.next;
    if (!next) break;
    url = next.replace("https://api.appstoreconnect.apple.com/v1/", "/v1/");
  }
  return out;
}

function entitlementsOf(profileBase64) {
  // .mobileprovision = CMS mit eingebettetem XML-Plist. Wir schneiden den
  // Plist-Block heraus (<?xml ... </plist>) und parsen ihn.
  const raw = Buffer.from(profileBase64, "base64").toString("utf8");
  const start = raw.indexOf("<?xml");
  const end = raw.indexOf("</plist>");
  if (start < 0 || end < 0) return null;
  const doc = plist.parse(raw.slice(start, end + "</plist>".length));
  return doc;
}

function summarize(doc) {
  const ent = (doc && doc.Entitlements) || {};
  const groups = ent["com.apple.security.application-groups"] || [];
  return {
    appId: ent["application-identifier"] || "",
    familyControls: ent["com.apple.developer.family-controls"] === true,
    appGroups: Array.isArray(groups) ? groups : [],
    expiry: (doc && doc.ExpirationDate) || null,
    name: (doc && doc.Name) || "",
  };
}

async function main() {
  const bundles = await listAll("/v1/bundleIds?fields[bundleIds]=identifier,name");
  const byIdentifier = new Map(bundles.map((b) => [b.attributes.identifier, b.id]));

  const certs = await listAll("/v1/certificates?fields[certificates]=name,certificateType,expirationDate");
  const dist = certs.filter((c) =>
    ["DISTRIBUTION", "IOS_DISTRIBUTION"].includes(c.attributes.certificateType) &&
    new Date(c.attributes.expirationDate) > new Date(Date.now() + 7 * 864e5)
  );
  if (!dist.length) throw new Error("Kein gueltiges Distribution-Zertifikat gefunden");
  // Neuestes zuerst (das ist das, was credentials.json als bp_legacy.p12 nutzt).
  dist.sort((a, b) => new Date(b.attributes.expirationDate) - new Date(a.attributes.expirationDate));
  const cert = dist[0];
  console.log(`Zertifikat: ${cert.attributes.name} (${cert.attributes.certificateType}), gueltig bis ${cert.attributes.expirationDate}`);

  const profiles = await listAll("/v1/profiles?fields[profiles]=name,profileType,profileState,profileContent,uuid");
  console.log(`Vorhandene Profile: ${profiles.length}`);

  const rows = [];
  for (const t of ALL) {
    const bundleIdResId = byIdentifier.get(t.bundleId);
    if (!bundleIdResId) {
      rows.push({ target: t.bundleId, status: "keine Bundle-ID", fc: "-", groups: "-" });
      continue;
    }
    // Passendes App-Store-Profil suchen: Name enthaelt den Bundle-ID-Teil.
    const suffix = t.bundleId.replace(MAIN, "") || "app";
    let prof = profiles.find((p) => {
      const n = p.attributes.name.toLowerCase();
      return n.includes("blockphone") && (suffix === "app" ? !n.includes(".shield") && !n.includes("device") && !n.includes("tunnel") : n.includes(suffix.replace(".", "").toLowerCase()));
    });
    if (prof && RECREATE && !DRY) {
      try {
        await api("DELETE", `/v1/profiles/${prof.id}`);
        console.log(`- altes Profil geloescht: ${prof.attributes.name}`);
      } catch (e) {
        console.log(`! Loeschen fehlgeschlagen (${e.status}) — bleibt bestehen`);
      }
      profiles.splice(profiles.indexOf(prof), 1);
      prof = undefined;
    }
    if (!prof && !DRY) {
      const body = {
        data: {
          type: "profiles",
          attributes: {
            name: `Blockphone ${suffix === "app" ? "App Store" : suffix.replace(".", " ")}`,
            profileType: "IOS_APP_STORE",
          },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleIdResId } },
            certificates: { data: [{ type: "certificates", id: cert.id }] },
          },
        },
      };
      try {
        const created = await api("POST", "/v1/profiles", body);
        prof = { id: created.data.id, attributes: { ...created.data.attributes } };
        profiles.push(prof);
        console.log(`+ Profil angelegt: ${prof.attributes.name || "(ohne Namen)"} fuer ${t.bundleId}`);
      } catch (e) {
        rows.push({ target: t.bundleId, status: `POST /profiles ${e.status}: ${JSON.stringify(e.body).slice(0, 120)}`, fc: "-", groups: "-" });
        continue;
      }
    }
    if (!prof) {
      rows.push({ target: t.bundleId, status: "kein Profil (dry-run)", fc: "-", groups: "-" });
      continue;
    }
    // Inhalt frisch holen (bei POST ist profileContent dabei, sonst nachladen).
    let content = prof.attributes && prof.attributes.profileContent;
    if (!content) {
      const full = await api("GET", `/v1/profiles/${prof.id}`);
      content = full.data.attributes.profileContent;
    }
    if (OUT_DIR) {
      const file = path.join(OUT_DIR, `appstore_${t.bundleId.split(".").pop().toLowerCase()}.mobileprovision`);
      fs.writeFileSync(file, Buffer.from(content, "base64"));
      console.log(`  gespeichert: ${path.relative(projectDir, file)}`);
    }
    const doc = entitlementsOf(content);
    const s = summarize(doc);
    rows.push({
      target: t.bundleId,
      status: s.name || "(Profil ohne Namen)",
      fc: s.familyControls ? "JA" : "NEIN",
      groups: s.appGroups.length ? s.appGroups.join(",") : "—",
    });
  }

  console.log("\nZiel | Profil | family-controls | App-Groups");
  console.log("---|---|---|---");
  for (const r of rows) console.log(`${r.target} | ${r.status} | ${r.fc} | ${r.groups}`);
  const missing = rows.filter((r) => r.fc !== "JA");
  if (missing.length) {
    console.log(`\n${missing.length} Ziel(e) ohne family-controls im Profil → Portal: App-ID oeffnen,`);
    console.log("Capability 'Family Controls' hinzufuegen (API kann das nicht), danach erneut laufen lassen.");
  }
  const needGroup = rows.filter((r) => r.groups !== "—" && !String(r.groups).includes(APP_GROUP));
  if (needGroup.length) console.log(`App Group ${APP_GROUP} fehlt bei: ${needGroup.map((r) => r.target).join(", ")}`);
}

main().catch((e) => {
  console.error("FEHLER:", e.status ? `${e.status} ${JSON.stringify(e.body)}` : e.message);
  process.exit(1);
});
