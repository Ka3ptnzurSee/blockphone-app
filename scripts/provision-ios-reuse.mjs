// Provisionierung einer NEUEN App unter WIEDERVERWENDUNG eines bestehenden
// iOS-Distribution-Zertifikats (statt ein neues zu erzeugen → schont das
// Apple-Limit von 3 Distribution-Zertifikaten pro Team).
//
// Erzeugt: Bundle-ID (falls nötig) + App-Store-Provisioning-Profil.
// Übernimmt p12 + Passwort aus der vorhandenen credentials.json.
//
// Nutzung:
//   BUNDLE_ID=com.meister.blockphone APP_NAME="Blockphone" \
//   REUSE_CERT_ID=SS85KG94PB node scripts/provision-ios-reuse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

function loadAppleUtils() {
  const candidates = [
    '/usr/lib/node_modules/eas-cli/node_modules/@expo/apple-utils',
    'C:/Users/Meister/AppData/Roaming/npm/node_modules/eas-cli/node_modules/@expo/apple-utils',
    path.join(projectDir, 'node_modules/@expo/apple-utils'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* weiter */ }
  }
  throw new Error('@expo/apple-utils nicht gefunden – eas-cli global installieren: npm i -g eas-cli');
}

const {
  Token, BundleId, BundleIdPlatform, Certificate, CertificateType,
  Profile, ProfileType,
} = loadAppleUtils();

const keys = JSON.parse(fs.readFileSync(path.join(projectDir, 'credentials', 'keys.json'), 'utf8'));
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.meister.blockphone';
const APP_NAME = process.env.APP_NAME || 'Blockphone';
const REUSE_CERT_ID = process.env.REUSE_CERT_ID || 'SS85KG94PB';

async function main() {
  const keyP8 = fs.readFileSync(path.join(projectDir, keys.ascApiKey.keyPath), 'utf8');
  if (!keyP8.includes('PRIVATE KEY')) {
    throw new Error(`${keys.ascApiKey.keyPath} sieht nicht nach einer .p8-Datei aus`);
  }
  const token = new Token({ key: keyP8, issuerId: keys.ascApiKey.issuerId, keyId: keys.ascApiKey.keyId, duration: 1200 });
  const context = { token };

  // 1) Bundle-ID anlegen / finden
  let bundleId = await BundleId.findAsync(context, { identifier: BUNDLE_ID });
  if (!bundleId) {
    console.log(`→ Bundle-ID "${BUNDLE_ID}" anlegen …`);
    bundleId = await BundleId.createAsync(context, {
      name: APP_NAME, identifier: BUNDLE_ID, platform: BundleIdPlatform.IOS,
    });
    console.log(`✓ Bundle-ID angelegt (id=${bundleId.id})`);
  } else {
    console.log(`✓ Bundle-ID existiert bereits (id=${bundleId.id})`);
  }

  // 2) Bestehendes Distribution-Zertifikat wiederverwenden
  let cert;
  try {
    cert = await Certificate.infoAsync(context, { id: REUSE_CERT_ID });
    console.log(`✓ Zertifikat wiederverwendet (id=${cert.id}, serial=${cert.attributes.serialNumber}, expires=${cert.attributes.expirationDate})`);
  } catch {
    throw new Error(`Zertifikat ${REUSE_CERT_ID} nicht gefunden – REUSE_CERT_ID prüfen.`);
  }
  if (![CertificateType.IOS_DISTRIBUTION, CertificateType.DISTRIBUTION].includes(cert.attributes.certificateType)) {
    throw new Error(`Zertifikat ${REUSE_CERT_ID} ist kein iOS-Distribution-Zertifikat (type=${cert.attributes.certificateType}).`);
  }

  // 3) App-Store-Provisioning-Profil
  const profileName = `${APP_NAME} ${BUNDLE_ID} AppStore`;
  console.log(`→ Provisioning-Profil "${profileName}" erzeugen …`);
  const profile = await Profile.createAsync(context, {
    bundleId: bundleId.id,
    certificates: [cert.id],
    devices: [],
    name: profileName,
    profileType: ProfileType.IOS_APP_STORE,
  });
  console.log(`✓ Profil erstellt (id=${profile.id}, uuid=${profile.attributes.uuid})`);

  // 4) Profil schreiben + credentials.json aktualisieren (p12 + Passwort bleiben)
  const credsDir = path.join(projectDir, 'credentials');
  const profilePath = path.join(credsDir, 'ios_appstore.mobileprovision');
  fs.writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, 'base64'));

  let p12Path = 'credentials/ios_distribution.p12';
  let p12Password = '';
  const existingCredsPath = path.join(projectDir, 'credentials.json');
  if (fs.existsSync(existingCredsPath)) {
    const existing = JSON.parse(fs.readFileSync(existingCredsPath, 'utf8'));
    p12Path = existing.ios?.distributionCertificate?.path || p12Path;
    p12Password = existing.ios?.distributionCertificate?.password || '';
  }

  fs.writeFileSync(existingCredsPath, JSON.stringify({
    ios: {
      provisioningProfilePath: 'credentials/ios_appstore.mobileprovision',
      distributionCertificate: { path: p12Path, password: p12Password },
    },
  }, null, 2) + '\n');

  console.log('\n=== Fertig ===');
  console.log('Bundle-ID:', BUNDLE_ID);
  console.log('Profil:     credentials/ios_appstore.mobileprovision');
  console.log('p12 (wiederverwendet):', p12Path);
  console.log('credentials.json geschrieben');
  console.log('\nNächster Schritt: App-Record im Browser anlegen, dann ascAppId in eas.json eintragen.');
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
