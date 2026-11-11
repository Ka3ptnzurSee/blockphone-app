// Pure, testbare Limit-Logik (SocialLite-Muster): "X/Tag, resets um Mitternacht"
// plus Wochenbudget und 2-Tage-Wartezeit für Limit-Änderungen.
// Kein I/O, kein React. "usedSeconds" akkumuliert pro Tag; "unlockedUntilMs" =
// temporäre Freischaltung ("%@ left" in SocialLite).
import type { Platform } from "./browser";

export type LimitEntry = {
  limitSeconds: number; // Tagesration
  usedSeconds: number; // heute verbraucht
  day: string; // "YYYY-MM-DD", auf den sich usedSeconds bezieht
  unlockedUntilMs: number; // 0 = keine temporäre Freischaltung aktiv

  // ── Wochenbudget (0 = kein Wochenlimit) ────────────────────────────────────
  weekLimitSeconds: number;
  weekUsedSeconds: number;
  weekStart: string; // "YYYY-MM-DD" des Montags der laufenden Woche

  // ── 2-Tage-Wartezeit für Änderungen der Tagesration ────────────────────────
  pendingLimitSeconds: number; // 0 = keine Änderung ausstehend
  pendingEffectiveAt: number; // epoch ms, ab wann pendingLimitSeconds gilt
};

export const MAX_LIMIT_S = 24 * 3600; // Tagesration-Deckel (24 h)
export const MAX_WEEK_LIMIT_S = 7 * 24 * 3600; // Wochenbudget-Deckel (168 h)
export const MAX_UNLOCK_MS = 4 * 3600_000; // Freischaltung-Deckel (4 h)
// Änderungen an der Tagesration werden erst nach 48 h wirksam — gegen
// "future-you", das im Impuls hochdreht (Dulls 24h-Filter-Delay, nur strenger).
export const LIMIT_CHANGE_DELAY_MS = 48 * 3600_000;

// SocialLite-Defaults: Reels-/Feed-Apps enger, YouTube/Facebook lockerer.
export const DEFAULT_LIMITS: Record<Platform, number> = {
  youtube: 30 * 60,
  instagram: 30 * 60,
  facebook: 20 * 60,
  x: 20 * 60,
  reddit: 20 * 60,
};

// Verbleibende Tagesration (nie negativ).
export function dailyRemaining(e: LimitEntry): number {
  return Math.max(0, e.limitSeconds - e.usedSeconds);
}

// Verbleibendes Wochenbudget. Ohne Wochenlimit: Infinity (blockiert nie).
export function weeklyRemaining(e: LimitEntry): number {
  if (!(e.weekLimitSeconds > 0)) return Infinity;
  return Math.max(0, e.weekLimitSeconds - e.weekUsedSeconds);
}

// Verbleibende Zeit einer temporären Freischaltung (nie negativ).
export function unlockRemaining(e: LimitEntry, now = Date.now()): number {
  return Math.max(0, Math.ceil((e.unlockedUntilMs - now) / 1000));
}

// Gesperrt = (Tagesration ODER Wochenbudget aufgebraucht) UND keine Freischaltung.
export function isLocked(e: LimitEntry, now = Date.now()): boolean {
  const dailyEmpty = dailyRemaining(e) <= 0;
  const weeklyEmpty = weeklyRemaining(e) <= 0;
  return (dailyEmpty || weeklyEmpty) && unlockRemaining(e, now) <= 0;
}

