// Auto-Completer: erkennt neu angelegte App-Records per ASC-API und füllt
// ascAppId automatisch in eas.json ein. Optional direkt Submit anstoßen.
//
// Nutzung:
//   node scripts/complete-app-record.mjs <bundleId>   # erkennt App-Record, füllt eas.json
//   SUBMIT=1 node scripts/complete-app-record.mjs <bundleId>  # + eas submit danach
//
// Typischer Ablauf:
//   1) User legt App-Record im Browser an (appstoreconnect.apple.com → + → New App)
//   2) Dieses Skript läuft: findet den Record, patcht eas.json → fertig für Submit.
import fs from 'node:fs';
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

  console.log(`→ Suche App-Record für "${BUNDLE_ID}" …`);
  const apps = await App.getAsync(context);
  const match = apps.filter((a) => a.attributes.bundleId === BUNDLE_ID);

  if (match.length === 0) {
    console.error(`\n✖ Kein App-Record für "${BUNDLE_ID}" gefunden.`);
    console.error(`  → Bitte im Browser anlegen:\n     https://appstoreconnect.apple.com/apps\n     „+" → New App → Plattform iOS, Name + Bundle-ID "${BUNDLE_ID}", SKU frei wählen.\n     Danach dieses Skript erneut ausführen.`);
    process.exit(2);
  }

  const app = match[0];
  console.log(`✓ App-Record gefunden: id=${app.id}  name=${app.attributes.name}`);

  // eas.json patchen (ascAppId ersetzen)
  const easPath = path.join(projectDir, 'eas.json');
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  const ios = eas.submit?.production?.ios;
  if (!ios) {
    console.error('FEHLER: eas.json hat kein submit.production.ios.');
    process.exit(1);
  }
  ios.ascAppId = app.id;
  fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n');
  console.log(`✓ eas.json aktualisiert: ascAppId=${app.id}`);

  // keys.json ebenfalls aktualisieren (Konsistenz)
  const keysPath = path.join(projectDir, 'credentials', 'keys.json');
  try {
    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    keys.appStoreConnect = {
      ...(keys.appStoreConnect || {}),
      ascAppId: app.id,
      appName: app.attributes.name,
      bundleIdentifier: BUNDLE_ID,
    };
    fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2) + '\n');
    console.log('✓ credentials/keys.json aktualisiert.');
  } catch (e) {
    console.warn(`WARNUNG: keys.json nicht aktualisierbar: ${e?.message ?? e}`);
  }

  console.log('\n=== Fertig ===');
  console.log(`Bundle-ID: ${BUNDLE_ID}`);
  console.log(`ascAppId:  ${app.id}`);
  if (process.env.SUBMIT === '1') {
    console.log('\n→ eas submit wird gestartet …');
  } else {
    console.log('\nNächster Schritt: SUBMIT=1 node scripts/complete-app-record.mjs ' + BUNDLE_ID + '\n  oder: eas submit --platform ios --profile production');
  }
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
