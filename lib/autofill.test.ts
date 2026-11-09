// Tests für die injizierten Autofill-Skripte: Syntax, Domain-Parität und der
// Anti-Leak-Guard des Fill-Skripts (Secret darf NUR in die eigene Domain).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_DOMAIN, buildCaptureScript, buildFillScript } from "./autofill.ts";
import { baseDomain } from "./vault.ts";

// __pbBase direkt aus dem exportierten Skript-Baustein holen (kein Slicing am
// generierten String — eine Umformatierung darf den Test nicht still entwerten).
function extractBaseFn(): (host: string) => string {
  const factory = new Function(`${BASE_DOMAIN}; return __pbBase;`);
  return factory() as (host: string) => string;
}

test("injizierte Skripte sind syntaktisch gültig", () => {
  assert.doesNotThrow(() => new Function(buildCaptureScript()));
  assert.doesNotThrow(() => new Function(buildFillScript("youtube.com", "user", "secret")));
});

test("__pbBase rechnet identisch zu baseDomain (kein Domain-Leak/Blocking)", () => {
  const pb = extractBaseFn();
  const hosts = [
    "m.youtube.com",
    "youtube.com",
    "m.youtube.co.uk",
    "www.instagram.com",
    "foo.github.io",
    "a.b.github.io",
    "mybucket.s3.amazonaws.com",
    "evil.s3.amazonaws.com",
    "evil.co.il",
    "victim.co.il",
    "shop.com.ph",
    "10.0.0.1",
    "192.168.0.10",
    "localhost",
    "",
    // Ungültige Hostnamen: beide Seiten fail-closed (leerer String).
    "a@b.com",
    "_x.com",
    "instagram.com@evil.com",
  ];
  for (const h of hosts) {
    assert.equal(pb(h), baseDomain(h), h);
  }
  // Kernaussage: verschiedene Mandanten/Hosts bleiben getrennt.
  assert.notEqual(pb("mybucket.s3.amazonaws.com"), pb("evil.s3.amazonaws.com"));
  assert.notEqual(pb("10.0.0.1"), pb("10.0.0.2"));
});

// ── Fill-Guard real ausführen ────────────────────────────────────────────────
// Minimal-DOM: genau ein sichtbares Passwortfeld. Das Skript bricht vor jedem
// Zugriff ab, wenn der Domain-Guard nicht passt — dann bleibt value leer.
type FakeInput = {
  tagName: string;
  value: string;
  disabled: boolean;
  readOnly: boolean;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number; left: number; bottom: number };
  checkVisibility(): boolean;
  dispatchEvent(): boolean;
};

function makeInput(): FakeInput {
  const el: FakeInput = {
    tagName: "INPUT",
    value: "",
    disabled: false,
    readOnly: false,
    getAttribute: (name) => (name === "type" ? "password" : null),
    getBoundingClientRect: () => ({ width: 200, height: 30, left: 10, bottom: 30 }),
    checkVisibility: () => true,
    dispatchEvent: () => true,
  };
  return el;
}

// Liefert Feld-Wert UND den Rückgabewert des injizierten Skripts. Der Wert allein
// reicht nicht: "" ist auch der Ausgangszustand, ein kaputtes Skript grünte sonst.
function runFill(savedHost: string, locationHost: string): { pw: FakeInput; ok: boolean } {
  const pw = makeInput();
  const win = {
    location: { hostname: locationHost },
    innerWidth: 1000,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  };
  const doc = { querySelectorAll: (sel: string) => (sel.includes('type="password"') ? [pw] : []) };
  const fakeInputCtor = function () {} as unknown as new () => object;
  const factory = new Function(
    "window",
    "document",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    // `return` davor: sonst ist der IIFE-Rückgabewert (Guard true/false) weg.
    `return ${buildFillScript(savedHost, "user@example.com", "s3cret")}`,
  );
  const ok = factory(win, doc, fakeInputCtor, fakeInputCtor, function () {}) as boolean;
  return { pw, ok };
}

test("Fill-Guard: Secret landet NICHT auf fremder Domain", () => {
  for (const [saved, location] of [
    ["youtube.com", "evil.com"],
    ["youtube.com", "youtube.com.evil.com"],
    ["youtube.com", "notyoutube.com"],
    ["instagram.com", "instagram.de"],
  ]) {
    const r = runFill(saved, location);
    assert.equal(r.ok, false, `${saved} vs ${location}: Guard muss abbrechen`);
    assert.equal(r.pw.value, "", `${saved} vs ${location}: kein Secret ins Feld`);
  }
  // Host mit ungültigen Zeichen (kein echter Hostname) → fail-closed.
  const bad = runFill("instagram.com", "instagram.com@evil.com");
  assert.equal(bad.ok, false);
  assert.equal(bad.pw.value, "");
});

test("Fill-Guard: eigene Domain (auch Subdomain/Großschreibung) wird gefüllt", () => {
  for (const [saved, location] of [
    ["youtube.com", "m.youtube.com"],
    ["youtube.com", "YOUTUBE.com"],
    // Unnormalisierter Aufrufer-Host darf den Guard nicht aushebeln.
    ["M.YouTube.com:443", "m.youtube.com"],
  ]) {
    const r = runFill(saved, location);
    assert.equal(r.ok, true, `${saved} vs ${location}: Fill muss laufen`);
    assert.equal(r.pw.value, "s3cret");
  }
  // Normalisierung darf den Guard nicht WEITEN: Subdomain-Host ≠ Basis-Domain.
  const wide = runFill("m.youtube.com", "evil.com");
  assert.equal(wide.ok, false);
  assert.equal(wide.pw.value, "");
});
