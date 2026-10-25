// Pure, testbare Tageslimit-Logik (SocialLite-Muster): "X/Tag, resets um Mitternacht".
// Kein I/O, kein React. "usedSeconds" akkumuliert pro Tag; "unlockedUntilMs" = temporäre
// Freischaltung ("%@ left" in SocialLite).
import type { Platform } from "./browser";

export type LimitEntry = {
  limitSeconds: number; // Tagesration
  usedSeconds: number; // heute verbraucht
  day: string; // "YYYY-MM-DD", auf den sich usedSeconds bezieht
  unlockedUntilMs: number; // 0 = keine temporäre Freischaltung aktiv
};

export const MAX_LIMIT_S = 24 * 3600; // Tagesration-Deckel (24 h)
export const MAX_UNLOCK_MS = 4 * 3600_000; // Freischaltung-Deckel (4 h)

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

// Verbleibende Zeit einer temporären Freischaltung (nie negativ).
export function unlockRemaining(e: LimitEntry, now = Date.now()): number {
  return Math.max(0, Math.ceil((e.unlockedUntilMs - now) / 1000));
}

// Gesperrt = Tagesration aufgebraucht UND keine aktive Freischaltung.
export function isLocked(e: LimitEntry, now = Date.now()): boolean {
  return dailyRemaining(e) <= 0 && unlockRemaining(e, now) <= 0;
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

// Neues LimitEntry für einen frischen Tag (heute, 0 verbraucht, keine Freischaltung).
export function freshEntry(platform: Platform, today: string): LimitEntry {
  return {
    limitSeconds: DEFAULT_LIMITS[platform],
    usedSeconds: 0,
    day: today,
    unlockedUntilMs: 0,
  };
}

// Tageswechsel: usedSeconds zurück auf 0, Freischaltung verwerfen, wenn day != today.
export function rolloverEntry(e: LimitEntry, today: string): LimitEntry {
  if (e.day === today) return e;
  return { ...e, usedSeconds: 0, day: today, unlockedUntilMs: 0 };
}

// Eintrag aus unbekannter Quelle (AsyncStorage) validieren → null wenn ungültig.
// Verhindert Type-Confusion (String/negative usedSeconds hebeln sonst die Sperre
// aus) und deckelt Freischaltung + Ration.
export function normalizeEntry(e: unknown, now = Date.now()): LimitEntry | null {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const r = e as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const limit = num(r.limitSeconds);
  const used = num(r.usedSeconds);
  if (limit === null || used === null) return null;
  const unlocked = num(r.unlockedUntilMs);
  return {
    limitSeconds: Math.min(Math.max(0, Math.floor(limit)), MAX_LIMIT_S),
    usedSeconds: Math.max(0, Math.floor(used)),
    day: typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : "",
    unlockedUntilMs: Math.min(Math.max(unlocked ?? 0, 0), now + MAX_UNLOCK_MS),
  };
}
