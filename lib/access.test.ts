// Tests für die Zugangs-Gating-Logik (harte Sperre, Zeitsperre, Fenster, Ration).
import assert from "node:assert/strict";
import { test } from "node:test";
import { accessMessage, accessState, type AccessInput } from "./access.ts";
import { emptyPosting, emptyQuietHours, type PostingQuota, type QuietHours } from "./schedule.ts";
import type { LimitEntry } from "./limits.ts";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function entry(over: Partial<LimitEntry> = {}): LimitEntry {
  return { limitSeconds: 1800, usedSeconds: 0, day: "2026-11-07", unlockedUntilMs: 0, ...over };
}

function input(over: Partial<AccessInput> = {}): AccessInput {
  return {
    now: NOW,
    entry: entry(),
    quiet: emptyQuietHours(),
    posting: emptyPosting(),
    postingUsed: 0,
    postingUntil: 0,
    hardLockedUntil: 0,
    manualLocked: false,
    cooldownLeftMs: 0,
    sessionLeftMs: 0,
    sessionLimitMs: 0,
    ...over,
  };
}

const nightQuiet: QuietHours = { enabled: true, startMin: 22 * 60, endMin: 7 * 60 };
const middayQuiet: QuietHours = { enabled: true, startMin: 11 * 60, endMin: 13 * 60 };
const zeroWindows: PostingQuota = { timesPerDay: 0, durationMin: 10 };

test("Zugang frei, solange Ration reicht", () => {
  const s = accessState(input());
  assert.equal(s.locked, false);
  assert.equal(s.reason, "ok");
  assert.equal(s.canUnlock, false);
});

test("harte Sperre schlägt alles — kein Unlock, kein Fenster", () => {
  const s = accessState(
    input({
      entry: entry({ usedSeconds: 1800, unlockedUntilMs: NOW + 600_000 }),
      hardLockedUntil: NOW + 86_400_000,
      postingUntil: NOW + 600_000,
    }),
  );
  assert.equal(s.locked, true);
  assert.equal(s.reason, "hardlock");
  assert.equal(s.hardLocked, true);
  assert.equal(s.canUnlock, false);
  assert.equal(s.canOpenWindow, false);
  assert.ok(s.hardLockLeftMs > 0);
});

test("harte Sperre abgelaufen → Ration entscheidet", () => {
  const s = accessState(input({ hardLockedUntil: NOW - 1 }));
  assert.equal(s.hardLocked, false);
  assert.equal(s.locked, false);
});

test("Quiet Hours sperren, auch mit offenem Posting-Fenster", () => {
  const s = accessState(
    input({ quiet: middayQuiet, postingUntil: NOW + 600_000 }),
  );
  assert.equal(s.locked, true);
  assert.equal(s.reason, "quiet");
  assert.equal(s.canUnlock, false);
  assert.equal(s.canOpenWindow, false);
  assert.equal(s.quietUntilMin, 13 * 60);
});

test("Quiet Hours nachts über Mitternacht (23:30 im Fenster 22:00–07:00)", () => {
  const s = accessState(input({ now: Date.UTC(2026, 10, 7, 23, 30), quiet: nightQuiet }));
  assert.equal(s.locked, true);
  assert.equal(s.reason, "quiet");
});

test("Quiet Hours aus → keine Zeitsperre", () => {
  const s = accessState(
    input({ quiet: { enabled: false, startMin: 11 * 60, endMin: 13 * 60 } }),
  );
  assert.equal(s.locked, false);
});

test("Tagesration aufgebraucht → Unlock erlaubt, solange kein Cooldown", () => {
  const exhausted = entry({ usedSeconds: 1800 });
  const s = accessState(input({ entry: exhausted }));
  assert.equal(s.locked, true);
  assert.equal(s.reason, "daily");
  assert.equal(s.canUnlock, true);
  assert.equal(s.canOpenWindow, true);

  const cd = accessState(input({ entry: exhausted, cooldownLeftMs: 30_000 }));
  assert.equal(cd.canUnlock, false);
  assert.equal(cd.canOpenWindow, false);
  assert.equal(cd.inCooldown, true);
});

test("aktive Freischaltung hebt die Tagessperre auf", () => {
  const s = accessState(
    input({ entry: entry({ usedSeconds: 1800, unlockedUntilMs: NOW + 60_000 }) }),
  );
  assert.equal(s.locked, false);
  assert.equal(s.unlockLeftSec, 60);
});

