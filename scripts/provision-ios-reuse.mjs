// Provisionierung einer NEUEN App unter WIEDERVERWENDUNG eines bestehenden
// iOS-Distribution-Zertifikats (statt ein neues zu erzeugen → schont das
// Apple-Limit von 3 Distribution-Zertifikaten pro Team).
//
// Erzeugt: Bundle-ID (falls nötig) + App-Store-Provisioning-Profil.
// Übernimmt p12 + Passwort aus der vorhandenen credentials.json (merge).
//
// Nutzung:
//   REUSE_CERT_ID=SS85KG94PB BUNDLE_ID=com.meister.blockphone APP_NAME="Blockphone" \
//     node scripts/provision-ios-reuse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAppleUtils, createContext, writeSecretJson,
} from './lib/apple.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

const {
  BundleId, BundleIdPlatform, Certificate, CertificateType, Profile, ProfileType,
} = loadAppleUtils();

const BUNDLE_ID = process.env.BUNDLE_ID || 'com.meister.blockphone';
const APP_NAME = process.env.APP_NAME || 'Blockphone';
const REUSE_CERT_ID = process.env.REUSE_CERT_ID;
if (!REUSE_CERT_ID) {
  console.error('FEHLER: REUSE_CERT_ID muss gesetzt sein (ID des wiederzuverwendenden Distribution-Zertifikats).');
  process.exit(1);
}

async function main() {
  const { context } = createContext(projectDir);

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
  } catch (e) {
    const msg = e?.message ?? e;
    if (String(msg).includes('not found') || String(msg).includes('NOT_FOUND') || String(msg).includes('404')) {
      throw new Error(`Zertifikat ${REUSE_CERT_ID} nicht gefunden – REUSE_CERT_ID prüfen.`);
    }
    throw e;
  }
  console.log(`✓ Zertifikat wiederverwendet (id=${cert.id}, serial=${cert.attributes.serialNumber}, expires=${cert.attributes.expirationDate})`);
  if (![CertificateType.IOS_DISTRIBUTION].includes(cert.attributes.certificateType)) {
    throw new Error(`Zertifikat ${REUSE_CERT_ID} ist kein iOS-Distribution-Zertifikat (type=${cert.attributes.certificateType}).`);
  }

  // 3) App-Store-Provisioning-Profil (altes gleichnamiges zuerst löschen)
  const profileName = `${APP_NAME} ${BUNDLE_ID} AppStore`;
  const allProfiles = await Profile.getAsync(context);
  const duplicates = allProfiles.filter((p) => p.attributes.name === profileName);
  for (const p of duplicates) {
    console.log(`→ altes Profil "${profileName}" löschen (id=${p.id}) …`);
    await p.deleteAsync();
  }
  console.log(`→ Provisioning-Profil "${profileName}" erzeugen …`);
  const profile = await Profile.createAsync(context, {
    bundleId: bundleId.id,
    certificates: [cert.id],
    devices: [],
    name: profileName,
    profileType: ProfileType.IOS_APP_STORE,
  });
  console.log(`✓ Profil erstellt (id=${profile.id}, uuid=${profile.attributes.uuid})`);

  // 4) Profil schreiben + credentials.json MERGEN (p12 + Passwort bleiben erhalten)
  const credsDir = path.join(projectDir, 'credentials');
  fs.mkdirSync(credsDir, { recursive: true });
  const profilePath = path.join(credsDir, 'ios_appstore.mobileprovision');
  fs.writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, 'base64'), { mode: 0o600 });
  fs.chmodSync(profilePath, 0o600);

  const credsJsonPath = path.join(projectDir, 'credentials.json');
  let existing = {};
  if (fs.existsSync(credsJsonPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(credsJsonPath, 'utf8'));
    } catch (e) {
      console.error(`WARNUNG: ${credsJsonPath} ist unlesbar (${e?.message ?? e}) – Abbruch, keine Überschreibung.`);
      process.exit(1);
    }
  }
  const existingDist = existing.ios?.distributionCertificate || {};
  const p12Path = existingDist.path || 'credentials/ios_distribution.p12';
  const p12Password = existingDist.password || '';
  writeSecretJson(credsJsonPath, {
    ...existing,
    ios: {
      ...(existing.ios || {}),
      provisioningProfilePath: 'credentials/ios_appstore.mobileprovision',
      distributionCertificate: { ...existingDist, path: p12Path, password: p12Password },
    },
  });

  console.log('\n=== Fertig ===');
  console.log('Bundle-ID:', BUNDLE_ID);
  console.log('Profil:     credentials/ios_appstore.mobileprovision');
  console.log('p12 (wiederverwendet):', p12Path);
  console.log('credentials.json geschrieben');
  console.log('\nNächster Schritt: App-Record im Browser anlegen, dann ascAppId in eas.json eintragen.');
}

main().catch((e) => { console.error('FEHLER:', e?.message ?? e); process.exit(1); });
