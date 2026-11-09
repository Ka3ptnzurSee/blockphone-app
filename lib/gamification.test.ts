import { test } from "node:test";
import assert from "node:assert/strict";
import {
  streakDaysWithGrace,
  shouldResetGrace,
  weekBounds,
  weeklyStats,
} from "./gamification";

// 2026-01-15 ist ein Donnerstag (Woche Mo 12.01 – So 18.01).
const TODAY = "2026-01-15";

test("streakDaysWithGrace: ohne Lücke = kein Kulanz-Tag nötig", () => {
  const active = ["2026-01-13", "2026-01-14", "2026-01-15"];
  const r = streakDaysWithGrace(active, true, TODAY);
  assert.equal(r.days, 3);
  assert.equal(r.graceConsumed, false);
  assert.equal(r.graceAvailable, true);
});

test("streakDaysWithGrace: eine Lücke wird überbrückt", () => {
  const active = ["2026-01-13", "2026-01-15"];
  const r = streakDaysWithGrace(active, true, TODAY);
  assert.equal(r.days, 3); // 15 + (14 gebrückt) + 13
  assert.equal(r.graceConsumed, true);
  assert.equal(r.graceAvailable, false);
});

test("streakDaysWithGrace: Lücke überbrückt, davor zählt weiter", () => {
  const active = ["2026-01-12", "2026-01-14", "2026-01-15"];
  const r = streakDaysWithGrace(active, true, TODAY);
  assert.equal(r.days, 4); // 15, 14, (13 gebrückt), 12
  assert.equal(r.graceConsumed, true);
});

test("streakDaysWithGrace: Kulanz-Tag verbraucht → Lücke bricht", () => {
  const active = ["2026-01-13", "2026-01-15"];
  const r = streakDaysWithGrace(active, false, TODAY);
  assert.equal(r.days, 1); // nur heute, 14 nicht überbrückbar
  assert.equal(r.graceConsumed, false);
});

test("shouldResetGrace: nur bei komplett gebrochenem Streak", () => {
  assert.equal(shouldResetGrace(["2026-01-15"], TODAY), false);
  assert.equal(shouldResetGrace(["2026-01-14"], TODAY), false);
  assert.equal(shouldResetGrace([], TODAY), true);
  assert.equal(shouldResetGrace(["2026-01-12"], TODAY), true); // 13+14 verpasst
});

test("weekBounds: Montag bis Sonntag", () => {
  const b = weekBounds(TODAY);
  assert.equal(b.start, "2026-01-12");
  assert.equal(b.end, "2026-01-18");
  assert.equal(weekBounds("2026-01-18").start, "2026-01-12");
  assert.equal(weekBounds("2026-01-12").start, "2026-01-12");
});

test("weeklyStats zählt aktive Tage der Woche", () => {
  const active = ["2026-01-12", "2026-01-14", "2026-01-15", "2026-01-19"];
  const s = weeklyStats(active, TODAY);
  assert.equal(s.activeDays, 3);
  assert.equal(s.totalDays, 7);
  assert.ok(Math.abs(s.ratio - 3 / 7) < 1e-9);
  assert.equal(s.start, "2026-01-12");
  assert.equal(s.end, "2026-01-18");
});

