// Convex-Datenmodell für Freunde + Leaderboard (Dull: Streak-Ranking).
// Wird mit "npx convex dev" / "npx convex deploy" aktiviert.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    handle: v.string(),
    createdAt: v.number(),
  }).index("by_handle", ["handle"]),

  friendships: defineTable({
    a: v.id("users"),
    b: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    requestedBy: v.id("users"),
  })
    .index("by_a", ["a"])
    .index("by_b", ["b"]),

  streakReports: defineTable({
    userId: v.id("users"),
    day: v.string(), // YYYY-MM-DD
    streakDays: v.number(),
    weekActiveDays: v.number(),
    graceUsed: v.boolean(),
  }).index("by_user_day", ["userId", "day"]),
});

