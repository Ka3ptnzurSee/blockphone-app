import fs from "node:fs";
import jwt from "/opt/tools/nexus/orchestrator/node_modules/jsonwebtoken/index.js";

const KEY = "/opt/pi-app/app/credentials/AscApiKey_26AXZ5M8UR.p8";
const CREDS = JSON.parse(fs.readFileSync("/opt/pi-app/app/credentials/keys.json", "utf8"));
const now = Math.floor(Date.now() / 1000);
const token = jwt.sign({ iss: CREDS.issuer_id, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }, fs.readFileSync(KEY, "utf8"), { algorithm: "ES256" });
const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

const BID = process.argv[2] || "S5G585GLXQ";
const CAP = process.argv[3] || "FAMILY_CONTROLS";

const list = await fetch(`https://api.appstoreconnect.apple.com/v1/bundleIds/${BID}/bundleIdCapabilities`, { headers: H });
const lj = await list.json();
console.log("IST:", (lj.data || []).map(d => d.attributes.capabilityType).join(", ") || "(keine)");

const res = await fetch("https://api.appstoreconnect.apple.com/v1/bundleIdCapabilities", {
  method: "POST",
  headers: H,
  body: JSON.stringify({ data: { type: "bundleIdCapabilities", attributes: { capabilityType: CAP }, relationships: { bundleId: { data: { type: "bundleIds", id: BID } } } } }),
});
const txt = await res.text();
console.log("POST", CAP, res.status, txt.slice(0, 400));

