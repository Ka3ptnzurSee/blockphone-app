// Tests für den PiP-Trigger: Nachrichten-Parsing (feindliche Eingaben) und die
// Syntax/Vollständigkeit des injizierten Scripts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIP_MESSAGE_TYPE,
  PIP_TRIGGER_SCRIPT,
  buildPipScript,
  parsePipMessage,
  pipStatusText,
} from "./pip.ts";

test("parsePipMessage: akzeptiert nur echte pbPip-Meldungen", () => {
  assert.deepEqual(parsePipMessage(JSON.stringify({ type: PIP_MESSAGE_TYPE, ok: true, reason: "ok", via: "webkit" })), {
    ok: true,
    reason: "ok",
    via: "webkit",
  });
  assert.deepEqual(parsePipMessage(JSON.stringify({ type: PIP_MESSAGE_TYPE, ok: false, reason: "kein-video" })), {
    ok: false,
    reason: "kein-video",
  });
  // Fremde Nachrichten (Block-Zähler, Vault-Angebot, Health) dürfen NICHT als PiP gelten.
  assert.equal(parsePipMessage(JSON.stringify({ platform: "youtube", count: 3 })), null);
  assert.equal(parsePipMessage(JSON.stringify({ type: "pbVaultOffer", host: "x.de" })), null);
  assert.equal(parsePipMessage(JSON.stringify({ reason: "reinject", platform: "youtube" })), null);
});

test("parsePipMessage: feindliche Eingaben crashen nicht", () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    true,
    "",
    "{",
    "[]",
    "null",
    '"ok"',
    "[1,2,3]",
    "{}",
    JSON.stringify({ type: PIP_MESSAGE_TYPE }),
    JSON.stringify({ type: PIP_MESSAGE_TYPE, ok: "true", reason: 5 }),
    JSON.stringify({ type: PIP_MESSAGE_TYPE, ok: false, reason: "x".repeat(5000) }),
    "y".repeat(9000),
    `{"type":"${PIP_MESSAGE_TYPE}","ok":true,"reason":"ok","via":${"9".repeat(60)}}`,
  ];
  for (const value of bad) {
    const r = parsePipMessage(value);
    if (r === null) continue;
    // Falls doch eine Meldung erkannt wird: Feldtypen und Längen sind sauber.
    assert.equal(typeof r.ok, "boolean");
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0 && r.reason.length <= 120);
    if (r.via !== undefined) assert.ok(r.via.length > 0 && r.via.length <= 24);
  }
});

test("parsePipMessage: ok nur bei echtem true", () => {
  for (const truthy of ["1", 1, "yes", {}]) {
    const r = parsePipMessage(JSON.stringify({ type: PIP_MESSAGE_TYPE, ok: truthy, reason: "" }));
    assert.equal(r?.ok, false);
    assert.equal(r?.reason, "unbekannt");
  }
});

test("pipStatusText: klare, kurze Texte", () => {
  assert.equal(pipStatusText(null), "KLEINBILD: KEINE ANTWORT");
  assert.equal(pipStatusText({ ok: true, reason: "ok" }), "KLEINBILD AN");
  assert.equal(pipStatusText({ ok: false, reason: "kein-video" }), "KLEINBILD: KEIN VIDEO");
  assert.equal(pipStatusText({ ok: false, reason: "api-blockiert" }), "KLEINBILD BLOCKIERT");
  assert.equal(pipStatusText({ ok: false, reason: "kein-pip" }), "KLEINBILD NICHT VERFÜGBAR");
  assert.equal(pipStatusText({ ok: false, reason: "kaputt" }), "KLEINBILD: KAPUTT");
});

test("buildPipScript: valides JS mit beiden PiP-Wegen", () => {
  const js = buildPipScript();
  // Muss syntaktisch gültig sein (kein SyntaxError beim Injizieren).
  assert.doesNotThrow(() => new Function(js));
  assert.ok(js.includes("webkitSetPresentationMode"));
  assert.ok(js.includes("requestPictureInPicture"));
  assert.ok(js.includes("pictureInPictureEnabled"));
  assert.ok(js.includes("ReactNativeWebView"));
  assert.ok(js.includes(PIP_MESSAGE_TYPE));
  // Idempotenz + Background-Trigger
  assert.ok(js.includes("window.__pbPip"));
  assert.ok(js.includes("__pbPipAuto"));
  assert.ok(js.includes("visibilitychange"));
  assert.ok(js.includes("disablePictureInPicture"));
  // Zweitton-Schutz für den YouTube-Audio-Hack
  assert.ok(js.includes("muted"));
  // Keine Template-Literal-Reste (würde beim Injizieren als String enden)
  assert.ok(!js.includes("${"));
});

