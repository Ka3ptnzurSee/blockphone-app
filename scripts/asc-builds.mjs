// Lädt die letzten iOS-Builds aus App Store Connect (Release-Gate).
// Nutzung: node scripts/asc-builds.mjs [limit]
// Hinweis: filter[app] liefert bei diesem Account leere Antworten — ohne Filter
// kommen die aktuellen Builds, frisch hochgeladene erscheinen nach ein paar Minuten.
import { createContext } from './lib/apple.mjs';

const projectDir = process.cwd();
const limit = Math.min(Math.max(Number(process.argv[2] ?? 5) || 5, 1), 50);

const { token } = createContext(projectDir);
const jwt = await token.getToken();

const res = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?limit=${limit}&sort=-uploadedDate`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
if (!res.ok) {
  console.error(`ASC ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
const json = await res.json();
const rows = (json.data ?? []).map((b) => ({
  build: b.attributes?.version ?? '?',
  state: b.attributes?.processingState ?? '?',
  expired: b.attributes?.expired ?? false,
  uploaded: b.attributes?.uploadedDate ?? '',
}));
console.log(JSON.stringify(rows, null, 2));
