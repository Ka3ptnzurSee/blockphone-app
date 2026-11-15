// Laedt die iOS-Builds der Blockphone-App aus App Store Connect (Release-Gate).
// Nutzung: node scripts/asc-builds.mjs [limit]
// Wichtig: app-scoped abfragen. Ein globales /v1/builds lieferte Builds fremder
// Apps und verschwieg, dass Builds mit abgelaufenem Zertifikat als "expired"
// markiert sind und dann in TestFlight nicht mehr auftauchen.
import { createContext } from './lib/apple.mjs';

const APP_ID = process.env.ASC_APP_ID ?? '6826450166';
const limit = Math.min(Math.max(Number(process.argv[2] ?? 5) || 5, 1), 50);
const { token } = createContext(process.cwd());
const jwt = await token.getToken();

const get = async (path) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://api.appstoreconnect.apple.com' + path, {
      headers: { Authorization: 'Bearer ' + jwt },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('ASC ' + res.status + ': ' + (await res.text()).slice(0, 300));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

try {
  const json = await get('/v1/apps/' + APP_ID + '/builds?limit=200&fields[builds]=version,processingState,expired,uploadedDate,expirationDate');
  const rows = (json.data ?? [])
    .map((b) => ({
      id: b.id,
      build: Number(b.attributes?.version ?? 0),
      state: b.attributes?.processingState ?? '?',
      expired: b.attributes?.expired ?? true,
      uploaded: b.attributes?.uploadedDate ?? '',
      expires: b.attributes?.expirationDate ?? '',
    }))
    .sort((a, b) => b.build - a.build)
    .slice(0, limit);

  if (rows.length === 0) {
    console.error('ASC: keine Builds fuer App ' + APP_ID);
    process.exit(1);
  }

  const detail = await get('/v1/builds/' + rows[0].id + '/buildBetaDetail');
  const beta = detail.data?.attributes?.internalBuildState ?? '?';
  console.log(JSON.stringify({ app: APP_ID, internalBuildState: beta, builds: rows }, null, 2));

  const top = rows[0];
  const bad = top.state !== 'VALID' || top.expired !== false || beta === 'EXPIRED' || beta === 'MISSING_EXPORT_COMPLIANCE';
  if (bad) {
    console.error('ASC: Release-Gate ROT - Build ' + top.build + ' state=' + top.state + ' expired=' + top.expired + ' beta=' + beta);
    process.exit(1);
  }
  console.log('ASC: Release-Gate GRUEN - Build ' + top.build + ' VALID, nicht abgelaufen, beta=' + beta);
} catch (err) {
  if (err && err.name === 'AbortError') console.error('ASC: Timeout nach 20s');
  else console.error('ASC Fehler: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
