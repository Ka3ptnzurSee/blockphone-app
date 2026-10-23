// Fügt die Push-Notifications-Capability zu einer Bundle-ID hinzu (ASC-API).
// Danach muss das Provisioning-Profil neu erzeugt werden (provision-ios-reuse.mjs).
//
// Nutzung:
//   BUNDLE_ID=com.meister.blockphone node scripts/add-push-capability.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppleUtils, createContext } from './lib/apple.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

const { BundleId, CapabilityType } = loadAppleUtils();

const BUNDLE_ID = process.env.BUNDLE_ID || 'com.meister.blockphone';
const API = 'https://api.appstoreconnect.apple.com/v1';

async function main() {
  const { token, context } = createContext(projectDir);

  const bundleId = await BundleId.findAsync(context, { identifier: BUNDLE_ID });
  if (!bundleId) {
    throw new Error(`Bundle-ID "${BUNDLE_ID}" nicht gefunden.`);
  }
  console.log(`✓ Bundle-ID gefunden (id=${bundleId.id})`);

  // Vorhandene Capabilities prüfen (idempotent)
  const caps = await bundleId.getBundleIdCapabilitiesAsync();
  const hasPush = caps.some((c) => c.attributes.capabilityType === CapabilityType.PUSH_NOTIFICATIONS);
  if (hasPush) {
    console.log('✓ Push-Notifications-Capability ist bereits aktiviert.');
    return;
  }

  const jwt = await token.getToken();
  const res = await fetch(`${API}/bundleIdCapabilities`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleId.id } },
        },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ASC-API Fehler ${res.status}: ${body.slice(0, 500)}`);
  }
  console.log('✓ Push-Notifications-Capability aktiviert.');
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