// "MM:SS" (< 1 h) bzw. "Xh Ym" (>= 1 h) — SocialLite "%lld:%@ left".
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Ration lesbar ("30m", "1h", "1h 30m") für "30m/Tag".
export function formatRation(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(s / 60)}m`;
}

// ── Woche ────────────────────────────────────────────────────────────────────

// Montag der Woche, in der `day` ("YYYY-MM-DD") liegt — als "YYYY-MM-DD".
// Ungültige Eingabe → "" (Aufrufer behandelt das als "kein Wochenbezug").
export function weekKeyForDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  const back = (d.getUTCDay() + 6) % 7; // Sonntag=0 → Montag=0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// ── 2-Tage-Wartezeit ─────────────────────────────────────────────────────────

// Änderung der Tagesration beantragen: gilt erst nach LIMIT_CHANGE_DELAY_MS.
export function requestLimitChange(e: LimitEntry, seconds: number, now: number): LimitEntry {
  const target = Math.min(Math.max(0, Math.floor(seconds)), MAX_LIMIT_S);
  // Kein Antrag nötig, wenn der Wert schon gilt.
  if (target === e.limitSeconds && e.pendingLimitSeconds === 0) return e;
  return {
    ...e,
    pendingLimitSeconds: target,
    pendingEffectiveAt: now + LIMIT_CHANGE_DELAY_MS,
  };
}

// Ausstehende Änderung verwerfen (nur nach PIN-Bestätigung aufrufen).
export function cancelPendingLimit(e: LimitEntry): LimitEntry {
  return { ...e, pendingLimitSeconds: 0, pendingEffectiveAt: 0 };
}

// Fällige Änderung anwenden. Idempotent; ohne Antrag unverändert.
export function applyPendingLimit(e: LimitEntry, now: number): LimitEntry {
  if (!(e.pendingEffectiveAt > 0) || e.pendingLimitSeconds < 0) return e;
  if (now < e.pendingEffectiveAt) return e;
  return {
    ...e,
    limitSeconds: e.pendingLimitSeconds,
    pendingLimitSeconds: 0,
    pendingEffectiveAt: 0,
  };
}

// Restzeit bis zur Aktivierung (0 = nichts ausstehend).
export function pendingRemainingMs(e: LimitEntry, now: number): number {
  if (!(e.pendingEffectiveAt > 0)) return 0;
  return Math.max(0, e.pendingEffectiveAt - now);
}

// ── Konstruktion / Rollover / Validierung ────────────────────────────────────

// Neues LimitEntry für einen frischen Tag (heute, 0 verbraucht, keine Freischaltung).
export function freshEntry(platform: Platform, today: string): LimitEntry {
  return {
    limitSeconds: DEFAULT_LIMITS[platform],
    usedSeconds: 0,
    day: today,
    unlockedUntilMs: 0,
    weekLimitSeconds: 0,
    weekUsedSeconds: 0,
    weekStart: weekKeyForDay(today),
    pendingLimitSeconds: 0,
    pendingEffectiveAt: 0,
  };
}

// Tageswechsel: usedSeconds zurück auf 0, Freischaltung verwerfen, wenn day != today.
// Wochenwechsel: weekUsedSeconds zurück auf 0, wenn die Woche gewechselt hat.
export function rolloverEntry(e: LimitEntry, today: string): LimitEntry {
  const wk = weekKeyForDay(today);
  const weekChanged = wk !== "" && e.weekStart !== wk;
  if (e.day === today && !weekChanged) return e;
  return {
    ...e,
    usedSeconds: e.day === today ? e.usedSeconds : 0,
    day: today,
    unlockedUntilMs: e.day === today ? e.unlockedUntilMs : 0,
    weekUsedSeconds: weekChanged ? 0 : e.weekUsedSeconds,
    weekStart: weekChanged ? wk : e.weekStart,
  };
}

// Eintrag aus unbekannter Quelle (AsyncStorage) validieren → null wenn ungültig.
// Verhindert Type-Confusion (String/negative usedSeconds hebeln sonst die Sperre
// aus) und deckelt Freischaltung, Ration und Wochenbudget.
export function normalizeEntry(e: unknown, now = Date.now()): LimitEntry | null {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const r = e as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const limit = num(r.limitSeconds);
  const used = num(r.usedSeconds);
  if (limit === null || used === null) return null;
  const unlocked = num(r.unlockedUntilMs);
  const day = typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : "";
  const weekLimit = num(r.weekLimitSeconds) ?? 0;
  const weekUsed = num(r.weekUsedSeconds) ?? 0;
  const weekStart =
    typeof r.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.weekStart)
      ? r.weekStart
      : weekKeyForDay(day);
  const pendingLimit = num(r.pendingLimitSeconds) ?? 0;
  const pendingAt = num(r.pendingEffectiveAt) ?? 0;
  return {
    limitSeconds: Math.min(Math.max(0, Math.floor(limit)), MAX_LIMIT_S),
    usedSeconds: Math.max(0, Math.floor(used)),
    day,
    unlockedUntilMs: Math.min(Math.max(unlocked ?? 0, 0), now + MAX_UNLOCK_MS),
    weekLimitSeconds: Math.min(Math.max(0, Math.floor(weekLimit)), MAX_WEEK_LIMIT_S),
    weekUsedSeconds: Math.max(0, Math.floor(weekUsed)),
    weekStart,
    pendingLimitSeconds: Math.min(Math.max(0, Math.floor(pendingLimit)), MAX_LIMIT_S),
    pendingEffectiveAt: Math.max(0, pendingAt),
  };
}
