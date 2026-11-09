import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyIntervention,
  withinReInterventionWindow,
  windowRemaining,
  recordIntervention,
  newMathChallenge,
  checkMathAnswer,
  normalizeIntervention,
  RE_INTERVENTION_WINDOW_MS,
} from "./intervention";

const T0 = 1_700_000_000_000;

test("ohne Intervention: nie im Fenster", () => {
  const s = emptyIntervention();
  assert.equal(withinReInterventionWindow(s, T0), false);
  assert.equal(windowRemaining(s, T0), 0);
});

test("Re-Intervention-Fenster: 10 min ohne erneute Intervention", () => {
  const s = recordIntervention(emptyIntervention(), "breathing", T0);
  assert.equal(withinReInterventionWindow(s, T0 + 1000), true);
  assert.equal(withinReInterventionWindow(s, T0 + RE_INTERVENTION_WINDOW_MS - 1), true);
  assert.equal(withinReInterventionWindow(s, T0 + RE_INTERVENTION_WINDOW_MS), false);
  assert.equal(windowRemaining(s, T0 + 60_000), RE_INTERVENTION_WINDOW_MS - 60_000);
});

test("recordIntervention merkt sich kind", () => {
  const s = recordIntervention(emptyIntervention(), "math", T0);
  assert.equal(s.kind, "math");
  assert.equal(s.lastCompletedAt, T0);
});

test("Mathe-Challenge: Antwort stimmt und ist deterministisch", () => {
  const c = newMathChallenge();
  assert.equal(checkMathAnswer(c, c.answer), true);
  assert.equal(checkMathAnswer(c, c.answer + 1), false);
  assert.equal(c.a + c.b, c.answer);
  // Grenzen einhalten
  for (let i = 0; i < 100; i++) {
    const x = newMathChallenge(20, 20);
    assert.ok(x.a >= 0 && x.a <= 20);
    assert.ok(x.b >= 0 && x.b <= 20);
  }
});

test("normalizeIntervention verwirft Type-Confusion", () => {
  assert.equal(normalizeIntervention(null), null);
  assert.equal(normalizeIntervention(42), null);
  const n = normalizeIntervention({ lastCompletedAt: "x", kind: "weird" });
  assert.ok(n);
  assert.equal(n.lastCompletedAt, 0);
  assert.equal(n.kind, "breathing");
  const m = normalizeIntervention({ lastCompletedAt: -1, kind: "journal" });
  assert.equal(m!.lastCompletedAt, 0);
  assert.equal(m!.kind, "journal");
});
