// Pure Zeitfenster-Logik (Dull/SocialLite-Muster): Quiet Hours, Posting Mode
// (Scheduled Access), Cooldown, Session-Timer. Kein I/O, kein React.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3600_000;

// ── Quiet Hours: tägliches Sperrfenster (Minuten seit Mitternacht) ────────────
export type QuietHours = { enabled: boolean; startMin: number; endMin: number };

export function emptyQuietHours(): QuietHours {
  return { enabled: false, startMin: 22 * 60, endMin: 6 * 60 };
}

export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Fenster kann über Mitternacht laufen (startMin > endMin, z. B. 22:00→06:00).
export function withinQuietHours(q: QuietHours, now: Date): boolean {
  if (!q.enabled || q.startMin === q.endMin) return false;
  const m = minuteOfDay(now);
  if (q.startMin < q.endMin) return m >= q.startMin && m < q.endMin;
  return m >= q.startMin || m < q.endMin;
}

export function formatMinutes(min: number): string {
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function normalizeQuietHours(x: unknown): QuietHours | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.startMin !== "number" || typeof r.endMin !== "number") return null;
  return {
    enabled: r.enabled === true,
    startMin: ((Math.floor(r.startMin) % 1440) + 1440) % 1440,
    endMin: ((Math.floor(r.endMin) % 1440) + 1440) % 1440,
  };
}

// ── Posting Mode (Scheduled Access): X Fenster/Tag à Y Minuten ───────────────
export type PostingQuota = { timesPerDay: number; durationMin: number };

export function emptyPosting(): PostingQuota {
  return { timesPerDay: 3, durationMin: 10 };
}

export function normalizePosting(x: unknown): PostingQuota | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.timesPerDay !== "number" || typeof r.durationMin !== "number") return null;
  return {
    timesPerDay: Math.min(Math.max(0, Math.floor(r.timesPerDay)), 50),
    durationMin: Math.min(Math.max(1, Math.floor(r.durationMin)), 240),
  };
}

// ── Cooldown nach Entsperrung ──────────────────────────────────────────────────
export function cooldownRemaining(unlockedAt: number, cooldownMs: number, now: number): number {
  if (!unlockedAt || cooldownMs <= 0) return 0;
  return Math.max(0, cooldownMs - (now - unlockedAt));
}

export function withinCooldown(unlockedAt: number, cooldownMs: number, now: number): boolean {
  return cooldownRemaining(unlockedAt, cooldownMs, now) > 0;
}

// ── Session-Timer: Restzeit einer laufenden Sitzung ───────────────────────────
export function sessionRemaining(startedAt: number, limitMs: number, now: number): number {
  if (!startedAt || limitMs <= 0) return 0;
  return Math.max(0, limitMs - (now - startedAt));
}

// ── Session-Settings (Cooldown + Session-Timer) ──────────────────────────────
export type SessionSettings = { cooldownMin: number; sessionLimitMin: number };

export function emptySessionSettings(): SessionSettings {
  return { cooldownMin: 0, sessionLimitMin: 0 };
}

export function normalizeSessionSettings(x: unknown): SessionSettings | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.cooldownMin !== "number" || typeof r.sessionLimitMin !== "number") return null;
  return {
    cooldownMin: Math.min(Math.max(0, Math.floor(r.cooldownMin)), 180),
    sessionLimitMin: Math.min(Math.max(0, Math.floor(r.sessionLimitMin)), 240),
  };
}