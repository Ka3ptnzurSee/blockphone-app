import { test } from "node:test";
import assert from "node:assert/strict";
import {
  friendIdsOf,
  leaderboardScore,
  normalizeEntries,
  normalizeEntry,
  normalizeFriends,
  rankOf,
  sortLeaderboard,
  type Friendship,
  type LeaderboardEntry,
} from "./leaderboard";

const e = (userId: string, streakDays: number, weekActiveDays: number): LeaderboardEntry => ({
  userId,
  name: userId,
  streakDays,
  weekActiveDays,
  graceUsed: false,
});

test("leaderboardScore: Streak dominiert, aktive Tage als Tiebreaker", () => {
  assert.equal(leaderboardScore(e("a", 3, 7)), 307);
  assert.equal(leaderboardScore(e("b", 4, 0)), 400);
  assert.ok(leaderboardScore(e("b", 4, 0)) > leaderboardScore(e("a", 3, 7)));
});

test("sortLeaderboard: sortiert absteigend nach Score", () => {
  const sorted = sortLeaderboard([e("a", 2, 5), e("b", 5, 1), e("c", 2, 7)]);
  assert.deepEqual(sorted.map((x) => x.userId), ["b", "c", "a"]);
});

test("rankOf: liefert 1-basierten Rang oder -1", () => {
  const entries = [e("a", 2, 5), e("b", 5, 1), e("c", 2, 7)];
  assert.equal(rankOf(entries, "b"), 1);
  assert.equal(rankOf(entries, "c"), 2);
  assert.equal(rankOf(entries, "a"), 3);
  assert.equal(rankOf(entries, "z"), -1);
});

test("friendIdsOf: akzeptierte Freunde in beide Richtungen", () => {
  const fs: Friendship[] = [
    { id: "1", a: "me", b: "x", status: "accepted", requestedBy: "me" },
    { id: "2", a: "y", b: "me", status: "accepted", requestedBy: "y" },
    { id: "3", a: "me", b: "z", status: "pending", requestedBy: "me" },
  ];
  assert.deepEqual(friendIdsOf(fs, "me").sort(), ["x", "y"]);
});

test("normalizeEntry: verwirft kaputte Rohdaten", () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({}), null);
  assert.equal(normalizeEntry({ userId: "a", name: "" }), null);
  const ok = normalizeEntry({ userId: "a", name: "Alice", streakDays: -3, weekActiveDays: 99, graceUsed: true });
  assert.deepEqual(ok, { userId: "a", name: "Alice", streakDays: 0, weekActiveDays: 7, graceUsed: true });
});

test("normalizeEntries + normalizeFriends: Arrays robust behandeln", () => {
  assert.deepEqual(normalizeEntries(null), []);
  assert.deepEqual(normalizeEntries([null, { userId: "a", name: "A", streakDays: 1, weekActiveDays: 2, graceUsed: false }]), [
    { userId: "a", name: "A", streakDays: 1, weekActiveDays: 2, graceUsed: false },
  ]);
  assert.deepEqual(normalizeFriends([{ userId: "a", name: "A" }, { bad: 1 }, null]), [{ userId: "a", name: "A" }]);
});

