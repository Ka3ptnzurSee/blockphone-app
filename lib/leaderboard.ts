// Pure Leaderboard-/Friends-Logik (Dull: Streak-Ranking + Freunde).
// Kein I/O, kein React, keine Backend-Imports — nur reine Funktionen.
export type LeaderboardEntry = {
  userId: string;
  name: string;
  streakDays: number;
  weekActiveDays: number;
  graceUsed: boolean;
};

export type FriendshipStatus = "pending" | "accepted";
export type Friendship = {
  id: string;
  a: string;
  b: string;
  status: FriendshipStatus;
  requestedBy: string;
};

export type FriendRef = { userId: string; name: string };

// Score: Streak-Tage dominieren, aktive Wochentage dienen als Tiebreaker.
export function leaderboardScore(e: LeaderboardEntry): number {
  const days = Math.max(0, Math.floor(e.streakDays));
  const active = Math.min(7, Math.max(0, Math.floor(e.weekActiveDays)));
  return days * 100 + active;
}

export function sortLeaderboard(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => leaderboardScore(b) - leaderboardScore(a));
}

// 1-basierter Rang; -1 wenn nicht enthalten.
export function rankOf(entries: readonly LeaderboardEntry[], userId: string): number {
  const idx = sortLeaderboard(entries).findIndex((e) => e.userId === userId);
  return idx === -1 ? -1 : idx + 1;
}

// Akzeptierte Freunde einer Person (unabhängig von der Richtung der Kante).
export function friendIdsOf(friendships: readonly Friendship[], selfId: string): string[] {
  const out: string[] = [];
  for (const f of friendships) {
    if (f.status !== "accepted") continue;
    if (f.a === selfId) out.push(f.b);
    else if (f.b === selfId) out.push(f.a);
  }
  return [...new Set(out)];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Backend-Rohdaten robust normalisieren (kaputte Einträge verwerfen).
export function normalizeEntry(raw: unknown): LeaderboardEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== "string" || typeof r.name !== "string") return null;
  if (r.userId.length === 0 || r.name.trim().length === 0) return null;
  return {
    userId: r.userId,
    name: r.name,
    streakDays: Math.max(0, Math.floor(num(r.streakDays))),
    weekActiveDays: Math.min(7, Math.max(0, Math.floor(num(r.weekActiveDays)))),
    graceUsed: r.graceUsed === true,
  };
}

export function normalizeEntries(raw: unknown): LeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEntry).filter((e): e is LeaderboardEntry => e !== null);
}

// Freundesliste (Rohantwort) normalisieren.
export function normalizeFriends(raw: unknown): FriendRef[] {
  if (!Array.isArray(raw)) return [];
  const out: FriendRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.userId === "string" && typeof r.name === "string") {
      out.push({ userId: r.userId, name: r.name });
    }
  }
  return out;
}

