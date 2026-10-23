// Unit-Tests für die puren Helper in lib/apple.mjs (resolveKeyPath, writeSecretJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveKeyPath, writeSecretJson } from './apple.mjs';

test('resolveKeyPath nutzt basename unter credentials/', () => {
  assert.equal(
    resolveKeyPath('/proj', 'credentials/AscApiKey_26AXZ5M8UR.p8'),
    path.join('/proj', 'credentials', 'AscApiKey_26AXZ5M8UR.p8')
  );
});

test('resolveKeyPath blockt Path-Traversal (../)', () => {
  const out = resolveKeyPath('/proj', '../../etc/passwd');
  assert.ok(out.startsWith(path.join('/proj', 'credentials') + path.sep));
  assert.equal(path.basename(out), 'passwd');
});

test('resolveKeyPath blockt absolute Pfade (nur basename)', () => {
  const out = resolveKeyPath('/proj', '/etc/passwd');
  assert.equal(out, path.join('/proj', 'credentials', 'passwd'));
});

test('resolveKeyPath wirft bei leerem/ungültigem keyPath', () => {
  for (const bad of ['', '.', '..', null, undefined]) {
    assert.throws(() => resolveKeyPath('/proj', bad));
  }
});

test('writeSecretJson schreibt mit Permissions 0600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-test-'));
  const file = path.join(dir, 'credentials.json');
  try {
    writeSecretJson(file, { ios: { password: 'geheim' } });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(parsed, { ios: { password: 'geheim' } });
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
