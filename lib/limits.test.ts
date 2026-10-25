import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  dailyRemaining,
  unlockRemaining,
  isLocked,
  formatCountdown,
  formatRation,
  freshEntry,
  rolloverEntry,
  type LimitEntry,
} from "./limits";

const T = "2026-10-25";

function entry(over: Partial<LimitEntry> = {}): LimitEntry {
  return {
    limitSeconds: 1800,
    usedSeconds: 0,
    day: T,
    unlockedUntilMs: 0,
    ...over,
  };
}

test("DEFAULT_LIMITS: alle 5 Plattformen, sinnvolle Werte", () => {
  for (const p of ["youtube", "instagram", "facebook", "x", "reddit"] as const) {
    assert.equal(typeof DEFAULT_LIMITS[p], "number");
    assert.ok(DEFAULT_LIMITS[p] > 0);
  }
});

test("dailyRemaining: Differenz, nie negativ", () => {
  assert.equal(dailyRemaining(entry({ usedSeconds: 0 })), 1800);
  assert.equal(dailyRemaining(entry({ usedSeconds: 600 })), 1200);
  assert.equal(dailyRemaining(entry({ usedSeconds: 2000 })), 0);
});

test("unlockRemaining: Restzeit der Freischaltung, nie negativ", () => {
  const now = 1_000_000;
  assert.equal(unlockRemaining(entry({ unlockedUntilMs: now + 90_000 }), now), 90);
  assert.equal(unlockRemaining(entry({ unlockedUntilMs: now - 1000 }), now), 0);
});

test("isLocked: nur wenn Ration leer UND keine Freischaltung", () => {
  const now = 1_000_000;
  assert.equal(isLocked(entry({ usedSeconds: 500 }), now), false);
  assert.equal(isLocked(entry({ usedSeconds: 1800 }), now), true);
  // Ration leer, aber Freischaltung aktiv → nicht gesperrt
  assert.equal(isLocked(entry({ usedSeconds: 1800, unlockedUntilMs: now + 60_000 }), now), false);
  // Freischaltung abgelaufen → wieder gesperrt
  assert.equal(isLocked(entry({ usedSeconds: 1800, unlockedUntilMs: now - 1 }), now), true);
});

test("formatCountdown: MM:SS unter 1h, Xh Ym darüber", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(59), "0:59");
  assert.equal(formatCountdown(60), "1:00");
  assert.equal(formatCountdown(599), "9:59");
  assert.equal(formatCountdown(1800), "30:00");
  assert.equal(formatCountdown(3600), "1h");
  assert.equal(formatCountdown(5400), "1h 30m");
});

test("formatRation: lesbare Ration", () => {
  assert.equal(formatRation(600), "10m");
  assert.equal(formatRation(1800), "30m");
  assert.equal(formatRation(3600), "1h");
  assert.equal(formatRation(5400), "1h 30m");
});

test("freshEntry: heute, 0 verbraucht, keine Freischaltung", () => {
  const e = freshEntry("instagram", T);
  assert.deepEqual(e, { limitSeconds: 1800, usedSeconds: 0, day: T, unlockedUntilMs: 0 });
});

test("rolloverEntry: Tageswechsel setzt Verbrauch + Freischaltung zurück", () => {
  const e = entry({ usedSeconds: 900, unlockedUntilMs: 999 });
  const rolled = rolloverEntry(e, "2026-10-26");
  assert.equal(rolled.usedSeconds, 0);
  assert.equal(rolled.unlockedUntilMs, 0);
  assert.equal(rolled.day, "2026-10-26");
  // gleicher Tag → unverändert
  assert.equal(rolloverEntry(e, T), e);
});
