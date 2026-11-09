// Pure, testbare Commitment-Logik (Dull-Muster) — der Anti-Undo-Mechanismus
// gegen "future-you". Kein I/O, kein React. Vier verschränkte Sperren:
//   1. Settings-Lock (Einstellungen komplett sperren)
//   2. 48h-PIN-Recovery (PIN vergessen → 48h warten)
//   3. 24h-Filter-Delay (Filter/Redirect aus = 24h, abbrechbar)
//   4. Filter-Sperrdauer (einzelne Plattform für X Tage festsperren)

export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;
export const RECOVERY_MS = 48 * HOUR_MS;
export const DELAY_MS = 24 * HOUR_MS;
export const LOCK_PRESETS_DAYS = [1, 2, 3, 5, 7, 14, 30] as const;

export type CommitmentState = {
  settingsLocked: boolean;
  settingsLockedAt: number; // epoch ms; 0 = nie
  recoveryStartedAt: number; // epoch ms; 0 = keine Recovery aktiv
  pendingDisableAt: number; // epoch ms; 0 = kein 24h-Delay aktiv
  filterLockedUntil: Record<string, number>; // platform -> epoch ms
};

export function emptyCommitment(): CommitmentState {
  return {
    settingsLocked: false,
    settingsLockedAt: 0,
    recoveryStartedAt: 0,
    pendingDisableAt: 0,
    filterLockedUntil: {},
  };
}

// ── 1. Settings-Lock ──────────────────────────────────────────────────────────
export function lockSettings(s: CommitmentState, now: number): CommitmentState {
  return { ...s, settingsLocked: true, settingsLockedAt: now };
}

// Entsperren: nur direkt (PIN geprüft) oder nach abgelaufener 48h-Recovery.
export function unlockSettings(
  s: CommitmentState,
  now: number,
  viaRecovery = false,
): CommitmentState {
  if (!s.settingsLocked) return s;
  if (viaRecovery && !recoveryDone(s, now)) return s;
  return { ...s, settingsLocked: false, settingsLockedAt: 0, recoveryStartedAt: 0 };
}

// Zusammenfassung für UI-Guards: Einstellungen sind gesperrt, bis der PIN
// eingegeben oder die 48h-Recovery abgelaufen ist. Andere Screens (Limits,
// Zeit) fragen das ab, damit eine harte Sperre nicht durch bloßes Ändern der
// Werte umgangen werden kann.
export type SettingsLockInfo = {
  locked: boolean;
  since: number;
  recoveryLeftMs: number;
  canRecoverNow: boolean;
};

export function settingsLockInfo(s: CommitmentState, now: number): SettingsLockInfo {
  const locked = s.settingsLocked === true;
  return {
    locked,
    since: locked ? (Number.isFinite(s.settingsLockedAt) ? s.settingsLockedAt : 0) : 0,
    recoveryLeftMs: locked ? recoveryRemaining(s, now) : 0,
    canRecoverNow: locked && recoveryDone(s, now),
  };
}

// ── 2. 48h-PIN-Recovery ───────────────────────────────────────────────────────
export function startRecovery(s: CommitmentState, now: number): CommitmentState {
  return { ...s, recoveryStartedAt: now };
}

export function recoveryRemaining(s: CommitmentState, now: number): number {
  if (!s.recoveryStartedAt) return 0;
  return Math.max(0, s.recoveryStartedAt + RECOVERY_MS - now);
}

export function recoveryDone(s: CommitmentState, now: number): boolean {
  return s.recoveryStartedAt > 0 && recoveryRemaining(s, now) <= 0;
}

export function cancelRecovery(s: CommitmentState): CommitmentState {
  return { ...s, recoveryStartedAt: 0 };
}

// ── 3. 24h-Filter-Delay ───────────────────────────────────────────────────────
export function requestDisable(s: CommitmentState, now: number): CommitmentState {
  return { ...s, pendingDisableAt: now + DELAY_MS };
}

export function cancelDisable(s: CommitmentState): CommitmentState {
  return { ...s, pendingDisableAt: 0 };
}

export function disableRemaining(s: CommitmentState, now: number): number {
  if (!s.pendingDisableAt) return 0;
  return Math.max(0, s.pendingDisableAt - now);
}

export function disableReady(s: CommitmentState, now: number): boolean {
  return s.pendingDisableAt > 0 && disableRemaining(s, now) <= 0;
}

// ── 4. Filter-Sperrdauer ("hold to lock") ─────────────────────────────────────
export function lockFilter(
  s: CommitmentState,
  platform: string,
  days: number,
  now: number,
): CommitmentState {
  const d = Math.min(Math.max(1, Math.floor(days)), 30);
  return {
    ...s,
    filterLockedUntil: { ...s.filterLockedUntil, [platform]: now + d * DAY_MS },
  };
}

export function filterLockRemaining(s: CommitmentState, platform: string, now: number): number {
  const until = s.filterLockedUntil[platform];
  if (!until) return 0;
  return Math.max(0, until - now);
}

export function isFilterLocked(s: CommitmentState, platform: string, now: number): boolean {
  return filterLockRemaining(s, platform, now) > 0;
}

// ── Validierung aus unbekannter Quelle (AsyncStorage) ────────────────────────
export function normalizeCommitment(x: unknown, now = Date.now()): CommitmentState | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const map: Record<string, number> = {};
  const lockedUntil = r.filterLockedUntil;
  if (lockedUntil && typeof lockedUntil === "object" && !Array.isArray(lockedUntil)) {
    for (const [k, v] of Object.entries(lockedUntil as Record<string, unknown>)) {
      const n = num(v);
      if (n !== null && n > 0) map[k] = n;
    }
  }

  return {
    settingsLocked: r.settingsLocked === true,
    settingsLockedAt: Math.max(0, num(r.settingsLockedAt) ?? 0),
    recoveryStartedAt: Math.max(0, num(r.recoveryStartedAt) ?? 0),
    pendingDisableAt: Math.max(0, num(r.pendingDisableAt) ?? 0),
    filterLockedUntil: map,
  };
}

// ── Formatierung ──────────────────────────────────────────────────────────────
export function formatDurationMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
