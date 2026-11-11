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
  normalizeEntry,
  MAX_UNLOCK_MS,
  MAX_LIMIT_S,
  MAX_WEEK_LIMIT_S,
  LIMIT_CHANGE_DELAY_MS,
  weekKeyForDay,
  weeklyRemaining,
  requestLimitChange,
  cancelPendingLimit,
  applyPendingLimit,
  pendingRemainingMs,
  type LimitEntry,
} from "./limits";

const T = "2026-10-25";

function entry(over: Partial<LimitEntry> = {}): LimitEntry {
  return {
    limitSeconds: 1800,
    usedSeconds: 0,
    day: T,
    unlockedUntilMs: 0,
    weekLimitSeconds: 0,
    weekUsedSeconds: 0,
    weekStart: "2026-10-19", // Montag der Woche von T
    pending: null,
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
  assert.deepEqual(e, {
    limitSeconds: 1800,
    usedSeconds: 0,
    day: T,
    unlockedUntilMs: 0,
    weekLimitSeconds: 0,
    weekUsedSeconds: 0,
    weekStart: "2026-10-19",
    pending: null,
  });
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

test("normalizeEntry: verwirft ungültige/typfremde Werte", () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry("x"), null);
  assert.equal(normalizeEntry([1, 2]), null);
  assert.equal(normalizeEntry({ limitSeconds: "1800", usedSeconds: 0 }), null);
  assert.equal(normalizeEntry({ limitSeconds: 1800, usedSeconds: "abc" }), null);
  assert.equal(normalizeEntry({ limitSeconds: 1800 }), null); // usedSeconds fehlt
});

test("normalizeEntry: clamt negative + Riesenwerte (Bypass-Schutz)", () => {
  const now = 1_000_000;
  const e = normalizeEntry({ limitSeconds: 999999999, usedSeconds: -1e9, day: T, unlockedUntilMs: now + 10 * 365 * 86400_000 }, now)!;
  assert.ok(e);
  assert.equal(e.usedSeconds, 0); // negativ → 0
  assert.equal(e.limitSeconds, 24 * 3600); // Deckel 24h
  assert.equal(e.unlockedUntilMs, now + MAX_UNLOCK_MS); // Freischaltung gedeckelt
});

test("normalizeEntry: akzeptiert gültigen Eintrag unverändert", () => {
  const now = 1_000_000;
  const e = normalizeEntry({ limitSeconds: 1800, usedSeconds: 42, day: T, unlockedUntilMs: now + 60_000 }, now)!;
  assert.deepEqual(e, {
    limitSeconds: 1800,
    usedSeconds: 42,
    day: T,
    unlockedUntilMs: now + 60_000,
    weekLimitSeconds: 0,
    weekUsedSeconds: 0,
    weekStart: "2026-10-19",
    pending: null,
  });
});

// ── Woche ────────────────────────────────────────────────────────────────────

test("weekKeyForDay: Montag der Woche, auch über Monats-/Jahresgrenzen", () => {
  assert.equal(weekKeyForDay("2026-10-25"), "2026-10-19"); // Sonntag → Montag 19.
  assert.equal(weekKeyForDay("2026-10-19"), "2026-10-19"); // Montag bleibt Montag
  assert.equal(weekKeyForDay("2026-01-01"), "2025-12-29"); // Jahreswechsel
  assert.equal(weekKeyForDay("kaputt"), "");
});

test("weeklyRemaining: ohne Wochenlimit unbegrenzt, sonst Rest", () => {
  assert.equal(weeklyRemaining(entry()), Infinity);
  assert.equal(weeklyRemaining(entry({ weekLimitSeconds: 3600, weekUsedSeconds: 600 })), 3000);
  assert.equal(weeklyRemaining(entry({ weekLimitSeconds: 3600, weekUsedSeconds: 5000 })), 0);
});

test("isLocked: Wochenbudget sperrt auch bei Tagesrest", () => {
  const now = 1_000_000;
  const e = entry({ usedSeconds: 0, weekLimitSeconds: 3600, weekUsedSeconds: 3600 });
  assert.equal(isLocked(e, now), true);
  // Freischaltung hebt auch die Wochensperre auf
  assert.equal(isLocked({ ...e, unlockedUntilMs: now + 60_000 }, now), false);
});

