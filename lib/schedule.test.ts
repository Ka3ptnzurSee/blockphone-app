import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyQuietHours,
  minuteOfDay,
  withinQuietHours,
  formatMinutes,
  normalizeQuietHours,
  emptyPosting,
  normalizePosting,
  cooldownRemaining,
  withinCooldown,
  sessionRemaining,
  emptySessionSettings,
  normalizeSessionSettings,
  MINUTE_MS,
  HOUR_MS,
} from "./schedule";

function at(h: number, m: number): Date {
  return new Date(2026, 0, 15, h, m, 0); // 15. Jan 2026 (beliebig)
}

test("minuteOfDay", () => {
  assert.equal(minuteOfDay(at(0, 0)), 0);
  assert.equal(minuteOfDay(at(22, 0)), 1320);
  assert.equal(minuteOfDay(at(23, 59)), 1439);
});

test("Quiet Hours im Tagesfenster (22:00→06:00, über Mitternacht)", () => {
  const q = { enabled: true, startMin: 22 * 60, endMin: 6 * 60 };
  assert.equal(withinQuietHours(q, at(21, 59)), false);
  assert.equal(withinQuietHours(q, at(22, 0)), true);
  assert.equal(withinQuietHours(q, at(23, 30)), true);
  assert.equal(withinQuietHours(q, at(0, 0)), true);
  assert.equal(withinQuietHours(q, at(5, 59)), true);
  assert.equal(withinQuietHours(q, at(6, 0)), false);
  assert.equal(withinQuietHours(q, at(12, 0)), false);
});

test("Quiet Hours innerhalb eines Tages (09:00→17:00)", () => {
  const q = { enabled: true, startMin: 9 * 60, endMin: 17 * 60 };
  assert.equal(withinQuietHours(q, at(8, 59)), false);
  assert.equal(withinQuietHours(q, at(9, 0)), true);
  assert.equal(withinQuietHours(q, at(16, 59)), true);
  assert.equal(withinQuietHours(q, at(17, 0)), false);
});

test("Quiet Hours deaktiviert oder leeres Fenster = nie aktiv", () => {
  assert.equal(withinQuietHours(emptyQuietHours(), at(23, 0)), false);
  assert.equal(
    withinQuietHours({ enabled: true, startMin: 600, endMin: 600 }, at(12, 0)),
    false,
  );
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(0), "00:00");
  assert.equal(formatMinutes(6 * 60), "06:00");
  assert.equal(formatMinutes(22 * 60), "22:00");
  assert.equal(formatMinutes(1320), "22:00");
});

test("normalizeQuietHours validiert und normalisiert", () => {
  assert.equal(normalizeQuietHours(null), null);
  assert.equal(normalizeQuietHours({ enabled: true }), null); // startMin fehlt
  const q = normalizeQuietHours({ enabled: true, startMin: 1440 + 60, endMin: -5 })!;
  assert.equal(q.startMin, 60);
  assert.equal(q.endMin, 1435);
});

test("Posting-Quota: Defaults + Normalisierung", () => {
  const p = emptyPosting();
  assert.equal(p.timesPerDay, 3);
  assert.equal(p.durationMin, 10);
  const n = normalizePosting({ timesPerDay: 999, durationMin: 0 })!;
  assert.equal(n.timesPerDay, 50);
  assert.equal(n.durationMin, 1);
  assert.equal(normalizePosting(null), null);
  assert.equal(normalizePosting({ timesPerDay: "3" }), null);
});

test("Cooldown nach Entsperrung", () => {
  const T0 = 1_700_000_000_000;
  assert.equal(cooldownRemaining(0, HOUR_MS, T0), 0);
  assert.equal(cooldownRemaining(T0, HOUR_MS, T0), HOUR_MS);
  assert.equal(cooldownRemaining(T0, HOUR_MS, T0 + 30 * MINUTE_MS), 30 * MINUTE_MS);
  assert.equal(withinCooldown(T0, HOUR_MS, T0 + HOUR_MS), false);
  assert.equal(withinCooldown(T0, HOUR_MS, T0 + HOUR_MS - 1), true);
});

test("Session-Timer", () => {
  const T0 = 1_700_000_000_000;
  assert.equal(sessionRemaining(0, 600_000, T0), 0);
  assert.equal(sessionRemaining(T0, 600_000, T0), 600_000);
  assert.equal(sessionRemaining(T0, 600_000, T0 + 600_000), 0);
  assert.equal(sessionRemaining(T0, 600_000, T0 + 600_001), 0);
});


test("SessionSettings: Defaults + Normalisierung", () => {
  const s = emptySessionSettings();
  assert.equal(s.cooldownMin, 0);
  assert.equal(s.sessionLimitMin, 0);
  const n = normalizeSessionSettings({ cooldownMin: 999, sessionLimitMin: -3 })!;
  assert.equal(n.cooldownMin, 180);
  assert.equal(n.sessionLimitMin, 0);
  assert.equal(normalizeSessionSettings(null), null);
  assert.equal(normalizeSessionSettings({ cooldownMin: 5 }), null);
});
