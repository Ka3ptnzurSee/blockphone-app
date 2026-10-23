// Gemeinsame Apple-App-Store-Connect-Helfer für die Provisionierungs-Skripte.
// Exportiert: loadAppleUtils, loadKeys, createContext (mit keyPath-Absicherung).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadAppleUtils() {
  const candidates = [
    '/usr/lib/node_modules/eas-cli/node_modules/@expo/apple-utils',
    'C:/Users/Meister/AppData/Roaming/npm/node_modules/eas-cli/node_modules/@expo/apple-utils',
  ];
  const errors = [];
  for (const c of candidates) {
    try { return require(c); } catch (e) { errors.push(`${c}: ${e?.message ?? e}`); }
  }
  // Fallback: lokal im Projekt
  const local = path.join(process.cwd(), 'node_modules/@expo/apple-utils');
  try { return require(local); } catch (e) { errors.push(`${local}: ${e?.message ?? e}`); }
  throw new Error(
    '@expo/apple-utils nicht gefunden. eas-cli global installieren: npm i -g eas-cli\n' + errors.join('\n')
  );
}

export function loadKeys(projectDir) {
  const keysPath = path.join(projectDir, 'credentials', 'keys.json');
  try {
    return JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  } catch (e) {
    throw new Error(`credentials/keys.json fehlt oder ist unlesbar (${keysPath}): ${e?.message ?? e}`);
  }
}

// Erzwingt, dass der .p8-Schlüssel immer im credentials/-Verzeichnis liegt
// (verhindert Path-Traversal über einen manipulierten keyPath in keys.json).
export function resolveKeyPath(projectDir, keyPath) {
  const file = path.basename(keyPath ?? '');
  if (!file || file === '.' || file === '..') {
    throw new Error(`Ungültiger ascApiKey.keyPath: "${keyPath}"`);
  }
  return path.join(projectDir, 'credentials', file);
}

// Baut den ASC-Token + Kontext. Validiert, dass die .p8 ein Private Key ist.
export function createContext(projectDir) {
  const keys = loadKeys(projectDir);
  const { keyId, issuerId } = keys.ascApiKey || {};
  if (!keyId || !issuerId) {
    throw new Error('keys.json: ascApiKey.keyId und ascApiKey.issuerId müssen gesetzt sein.');
  }
  const keyPath = resolveKeyPath(projectDir, keys.ascApiKey?.keyPath);
  let keyP8;
  try {
    keyP8 = fs.readFileSync(keyPath, 'utf8');
  } catch (e) {
    throw new Error(`.p8-Schlüssel fehlt oder ist unlesbar (${keyPath}): ${e?.message ?? e}`);
  }
  if (!keyP8.includes('PRIVATE KEY')) {
    throw new Error(`${keyPath} sieht nicht nach einer .p8-Datei aus`);
  }
  const { Token } = loadAppleUtils();
  const token = new Token({
    key: keyP8,
    issuerId,
    keyId,
    duration: 1200,
  });
  return { keys, token, context: { token } };
}

// Schreibt JSON mit restriktiven Permissions (Private-Keys/Passwörter).
export function writeSecretJson(filePath, data) {
  if (fs.constants.O_NOFOLLOW === undefined) {
    throw new Error('writeSecretJson erfordert O_NOFOLLOW (nur Linux/macOS unterstützt).');
  }
  const content = JSON.stringify(data, null, 2) + '\n';
  // Atomar + symlink-sicher schreiben: O_NOFOLLOW verweigert Symlink-Ziele,
  // mode 0600 beim Anlegen, fchmod sichert Permissions über den offenen fd.
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(filePath, flags, 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fchmodSync(fd, 0o600);
  } finally {
    fs.closeSync(fd);
  }
}
