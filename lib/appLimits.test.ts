// Tests für die Pro-App-Regel-Engine (Wartezeit, Validierung, Durchsetzung).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DELAY_H,
  MAX_PAUSE_S,
  MAX_WEEKLY_S,
  applyPending,
  cancelPending,
  delayMsFor,
  describeRule,
  effectiveValues,
  enforceableRules,
  formatAmount,
  formatRemaining,
  hasRule,
  normalizeRule,
  pendingRemainingMs,
  requestChange,
  type AppRule,
} from "./appLimits";

const H = 3600_000;

const base = (over: Partial<AppRule> = {}): AppRule => ({
  index: 0,
  label: "APP 1",
  dailySeconds: 0,
  weeklySeconds: 0,
  pauseSeconds: 0,
  opensPerDay: 0,
  blocked: false,
  pending: null,
  ...over,
});

test("requestChange legt Antrag mit Wartezeit an, ändert aber noch nichts", () => {
  const now = 1_000_000;
  const r = requestChange(base(), { dailySeconds: 1800 }, now, 24);
  assert.equal(r.dailySeconds, 0, "Wert gilt noch nicht");
  assert.ok(r.pending);
  assert.equal(r.pending!.at, now + 24 * H);
  assert.deepEqual(r.pending!.changes, { dailySeconds: 1800 });
});

test("zweiter Antrag überschreibt den offenen nicht (Verschärfung nicht aushebelbar)", () => {
  const now = 1_000_000;
  const once = requestChange(base(), { dailySeconds: 600 }, now, 12);
  const twice = requestChange(once, { dailySeconds: 7200 }, now + 1000, 12);
  assert.equal(twice, once);
  assert.equal(twice.pending!.changes.dailySeconds, 600);
});

test("identische Werte erzeugen keinen Antrag", () => {
  const r = requestChange(base({ dailySeconds: 600 }), { dailySeconds: 600 }, 0, 24);
  assert.equal(r.pending, null);
});

test("applyPending wirkt erst nach Ablauf und ist idempotent", () => {
  const now = 5 * H;
  const r = requestChange(base(), { dailySeconds: 900, weeklySeconds: 3600 }, now, 24);
  const tooEarly = applyPending(r, now + 23 * H);
  assert.equal(tooEarly.pending !== null, true);
  assert.equal(tooEarly.dailySeconds, 0);

  const due = applyPending(r, now + 24 * H);
  assert.equal(due.dailySeconds, 900);
  assert.equal(due.weeklySeconds, 3600);
  assert.equal(due.pending, null);
  assert.equal(applyPending(due, now + 48 * H), due);
});

test("cancelPending gibt den Slot wieder frei", () => {
  const r = requestChange(base(), { blocked: true }, 0, 24);
  const c = cancelPending(r);
  assert.equal(c.pending, null);
  assert.equal(c.blocked, false);
});

test("pendingRemainingMs zählt herunter, nie negativ", () => {
  const r = requestChange(base(), { opensPerDay: 3 }, 1000, 1);
  assert.equal(pendingRemainingMs(r, 1000), delayMsFor(1));
  assert.equal(pendingRemainingMs(r, 1000 + 2 * H), 0);
  assert.equal(pendingRemainingMs(base(), 0), 0);
});

test("delayMsFor klemmt auf 1..72 h", () => {
  assert.equal(delayMsFor(0), 1 * H);
  assert.equal(delayMsFor(24), 24 * H);
  assert.equal(delayMsFor(9999), 72 * H);
  assert.equal(delayMsFor(NaN), DEFAULT_DELAY_H * H);
});

test("normalizeRule weist Müll ab und deckelt Extreme", () => {
  assert.equal(normalizeRule(null), null);
  assert.equal(normalizeRule("x"), null);
  assert.equal(normalizeRule({ index: -1 }), null);
  const ok = normalizeRule({ index: 3, dailySeconds: 999_999, weeklySeconds: -5, pauseSeconds: 999_999 });
  assert.ok(ok);
  assert.equal(ok!.dailySeconds, 86400, "Tageslimit gedeckelt");
  assert.equal(ok!.weeklySeconds, 0, "negativ → 0");
  assert.equal(ok!.pauseSeconds, MAX_PAUSE_S, "Pause gedeckelt");
  assert.equal(ok!.weeklySeconds <= MAX_WEEKLY_S, true);
});

test("normalizeRule: manipulierte Wartezeit wird auf das Maximum geklemmt", () => {
  const now = 10 * H;
  const r = normalizeRule(
    { index: 0, pending: { at: now + 10_000 * H, changes: { dailySeconds: 60 } } },
    now,
  );
  assert.ok(r!.pending);
  assert.ok(r!.pending!.at <= now + delayMsFor(72));
  assert.equal(r!.pending!.changes.dailySeconds, 60);
});

test("normalizeRule verwirft Anträge ohne Änderungen", () => {
  const r = normalizeRule({ index: 0, pending: { at: 5, changes: {} } });
  assert.equal(r!.pending, null);
});

test("enforceableRules lässt ausstehende Änderungen außen vor", () => {
  const rules: AppRule[] = [
    base({ index: 0, blocked: true }),
    base({ index: 1, pending: { at: 1e12, changes: { blocked: true } } }),
    base({ index: 2 }),
    base({ index: 3, dailySeconds: 600 }),
  ];
  const out = enforceableRules(rules);
  assert.deepEqual(
    out.map((o) => o.index),
    [0, 3],
  );
});

test("hasRule/describeRule/formatAmount/formatRemaining", () => {
  assert.equal(hasRule(effectiveValues(base())), false);
  assert.equal(hasRule(effectiveValues(base({ pauseSeconds: 60 }))), true);
  assert.match(describeRule(effectiveValues(base({ dailySeconds: 1800, opensPerDay: 3 }))), /30m\/TAG/);
  assert.match(describeRule(effectiveValues(base())), /KEINE REGEL/);
  assert.equal(formatAmount(0), "AUS");
  assert.equal(formatAmount(600), "10m");
  assert.equal(formatAmount(5400), "1h 30m");
  assert.equal(formatRemaining(0), "0 min");
  assert.match(formatRemaining(90 * H), /T/);
});
