// Tests für Browser-Helfer: Brücken-Nachrichten-Cap, Unsaved-Usage-Ledger und
// der Browser-Tab-Ausstieg (KLEIN/Verlassen darf nie im Browser-Tab enden).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BRIDGE_MESSAGE_BYTES,
  browserExitTab,
  ledgerAccrue,
  ledgerSettle,
  parseBridgeMessage,
  type UsageLedger,
} from "./browser.ts";

// ── Finding 1: KLEIN wechselt immer auf einen Nicht-Browser-Tab ──────────────
test("browserExitTab: verlässt den Browser-Tab (KLEIN/Verlassen ist kein No-op)", () => {
  assert.equal(browserExitTab("browser"), "sperren");
  assert.notEqual(browserExitTab("browser"), "browser");
  // Andere Tabs bleiben unangetastet.
  assert.equal(browserExitTab("devices"), "devices");
  assert.equal(browserExitTab("glyph"), "glyph");
  assert.equal(browserExitTab("sperren"), "sperren");
});

// ── Finding 9: fehlgeschlagenes addUsage verliert keine Sekunden ──────────────
test("ledger: fehlgeschlagener Flush puffert Sekunden und liefert sie nach", () => {
  const ledger: UsageLedger = { pending: 0 };

  const total1 = ledgerAccrue(ledger, 5);
  assert.equal(total1, 5);
  ledgerSettle(ledger, total1, false); // addUsage fehlgeschlagen
  assert.equal(ledger.pending, 5); // Sekunden NICHT verloren

  const total2 = ledgerAccrue(ledger, 3); // nächster Flush
  assert.equal(total2, 8); // 5 gepuffert + 3 neu
  ledgerSettle(ledger, total2, true); // Erfolg
  assert.equal(ledger.pending, 0);
});

test("ledger: Erfolg räumt das Ledger, negative Werte werden geklemmt", () => {
  const ledger: UsageLedger = { pending: 0 };
  const total = ledgerAccrue(ledger, 7);
  assert.equal(total, 7);
  ledgerSettle(ledger, total, true);
  assert.equal(ledger.pending, 0);

  // Negative Elapsed-Werte erzeugen keinen negativen Puffer.
  const ledger2: UsageLedger = { pending: 0 };
  assert.equal(ledgerAccrue(ledger2, -3), 0);
});

// ── Finding 11: onMessage-Payloads über 64 KB werden vor JSON.parse verworfen ─
test("parseBridgeMessage: verwirft überlange Payloads (DoS-Schutz)", () => {
  const small = JSON.stringify({ type: "pbVaultOffer", host: "example.com", username: "a", secret: "b" });
  assert.deepEqual(parseBridgeMessage(small), {
    type: "pbVaultOffer",
    host: "example.com",
    username: "a",
    secret: "b",
  });

  const tooBig = `{"type":"x","pad":"${"a".repeat(MAX_BRIDGE_MESSAGE_BYTES + 1)}"}`;
  assert.equal(tooBig.length > MAX_BRIDGE_MESSAGE_BYTES, true);
  assert.equal(parseBridgeMessage(tooBig), null);

  // Genau an der Grenze ist noch erlaubt.
  const atLimit = JSON.stringify({ ok: true, pad: "a".repeat(Math.max(0, MAX_BRIDGE_MESSAGE_BYTES - 20)) });
  assert.ok(parseBridgeMessage(atLimit) !== null);
});

test("parseBridgeMessage: feindliche Eingaben crashen nicht", () => {
  const bad: unknown[] = [
    "",
    "not json",
    "null",
    "[]",
    '"str"',
    "42",
    "{",
    " ".repeat(10),
  ];
  for (const value of bad) {
    assert.equal(parseBridgeMessage(value as string), null);
  }
});
