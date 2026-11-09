// Pure Zugangs-Gating für den eingebauten Browser.
// Führt alle Sperr-Ebenen in EINER Entscheidung zusammen, damit UI und Tests
// dieselbe Wahrheit sehen: harte Commitment-Sperre, Quiet Hours (Zeitsperre),
// Posting-Fenster, Session-Limit, Tagesration, Cooldown.
// Kein I/O, kein React.
import { dailyRemaining, unlockRemaining, type LimitEntry } from "./limits";
import { withinQuietHours, type PostingQuota, type QuietHours } from "./schedule";

export type AccessReason = "ok" | "daily" | "quiet" | "session" | "hardlock";

export type AccessInput = {
  now: number;
  entry: LimitEntry;
  quiet: QuietHours;
  posting: PostingQuota;
  postingUsed: number; // heute bereits geöffnete Fenster
  postingUntil: number; // epoch ms, 0 = kein offenes Fenster
  hardLockedUntil: number; // epoch ms aus Commitment (0 = keine harte Sperre)
  manualLocked: boolean; // Nutzer hat "jetzt sperren" gedrückt
  cooldownLeftMs: number;
  sessionLeftMs: number;
  sessionLimitMs: number;
};

export type AccessState = {
  locked: boolean;
  reason: AccessReason;
  hardLocked: boolean;
  quietLocked: boolean;
  sessionOver: boolean;
  inCooldown: boolean;
  canUnlock: boolean; // "Atmen & PIN" überhaupt anbieten
  canOpenWindow: boolean; // Posting-Fenster öffnen
  hardLockLeftMs: number;
  remainingSec: number;
  unlockLeftSec: number;
  postingLeftSec: number;
  windowsLeft: number;
  quietUntilMin: number; // Minuten des Tages, zu dem das Zeitfenster endet
};

/* Reihenfolge der Ebenen (bewusst hart nach weich):
   1. Commitment-Sperre  → gar nichts geht, kein Unlock, kein Fenster
   2. Quiet Hours        → Zeitsperre, kein Unlock, kein Fenster
   3. Manuelle Sperre    → "jetzt sperren" (unlock-bar, außer im Cooldown)
   4. Posting-Fenster    → offenes Fenster gewährt Zugang (auch bei aufgebrauchter Ration)
   5. Session-Limit      → Sitzung abgelaufen (unlock-bar, außer im Cooldown)
   6. Tagesration        → aufgebraucht (unlock-bar, außer im Cooldown)
*/
const SAFE_ENTRY: LimitEntry = { limitSeconds: 0, usedSeconds: 0, day: "", unlockedUntilMs: 0 };
const SAFE_QUIET: QuietHours = { enabled: false, startMin: 0, endMin: 0 };
const SAFE_POSTING: PostingQuota = { timesPerDay: 0, durationMin: 0 };

// Fremde/kaputte Eingaben dürfen die Gating-Logik nicht zum Absturz bringen.
// Ziel: fail-closed (lieber sperren als versehentlich öffnen).
function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

