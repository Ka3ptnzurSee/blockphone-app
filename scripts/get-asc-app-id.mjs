// Gibt die App Store Connect App-ID (ascAppId) für eine Bundle-ID aus.
// Nutzung:
//   node scripts/get-asc-app-id.mjs com.meister.blockphone
//   BUNDLE_ID=com.meister.blockphone node scripts/get-asc-app-id.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

const appleUtils = require('/usr/lib/node_modules/eas-cli/node_modules/@expo/apple-utils');
const { Token, App } = appleUtils;

const keys = JSON.parse(fs.readFileSync(path.join(projectDir, 'credentials', 'keys.json'), 'utf8'));
const keyP8 = fs.readFileSync(path.join(projectDir, keys.ascApiKey.keyPath), 'utf8');
const BUNDLE_ID = process.env.BUNDLE_ID || process.argv[2];

async function main() {
  const token = new Token({ key: keyP8, issuerId: keys.ascApiKey.issuerId, keyId: keys.ascApiKey.keyId, duration: 1200 });
  const apps = await App.getAsync({ token });
  for (const a of apps) {
    if (!BUNDLE_ID || a.attributes.bundleId === BUNDLE_ID) {
      console.log(`id=${a.id}  bundleId=${a.attributes.bundleId}  name=${a.attributes.name}`);
    }
  }
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
