// lib/limitMonitor.test.ts — Vertrag mit der Monitor-Extension.
import test from "node:test";
import assert from "node:assert/strict";

import { EMPTY_VALUES, type AppRule } from "./appLimits";
import {
  MIN_THRESHOLD_S,
  buildMonitorPayload,
  buildMonitorRules,
  hasMonitorRules,
} from "./limitMonitor";

function rule(index: number, patch: Partial<AppRule> = {}): AppRule {
  return {
    index,
    label: `APP ${index + 1}`,
    ...EMPTY_VALUES,
    pending: null,
    ...patch,
  };
}

test("Regeln ohne Limit erzeugen kein Event", () => {
  assert.deepEqual(buildMonitorRules([rule(0), rule(1)]), []);
  assert.equal(hasMonitorRules([rule(0)]), false);
});

test("Tages- und Wochenlimit landen im Payload", () => {
  const rules = buildMonitorRules([rule(2, { dailySeconds: 1800, weeklySeconds: 7200 })]);
  assert.deepEqual(rules, [{ index: 2, dailySeconds: 1800, weeklySeconds: 7200 }]);
});

test("Schwellen unter einer Minute werden verworfen (kein Sekunden-Feuer)", () => {
  const rules = buildMonitorRules([rule(0, { dailySeconds: MIN_THRESHOLD_S - 1 })]);
  assert.deepEqual(rules, []);
  assert.deepEqual(buildMonitorRules([rule(0, { dailySeconds: MIN_THRESHOLD_S })]), [
    { index: 0, dailySeconds: MIN_THRESHOLD_S, weeklySeconds: 0 },
  ]);
});

test("ausstehende Änderungen zählen nicht (erst nach Wartezeit)", () => {
  const r = rule(1, { pending: { at: Date.now() + 3600_000, changes: { dailySeconds: 600 } } });
  assert.deepEqual(buildMonitorRules([r]), []);
});

test("Dauer-Sperre braucht kein Limit-Event", () => {
  assert.deepEqual(buildMonitorRules([rule(3, { blocked: true, dailySeconds: 600 })]), []);
});

test("kaputte Zahlen kippen die Extension nicht", () => {
  const rules = buildMonitorRules([
    rule(0, { dailySeconds: Number.NaN }),
    rule(1, { dailySeconds: -500 }),
    rule(2, { dailySeconds: Infinity }),
  ]);
  assert.deepEqual(rules, []);
});

test("Payload ist sortiertes JSON für Swift", () => {
  const payload = buildMonitorPayload([
    rule(1, { dailySeconds: 3600 }),
    rule(0, { weeklySeconds: 600 }),
  ]);
  assert.equal(payload, '[{"index":0,"dailySeconds":0,"weeklySeconds":600},{"index":1,"dailySeconds":3600,"weeklySeconds":0}]');
  assert.deepEqual(JSON.parse(payload), buildMonitorRules([
    rule(1, { dailySeconds: 3600 }),
    rule(0, { weeklySeconds: 600 }),
  ]));
});
