// Convex-Anbindung (Freunde + Leaderboard). Nur hier liegen Convex-SDK-Imports.
import { ConvexHttpClient } from "convex/browser";
import {
  normalizeEntries,
  normalizeFriends,
  type FriendRef,
  type LeaderboardEntry,
} from "./leaderboard";

// Deployment-URL wird zur Buildzeit aus EXPO_PUBLIC_CONVEX_URL eingebrannt.
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

let client: ConvexHttpClient | null = null;

// Hinweis: ConvexHttpClient akzeptiert zur Laufzeit auch einen String-Namen
// (getFunctionName lässt Strings durch). Die Typen verlangen FunctionReference,
// daher der Cast. Nach "npx convex dev" kann auf api.leaderboard.list umgestellt werden.
type StringQuery = (name: string, args?: unknown) => Promise<unknown>;
type StringMutation = (name: string, args?: unknown) => Promise<unknown>;

function getClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  if (!client) client = new ConvexHttpClient(CONVEX_URL);
  return client;
}

export function convexConfigured(): boolean {
  return CONVEX_URL.length > 0;
}

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const raw = await (c.query as unknown as StringQuery)("leaderboard:list", {});
    return normalizeEntries(raw);
  } catch {
    return [];
  }
}

export async function loadFriends(selfId: string): Promise<FriendRef[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const raw = await (c.query as unknown as StringQuery)("leaderboard:friendsOf", { userId: selfId });
    return normalizeFriends(raw);
  } catch {
    return [];
  }
}

export function reportStreak(report: {
  userId: string;
  name: string;
  day: string;
  streakDays: number;
  weekActiveDays: number;
  graceUsed: boolean;
}): void {
  const c = getClient();
  if (!c) return;
  void (c.mutation as unknown as StringMutation)("leaderboard:reportStreak", report).catch(() => {});
}

export async function requestFriend(
  from: string,
  to: string,
): Promise<{ success: boolean; error: string | null }> {
  const c = getClient();
  if (!c) {
    return { success: false, error: "Convex nicht konfiguriert (EXPO_PUBLIC_CONVEX_URL fehlt)" };
  }
  try {
    await (c.mutation as unknown as StringMutation)("leaderboard:requestFriend", { from, to });
    return { success: true, error: null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

