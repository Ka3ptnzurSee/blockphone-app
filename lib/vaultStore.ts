// SecureStore-Persistenz für den Passwort-Tresor.
// Secrets liegen damit in der iOS-Keychain (kSecClassGenericPassword), nicht in
// AsyncStorage und nicht im Klartext im JS-Bundle.
import * as SecureStore from "expo-secure-store";
import {
  MAX_CREDENTIALS,
  normalizeCredential,
  removeCredential,
  upsertCredential,
  type Credential,
} from "./vault";

const KEY = "pb-vault-v1";

function parse(raw: string | null): Credential[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: Credential[] = [];
    for (const e of v) {
      const c = normalizeCredential(e);
      if (c) out.push(c);
      if (out.length >= MAX_CREDENTIALS) break;
    }
    return out;
  } catch {
    return [];
  }
}

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function loadVault(): Promise<Credential[]> {
  try {
    return parse(await SecureStore.getItemAsync(KEY));
  } catch {
    return [];
  }
}

async function write(list: Credential[]): Promise<Credential[]> {
  const capped = list.slice(0, MAX_CREDENTIALS);
  // Fehler NICHT schlucken: sonst zeigen onSaveOffer/onDeleteCred „Erfolg" an,
  // obwohl nichts persistiert wurde. Fail-visible statt stiller Datenverlust
  // (konsistent zu limitStore — der Aufrufer behandelt den Fehler).
  await SecureStore.setItemAsync(KEY, JSON.stringify(capped));
  return capped;
}

export function saveCredential(c: Credential): Promise<Credential[]> {
  return withLock(async () => write(upsertCredential(await loadVault(), c)));
}

export function deleteCredential(host: string, username: string): Promise<Credential[]> {
  return withLock(async () => write(removeCredential(await loadVault(), host, username)));
}