export function accessState(rawInput: AccessInput): AccessState {
  const i: AccessInput = {
    now: num(rawInput?.now, Date.now()),
    entry: rawInput?.entry ?? SAFE_ENTRY,
    quiet: rawInput?.quiet ?? SAFE_QUIET,
    posting: rawInput?.posting ?? SAFE_POSTING,
    postingUsed: num(rawInput?.postingUsed),
    postingUntil: num(rawInput?.postingUntil),
    hardLockedUntil: num(rawInput?.hardLockedUntil),
    manualLocked: rawInput?.manualLocked === true,
    cooldownLeftMs: num(rawInput?.cooldownLeftMs),
    sessionLeftMs: num(rawInput?.sessionLeftMs),
    sessionLimitMs: num(rawInput?.sessionLimitMs),
  };
  const remainingSec = dailyRemaining(i.entry);
  const unlockLeftSec = unlockRemaining(i.entry, i.now);
  const hardLockLeftMs = Math.max(0, i.hardLockedUntil - i.now);
  const inCooldown = i.cooldownLeftMs > 0;
  const windowsLeft = Math.max(0, i.posting.timesPerDay - i.postingUsed);
  const quietLocked = i.quiet.enabled && withinQuietHours(i.quiet, new Date(i.now));
  const postingLeftSec =
    i.postingUntil > i.now ? Math.ceil((i.postingUntil - i.now) / 1000) : 0;
  const sessionOver = i.sessionLimitMs > 0 && i.sessionLeftMs <= 0;

  const base = {
    hardLockLeftMs,
    remainingSec,
    unlockLeftSec,
    inCooldown,
    windowsLeft,
    quietLocked,
    postingLeftSec,
    quietUntilMin: i.quiet.endMin,
  };

  // 1. Harte Commitment-Sperre: keine Ausnahme, kein Unlock, kein Fenster.
  if (hardLockLeftMs > 0) {
    return {
      ...base,
      locked: true,
      reason: "hardlock",
      hardLocked: true,
      sessionOver,
      canUnlock: false,
      canOpenWindow: false,
    };
  }

  // 2. Zeitsperre (Quiet Hours): gilt auch für offene Posting-Fenster.
  if (quietLocked) {
    return {
      ...base,
      locked: true,
      reason: "quiet",
      hardLocked: false,
      sessionOver,
      canUnlock: false,
      canOpenWindow: false,
    };
  }

  // 3. Manuell gesperrt (Nutzer-Tap auf ⏻) — Unlock weiterhin möglich.
  if (i.manualLocked) {
    return {
      ...base,
      locked: true,
      reason: "session",
      hardLocked: false,
      sessionOver,
      canUnlock: !inCooldown,
      canOpenWindow: !inCooldown && windowsLeft > 0,
    };
  }

  // 4. Laufendes Posting-Fenster schlägt Ration + Session-Timer.
  if (postingLeftSec > 0) {
    return {
      ...base,
      locked: false,
      reason: "ok",
      hardLocked: false,
      sessionOver,
      canUnlock: false,
      canOpenWindow: false,
    };
  }

  // 5. Session abgelaufen.
  if (sessionOver) {
    return {
      ...base,
      locked: true,
      reason: "session",
      hardLocked: false,
      sessionOver,
      canUnlock: !inCooldown,
      canOpenWindow: !inCooldown && windowsLeft > 0,
    };
  }

  // 6. Tagesration aufgebraucht (und keine laufende Freischaltung).
  if (remainingSec <= 0 && unlockLeftSec <= 0) {
    return {
      ...base,
      locked: true,
      reason: "daily",
      hardLocked: false,
      sessionOver,
      canUnlock: !inCooldown,
      canOpenWindow: !inCooldown && windowsLeft > 0,
    };
  }

  return {
    ...base,
    locked: false,
    reason: "ok",
    hardLocked: false,
    sessionOver,
    canUnlock: false,
    canOpenWindow: false,
  };
}

// Sperr-Text für das Overlay (deutsch, kurz — Nothing-Ton).
export function accessMessage(s: AccessState, entry?: LimitEntry | null): string {
  switch (s.reason) {
    case "hardlock":
      return "FESTGESPERRT";
    case "quiet": {
      const h = Math.floor(s.quietUntilMin / 60);
      const m = s.quietUntilMin % 60;
      return `ZEITFENSTER · BIS ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    case "session":
      return "SITZUNG BEENDET";
    case "daily":
      return "TAGESLIMIT ERREICHT";
    default: {
      const limit = num(entry?.limitSeconds);
      return `${Math.round(limit / 60)} MIN / TAG`;
    }
  }
}

/* Pausiert die Nutzungszeit? Der Browser bleibt seit PiP gemountet, auch wenn
   ein anderer Tab sichtbar ist — ohne diese Entscheidung lief die Ration auf
   Shield/Limits/Mehr weiter, obwohl nichts genutzt wurde. Fail-closed: alles
   außer einem echten `true` bei `active` pausiert. */
export function shouldPauseUsage(active: unknown, locked: unknown): boolean {
  return active !== true || locked === true;
}
