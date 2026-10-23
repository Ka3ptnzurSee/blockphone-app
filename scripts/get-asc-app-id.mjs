// Gibt die App Store Connect App-ID (ascAppId) für eine Bundle-ID aus.
// Nutzung:
//   node scripts/get-asc-app-id.mjs com.meister.blockphone
//   BUNDLE_ID=com.meister.blockphone node scripts/get-asc-app-id.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppleUtils, createContext } from './lib/apple.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

const BUNDLE_ID = process.env.BUNDLE_ID || process.argv[2];
if (!BUNDLE_ID) {
  console.error('FEHLER: Bundle-ID als Argument oder BUNDLE_ID angeben.');
  process.exit(1);
}

async function main() {
  const { App } = loadAppleUtils();
  const { context } = createContext(projectDir);
  const apps = await App.getAsync(context);
  const match = apps.filter((a) => a.attributes.bundleId === BUNDLE_ID);
  if (match.length === 0) {
    console.error(`Keine App mit bundleId "${BUNDLE_ID}" gefunden. App-Record existiert noch nicht?`);
    process.exit(1);
  }
  for (const a of match) {
    console.log(`id=${a.id}  bundleId=${a.attributes.bundleId}  name=${a.attributes.name}`);
  }
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