test("rolloverEntry: Wochenwechsel setzt weekUsedSeconds zurück", () => {
  const e = entry({ weekLimitSeconds: 3600, weekUsedSeconds: 1800 });
  const nextWeek = rolloverEntry(e, "2026-10-27"); // Woche ab 26.10.
  assert.equal(nextWeek.weekUsedSeconds, 0);
  assert.equal(nextWeek.weekStart, "2026-10-26");
  // gleiche Woche → Verbrauch bleibt
  const sameWeek = rolloverEntry(e, "2026-10-21");
  assert.equal(sameWeek.weekUsedSeconds, 1800);
});

// ── 2-Tage-Wartezeit ─────────────────────────────────────────────────────────

test("requestLimitChange: setzt Ziel + 48h, ändert das aktive Limit NICHT", () => {
  const now = 1_000_000;
  const e = requestLimitChange(entry({ limitSeconds: 1800 }), { dailySeconds: 3600 }, now);
  assert.equal(e.limitSeconds, 1800); // noch alt
  assert.deepEqual(e.pending, {
    dailySeconds: 3600,
    weekSeconds: null,
    effectiveAt: now + LIMIT_CHANGE_DELAY_MS,
  });
  assert.equal(pendingRemainingMs(e, now), LIMIT_CHANGE_DELAY_MS);
});

test("requestLimitChange: gleicher Wert → kein Antrag", () => {
  const now = 1_000_000;
  const e = entry({ limitSeconds: 1800 });
  assert.equal(requestLimitChange(e, { dailySeconds: 1800 }, now), e);
});

test("requestLimitChange: offener Antrag wird NICHT überschrieben (Bypass-Schutz)", () => {
  const now = 1_000_000;
  const strict = requestLimitChange(entry({ limitSeconds: 1800 }), { dailySeconds: 600 }, now);
  // Laxerer Folgeantrag darf die Verschärfung nicht verdrängen.
  const lax = requestLimitChange(strict, { dailySeconds: 86399 }, now + 1000);
  assert.equal(lax, strict);
  assert.equal(lax.pending?.dailySeconds, 600);
});

test("requestLimitChange: Wochenbudget über denselben Antrag", () => {
  const now = 1_000_000;
  const e = requestLimitChange(entry(), { weekSeconds: 3600 }, now);
  assert.equal(e.weekLimitSeconds, 0); // noch alt
  assert.equal(e.pending?.weekSeconds, 3600);
  const applied = applyPendingLimit(e, now + LIMIT_CHANGE_DELAY_MS);
  assert.equal(applied.weekLimitSeconds, 3600);
  assert.equal(applied.pending, null);
});

test("applyPendingLimit: vor Ablauf nichts, nach Ablauf aktiv", () => {
  const now = 1_000_000;
  const e = requestLimitChange(entry({ limitSeconds: 1800 }), { dailySeconds: 600 }, now);
  assert.equal(applyPendingLimit(e, now + 1000).limitSeconds, 1800);
  const applied = applyPendingLimit(e, now + LIMIT_CHANGE_DELAY_MS);
  assert.equal(applied.limitSeconds, 600);
  assert.equal(applied.pending, null);
});

test("cancelPendingLimit: verwirft den Antrag, Limit bleibt", () => {
  const now = 1_000_000;
  const e = requestLimitChange(entry({ limitSeconds: 1800 }), { dailySeconds: 600 }, now);
  const c = cancelPendingLimit(e);
  assert.equal(c.limitSeconds, 1800);
  assert.equal(c.pending, null);
  assert.equal(pendingRemainingMs(c, now), 0);
});

test("normalizeEntry: clampt Wochen- und Pending-Werte", () => {
  const now = 1_000_000;
  const e = normalizeEntry({
    limitSeconds: 1800,
    usedSeconds: 0,
    day: T,
    weekLimitSeconds: 999999999,
    weekUsedSeconds: -5,
    pending: { dailySeconds: 88888888, weekSeconds: null, effectiveAt: now + 999 * 86400_000 },
  }, now)!;
  assert.equal(e.weekLimitSeconds, MAX_WEEK_LIMIT_S);
  assert.equal(e.weekUsedSeconds, 0);
  assert.equal(e.pending?.dailySeconds, MAX_LIMIT_S);
  // Manipulierter Zeitstempel darf die 48 h nicht verlängern.
  assert.equal(e.pending?.effectiveAt, now + LIMIT_CHANGE_DELAY_MS);
});