test("buildPipScript: läuft in einer Sandbox ohne DOM nicht in eine Exception", () => {
  // Minimal-Attrappe: kein Video im DOM → 'kein-video', keine Endlosschleife.
  const posted: string[] = [];
  const sandbox: Record<string, unknown> = {
    window: {
      ReactNativeWebView: { postMessage: (s: string) => posted.push(s) },
      addEventListener: () => {},
    },
    document: {
      hidden: false,
      querySelectorAll: () => [],
      addEventListener: () => {},
      pictureInPictureEnabled: false,
    },
    Object,
    Array,
    String,
    JSON,
  };
  const fn = new Function(
    "window",
    "document",
    "Object",
    "Array",
    "String",
    "JSON",
    buildPipScript(),
  );
  assert.doesNotThrow(() =>
    fn(sandbox.window, sandbox.document, Object, Array, String, JSON),
  );
  assert.equal(posted.length, 1);
  const msg = JSON.parse(posted[0]) as { type: string; ok: boolean; reason: string };
  assert.equal(msg.type, PIP_MESSAGE_TYPE);
  assert.equal(msg.ok, false);
  assert.equal(msg.reason, "kein-video");
});

test("PIP_TRIGGER_SCRIPT: ruft nur den bereits installierten Trigger", () => {
  assert.ok(PIP_TRIGGER_SCRIPT.includes("window.__pbPip"));
  assert.doesNotThrow(() => new Function(PIP_TRIGGER_SCRIPT));
});

// Sandbox-Helfer: Video-Objekt mit getBoundingClientRect (area() braucht es).
function sandboxVideo(overrides: Record<string, unknown> = {}) {
  return {
    videoWidth: 640,
    paused: false,
    ended: false,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    ...overrides,
  };
}

function runPipScript(video: unknown, withBridge = true): string[] {
  const posted: string[] = [];
  const windowObj: Record<string, unknown> = { addEventListener: () => {} };
  if (withBridge) {
    windowObj.ReactNativeWebView = { postMessage: (s: string) => posted.push(s) };
  }
  const sandbox: Record<string, unknown> = {
    window: windowObj,
    document: {
      hidden: false,
      querySelectorAll: () => [video],
      addEventListener: () => {},
      pictureInPictureEnabled: false,
    },
    Object,
    Array,
    String,
    JSON,
  };
  const fn = new Function(
    "window",
    "document",
    "Object",
    "Array",
    "String",
    "JSON",
    buildPipScript(),
  );
  fn(sandbox.window, sandbox.document, Object, Array, String, JSON);
  return posted;
}

test("buildPipScript: webkitSetPresentationMode ohne Exception = Erfolg (kein falsches kein-pip)", () => {
  const video = sandboxVideo({ webkitSetPresentationMode: () => {} });
  const msgs = runPipScript(video).map((s) => JSON.parse(s) as { ok: boolean; reason: string; via?: string });
  assert.ok(msgs.some((m) => m.ok === true && m.via === "webkit"));
  assert.ok(!msgs.some((m) => m.reason === "kein-pip"));
});

test("buildPipScript: Autoplay-Rejection wird gemeldet, PiP-Versuch läuft trotzdem weiter", async () => {
  const video = sandboxVideo({
    paused: true,
    play: () => Promise.reject(new Error("NotAllowedError")),
    webkitSetPresentationMode: () => {},
  });
  const posted = runPipScript(video);
  await new Promise((r) => setImmediate(r)); // Rejection-Callback ist ein Microtask
  const msgs = posted.map((s) => JSON.parse(s) as { ok: boolean; reason: string; via?: string });
  assert.ok(msgs.some((m) => m.ok === false && m.reason === "autoplay-blockiert"));
  assert.ok(msgs.some((m) => m.ok === true && m.via === "webkit"));
});

test("buildPipScript: fehlende Bridge degradiert ohne Exception (kein Throw nach außen)", () => {
  const video = sandboxVideo();
  assert.deepEqual(runPipScript(video, false), []); // Bridge fehlt → nichts verloren, kein Crash
});

test("buildPipScript: async Status über presentationmodechanged + Autoplay-Grund vorhanden", () => {
  const js = buildPipScript();
  assert.ok(js.includes("presentationmodechanged"));
  assert.ok(js.includes("removeEventListener"));
  assert.ok(js.includes("autoplay-blockiert"));
});
