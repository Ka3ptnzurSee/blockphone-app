// Tests für den Passwort-Tresor (Domain-Zuordnung, Validierung, Upsert).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_CREDENTIALS,
  baseDomain,
  canFillOn,
  credentialsForHost,
  hostOf,
  maskSecret,
  normalizeCredential,
  removeCredential,
  upsertCredential,
  type Credential,
} from "./vault.ts";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function cred(over: Partial<Credential> = {}): Credential {
  return { host: "youtube.com", username: "per", secret: "geheim123", updatedAt: NOW, ...over };
}

test("baseDomain normalisiert Hosts auf die registrierbare Domain", () => {
  assert.equal(baseDomain("m.youtube.com"), "youtube.com");
  assert.equal(baseDomain("WWW.Instagram.COM"), "instagram.com");
  assert.equal(baseDomain("instagram.com:443"), "instagram.com");
  assert.equal(baseDomain("localhost"), "localhost");
  assert.equal(baseDomain(""), "");
  assert.equal(baseDomain("java script"), "");
});

test("baseDomain respektiert Multi-Label-Suffixe (kein Credential-Leak)", () => {
  assert.equal(baseDomain("m.youtube.co.uk"), "youtube.co.uk");
  assert.equal(baseDomain("login.mybank.co.uk"), "mybank.co.uk");
  assert.equal(baseDomain("evil.github.io"), "evil.github.io");
  assert.equal(baseDomain("attacker.github.io"), "attacker.github.io");
  assert.equal(baseDomain("co.uk"), "co.uk");
  assert.equal(baseDomain("a.b.c.co.uk"), "c.co.uk"); // registrierbare Domain: c + co.uk
  // Zwei verschiedene Pächter auf github.io dürfen sich nicht sehen.
  assert.equal(credentialsForHost([cred({ host: "evil.github.io" })], "attacker.github.io").length, 0);
});

test("hostOf lehnt fremde Schemata und Müll ab", () => {
  assert.equal(hostOf("https://m.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(hostOf("instagram://app"), "");
  assert.equal(hostOf("nicht eine url"), "");
  assert.equal(hostOf("about:blank"), "");
});

test("normalizeCredential validiert Pflichtfelder und Längen", () => {
  assert.equal(normalizeCredential(null), null);
  assert.equal(normalizeCredential([]), null);
  assert.equal(normalizeCredential({ username: "a", secret: "b" }), null);
  assert.equal(normalizeCredential({ host: "x.com", username: "", secret: "b" }), null);
  assert.equal(normalizeCredential({ host: "x.com", username: "a", secret: "" }), null);
  const ok = normalizeCredential(
    { host: "m.x.com", username: " per ", secret: " pa ss ", updatedAt: 5 },
    NOW,
  );
  assert.deepEqual(ok, { host: "x.com", username: "per", secret: " pa ss ", updatedAt: 5 });
});

test("normalizeCredential deckelt überlange Werte", () => {
  const long = "x".repeat(300);
  assert.equal(normalizeCredential({ host: "x.com", username: long, secret: "s" }), null);
  assert.equal(normalizeCredential({ host: "x.com", username: "u", secret: long }), null);
});

test("upsertCredential ersetzt gleichen Host+User und sortiert neueste zuerst", () => {
  let list: Credential[] = [];
  list = upsertCredential(list, cred({ host: "youtube.com", username: "a", secret: "alt" }));
  list = upsertCredential(list, cred({ host: "instagram.com", username: "b" }));
  assert.equal(list.length, 2);
  list = upsertCredential(list, cred({ host: "www.youtube.com", username: "a", secret: "neu" }));
  assert.equal(list.length, 2);
  assert.equal(list[0].secret, "neu");
  assert.equal(list[0].host, "youtube.com");
});

test("upsertCredential respektiert den Deckel", () => {
  let list: Credential[] = [];
  for (let i = 0; i < MAX_CREDENTIALS + 5; i++) {
    list = upsertCredential(list, cred({ host: "x.com", username: `u${i}` }));
  }
  assert.equal(list.length, MAX_CREDENTIALS);
  assert.equal(list[0].username, `u${MAX_CREDENTIALS + 4}`);
});

test("upsertCredential ignoriert unbrauchbare Einträge", () => {
  const list = [cred()];
  assert.equal(upsertCredential(list, cred({ host: "", })).length, 1);
  assert.equal(upsertCredential(list, cred({ username: "  " })).length, 1);
  assert.equal(upsertCredential(list, cred({ secret: "" })).length, 1);
});

test("credentialsForHost matcht Subdomains, aber keine fremden Domains", () => {
  const list = [cred({ host: "youtube.com" }), cred({ host: "instagram.com", username: "ig" })];
  assert.equal(credentialsForHost(list, "m.youtube.com").length, 1);
  assert.equal(credentialsForHost(list, "youtube.com.evil.tld").length, 0);
  assert.equal(credentialsForHost(list, "").length, 0);
});

test("canFillOn verhindert Fills auf fremden Seiten", () => {
  const list = [cred({ host: "youtube.com", username: "per" })];
  assert.equal(canFillOn(list, "m.youtube.com", "per"), true);
  assert.equal(canFillOn(list, "evil.tld", "per"), false);
  assert.equal(canFillOn(list, "youtube.com", "fremd"), false);
});

test("removeCredential löscht nur den exakten Eintrag", () => {
  const list = [cred({ username: "a" }), cred({ username: "b" })];
  const next = removeCredential(list, "www.youtube.com", "a");
  assert.equal(next.length, 1);
  assert.equal(next[0].username, "b");
});

test("maskSecret zeigt höchstens die letzten zwei Zeichen", () => {
  assert.equal(maskSecret("abcdef"), "••••••ef");
  assert.equal(maskSecret("a"), "••");
  assert.equal(maskSecret(""), "••");
});

test("baseDomain isoliert Shared-Hosting-Mandanten (längstes Suffix gewinnt)", () => {
  // Vorher kollabierten alle Buckets auf "amazonaws.com" → Fill-Leak.
  assert.equal(baseDomain("mybucket.s3.amazonaws.com"), "mybucket.s3.amazonaws.com");
  assert.equal(baseDomain("evil.s3.amazonaws.com"), "evil.s3.amazonaws.com");
  assert.notEqual(
    baseDomain("mybucket.s3.amazonaws.com"),
    baseDomain("evil.s3.amazonaws.com"),
  );
  // Mehrlabelige Länder-Suffixe weiterhin korrekt.
  assert.equal(baseDomain("m.youtube.co.uk"), "youtube.co.uk");
  assert.equal(baseDomain("www.instagram.com"), "instagram.com");
  assert.equal(baseDomain("a.b.github.io"), "b.github.io");
});
