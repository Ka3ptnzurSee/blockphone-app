// Lädt die letzten iOS-Builds aus App Store Connect (Release-Gate).
// Nutzung: node scripts/asc-builds.mjs [limit]
// Hinweis: filter[app] liefert bei diesem Account leere Antworten — ohne Filter
// kommen die aktuellen Builds, frisch hochgeladene erscheinen nach ein paar Minuten.
import { createContext } from './lib/apple.mjs';

const projectDir = process.cwd();
const limit = Math.min(Math.max(Number(process.argv[2] ?? 5) || 5, 1), 50);

try {
  const { token } = createContext(projectDir);
  const jwt = await token.getToken();

  // fetch mit Timeout: ein hängender ASC-Endpunkt darf das Release-Gate nicht
  // endlos blockieren.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res;
  try {
    res = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?limit=${limit}&sort=-uploadedDate`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error(`ASC ${res.status}: ${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    console.error('ASC: Antwort war kein gültiges JSON.');
    process.exit(1);
  }

  const rows = (json.data ?? []).map((b) => ({
    build: b.attributes?.version ?? '?',
    state: b.attributes?.processingState ?? '?',
    expired: b.attributes?.expired ?? false,
    uploaded: b.attributes?.uploadedDate ?? '',
  }));
  console.log(JSON.stringify(rows, null, 2));
} catch (err) {
  if (err && err.name === 'AbortError') {
    console.error('ASC: Timeout nach 20s (fetch abgebrochen).');
  } else {
    console.error(`ASC Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}
