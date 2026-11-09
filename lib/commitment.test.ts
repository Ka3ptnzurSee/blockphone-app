import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyCommitment,
  lockSettings,
  unlockSettings,
  startRecovery,
  recoveryRemaining,
  recoveryDone,
  cancelRecovery,
  requestDisable,
  cancelDisable,
  disableRemaining,
  disableReady,
  lockFilter,
  filterLockRemaining,
  isFilterLocked,
  normalizeCommitment,
  formatDurationMs,
  RECOVERY_MS,
  settingsLockInfo,
  DELAY_MS,
  DAY_MS,
  HOUR_MS,
} from "./commitment";

const T0 = 1_700_000_000_000;

test("lockSettings sperrt und unlockSettings (PIN) entsperrt sofort", () => {
  const s = lockSettings(emptyCommitment(), T0);
  assert.equal(s.settingsLocked, true);
  assert.equal(s.settingsLockedAt, T0);
  const u = unlockSettings(s, T0 + 1000, false);
  assert.equal(u.settingsLocked, false);
  assert.equal(u.settingsLockedAt, 0);
});

test("unlockSettings via Recovery blockt vor Ablauf der 48h", () => {
  let s = lockSettings(emptyCommitment(), T0);
  s = startRecovery(s, T0);
  // nach 1h: Recovery nicht fertig → bleibt gesperrt
  assert.equal(unlockSettings(s, T0 + HOUR_MS, true).settingsLocked, true);
  // nach 47h: immer noch gesperrt
  assert.equal(unlockSettings(s, T0 + 47 * HOUR_MS, true).settingsLocked, true);
  // nach 48h: entsperrt
  assert.equal(unlockSettings(s, T0 + RECOVERY_MS, true).settingsLocked, false);
});

test("recoveryRemaining/recovryDone/cancelRecovery", () => {
  let s = startRecovery(emptyCommitment(), T0);
  assert.equal(recoveryRemaining(s, T0 + 1000), RECOVERY_MS - 1000);
  assert.equal(recoveryDone(s, T0 + RECOVERY_MS - 1), false);
  assert.equal(recoveryDone(s, T0 + RECOVERY_MS), true);
  s = cancelRecovery(s);
  assert.equal(s.recoveryStartedAt, 0);
  assert.equal(recoveryRemaining(s, T0 + 1000), 0);
});

test("24h-Filter-Delay: erst nach 24h ready, abbrechbar", () => {
  let s = requestDisable(emptyCommitment(), T0);
  assert.equal(s.pendingDisableAt, T0 + DELAY_MS);
  assert.equal(disableReady(s, T0 + DELAY_MS - 1), false);
  assert.equal(disableReady(s, T0 + DELAY_MS), true);
  s = cancelDisable(s);
  assert.equal(s.pendingDisableAt, 0);
  assert.equal(disableRemaining(s, T0), 0);
  assert.equal(disableReady(s, T0 + DELAY_MS * 2), false);
});

test("lockFilter sperrt Plattform für X Tage", () => {
  let s = lockFilter(emptyCommitment(), "instagram", 7, T0);
  assert.equal(s.filterLockedUntil.instagram, T0 + 7 * DAY_MS);
  assert.equal(isFilterLocked(s, "instagram", T0 + 1000), true);
  assert.equal(isFilterLocked(s, "instagram", T0 + 7 * DAY_MS), false);
  assert.equal(filterLockRemaining(s, "instagram", T0 + DAY_MS), 6 * DAY_MS);
  // unbekannte Plattform: nie gesperrt
  assert.equal(isFilterLocked(s, "youtube", T0), false);
});

test("lockFilter deckelt auf 30 Tage und Minimum 1", () => {
  const s1 = lockFilter(emptyCommitment(), "x", 999, T0);
  assert.equal(filterLockRemaining(s1, "x", T0), 30 * DAY_MS);
  const s2 = lockFilter(emptyCommitment(), "x", 0, T0);
  assert.equal(filterLockRemaining(s2, "x", T0), DAY_MS);
});

test("normalizeCommitment verwirft Type-Confusion", () => {
  assert.equal(normalizeCommitment(null), null);
  assert.equal(normalizeCommitment("locked"), null);
  assert.equal(normalizeCommitment([1, 2, 3]), null);
  const n = normalizeCommitment({
    settingsLocked: true,
    settingsLockedAt: "kein-number",
    recoveryStartedAt: -5,
    pendingDisableAt: 123,
    filterLockedUntil: { instagram: T0, bad: "x", neg: -1 },
  });
  assert.ok(n);
  assert.equal(n.settingsLocked, true);
  assert.equal(n.settingsLockedAt, 0); // String → 0
  assert.equal(n.recoveryStartedAt, 0); // negativ → 0
  assert.equal(n.pendingDisableAt, 123);
  assert.deepEqual(n.filterLockedUntil, { instagram: T0 }); // "x" und -1 verworfen
});

test("formatDurationMs formatiert d/h/m", () => {
  assert.equal(formatDurationMs(0), "0m");
  assert.equal(formatDurationMs(90_000), "1m");
  assert.equal(formatDurationMs(HOUR_MS), "1h");
  assert.equal(formatDurationMs(90 * 60_000), "1h 30m");
  assert.equal(formatDurationMs(26 * HOUR_MS), "1d 2h");
  assert.equal(formatDurationMs(2 * DAY_MS), "2d 0h");
});

test("settingsLockInfo: frei ohne Sperre", () => {
  const info = settingsLockInfo(emptyCommitment(), T0);
  assert.equal(info.locked, false);
  assert.equal(info.since, 0);
  assert.equal(info.recoveryLeftMs, 0);
  assert.equal(info.canRecoverNow, false);
});

test("settingsLockInfo: gesperrt liefert Sperrzeit und Recovery-Rest", () => {
  const s = lockSettings(startRecovery(emptyCommitment(), T0), T0 + 1000);
  const info = settingsLockInfo(s, T0 + HOUR_MS);
  assert.equal(info.locked, true);
  assert.equal(info.since, T0 + 1000);
  assert.equal(info.recoveryLeftMs, RECOVERY_MS - HOUR_MS);
  assert.equal(info.canRecoverNow, false);
});

test("settingsLockInfo: Recovery abgelaufen → Freigabe möglich", () => {
  const s = lockSettings(startRecovery(emptyCommitment(), T0), T0);
  const info = settingsLockInfo(s, T0 + RECOVERY_MS + 1);
  assert.equal(info.canRecoverNow, true);
  assert.equal(info.recoveryLeftMs, 0);
});