test("Session-Limit: abgelaufen → gesperrt, Unlock möglich", () => {
  const s = accessState(input({ sessionLimitMs: 600_000, sessionLeftMs: 0 }));
  assert.equal(s.locked, true);
  assert.equal(s.reason, "session");
  assert.equal(s.sessionOver, true);
  assert.equal(s.canUnlock, true);
});

test("Session-Limit: Restzeit vorhanden → frei", () => {
  const s = accessState(input({ sessionLimitMs: 600_000, sessionLeftMs: 42_000 }));
  assert.equal(s.locked, false);
});

test("manuelle Sperre greift, bleibt aber entsperrbar", () => {
  const s = accessState(input({ manualLocked: true }));
  assert.equal(s.locked, true);
  assert.equal(s.canUnlock, true);
  assert.equal(s.canOpenWindow, true);

  const cd = accessState(input({ manualLocked: true, cooldownLeftMs: 60_000 }));
  assert.equal(cd.canUnlock, false);
});

test("manuelle Sperre schlägt ein offenes Posting-Fenster", () => {
  const s = accessState(
    input({ manualLocked: true, posting: { timesPerDay: 3, durationMin: 10 }, postingUntil: NOW + 300_000 }),
  );
  assert.equal(s.locked, true);
});

test("Session-Limit konfiguriert, aber keine Sitzung gestartet → frei", () => {
  const s = accessState(input({ sessionLimitMs: 600_000, sessionLeftMs: 600_000 }));
  assert.equal(s.locked, false);
  assert.equal(s.sessionOver, false);
});

test("Posting-Fenster öffnet trotz aufgebrauchter Ration", () => {
  const s = accessState(
    input({
      entry: entry({ usedSeconds: 1800 }),
      posting: { timesPerDay: 3, durationMin: 10 },
      postingUsed: 1,
      postingUntil: NOW + 300_000,
    }),
  );
  assert.equal(s.locked, false);
  assert.equal(s.postingLeftSec, 300);
  assert.equal(s.windowsLeft, 2);
});

test("Posting-Fenster nur bis zum Kontingent", () => {
  const s = accessState(
    input({
      entry: entry({ usedSeconds: 1800 }),
      posting: zeroWindows,
      postingUsed: 0,
    }),
  );
  assert.equal(s.locked, true);
  assert.equal(s.canOpenWindow, false);
  assert.equal(s.windowsLeft, 0);
});

test("negative/kaputte Werte kippen nicht in Zugang", () => {
  const s = accessState(
    input({
      hardLockedUntil: NOW + 10,
      cooldownLeftMs: -5,
      entry: entry({ usedSeconds: -100 }),
      sessionLimitMs: 0,
      sessionLeftMs: -1,
    }),
  );
  assert.equal(s.locked, true);
  assert.equal(s.reason, "hardlock");
  assert.equal(s.inCooldown, false);
});

test("feindliche Eingaben crashen nicht (fail-closed)", () => {
  const hostile: unknown[] = [null, undefined, 0, -1, NaN, Infinity, -Infinity, "", "x", {}, []];
  for (const w of hostile) {
    const s = accessState(w as never);
    assert.equal(typeof s.locked, "boolean");
    assert.equal(typeof s.reason, "string");
    accessMessage(s, w as never);
  }
  // Kaputte Teilfelder: kein Wurf, Sperre bleibt boolesch.
  const s = accessState({
    ...input(),
    now: NaN,
    entry: { limitSeconds: NaN, usedSeconds: NaN, day: "", unlockedUntilMs: NaN },
    quiet: { enabled: true, startMin: NaN, endMin: NaN },
    posting: { timesPerDay: NaN, durationMin: NaN },
  } as never);
  assert.equal(typeof s.locked, "boolean");
});

test("accessMessage liefert die passende Überschrift", () => {
  assert.equal(accessMessage(accessState(input({ hardLockedUntil: NOW + 1 })), entry()), "FESTGESPERRT");
  assert.equal(
    accessMessage(accessState(input({ entry: entry({ usedSeconds: 9999 }) })), entry()),
    "TAGESLIMIT ERREICHT",
  );
  assert.equal(
    accessMessage(accessState(input({ quiet: middayQuiet })), entry()),
    "ZEITFENSTER · BIS 13:00",
  );
});
