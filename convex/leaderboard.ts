// Convex-Serverfunktionen: Leaderboard + Freunde + Streak-Reports.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Aktuelles Leaderboard (neuester Report pro Nutzer, nach Score sortiert).
export const list = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const reports = await ctx.db.query("streakReports").collect();

    const latest = new Map<
      string,
      { day: string; streakDays: number; weekActiveDays: number; graceUsed: boolean }
    >();
    for (const r of reports) {
      const prev = latest.get(r.userId);
      if (!prev || r.day > prev.day) {
        latest.set(r.userId, {
          day: r.day,
          streakDays: r.streakDays,
          weekActiveDays: r.weekActiveDays,
          graceUsed: r.graceUsed,
        });
      }
    }

    return users
      .map((u) => {
        const s = latest.get(u._id);
        return {
          userId: u._id,
          name: u.name,
          streakDays: s ? s.streakDays : 0,
          weekActiveDays: s ? s.weekActiveDays : 0,
          graceUsed: s ? s.graceUsed : false,
        };
      })
      .sort(
        (a, b) =>
          b.streakDays * 100 + b.weekActiveDays - (a.streakDays * 100 + a.weekActiveDays),
      );
  },
});

// Täglichen Streak-Report upserten (idempotent pro Nutzer + Tag).
export const reportStreak = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    day: v.string(),
    streakDays: v.number(),
    weekActiveDays: v.number(),
    graceUsed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("streakReports")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("day", args.day))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        streakDays: args.streakDays,
        weekActiveDays: args.weekActiveDays,
        graceUsed: args.graceUsed,
      });
    } else {
      await ctx.db.insert("streakReports", {
        userId: args.userId,
        day: args.day,
        streakDays: args.streakDays,
        weekActiveDays: args.weekActiveDays,
        graceUsed: args.graceUsed,
      });
    }
  },
});

// Akzeptierte Freunde eines Nutzers.
export const friendsOf = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const asA = await ctx.db
      .query("friendships")
      .withIndex("by_a", (q) => q.eq("a", args.userId))
      .collect();
    const asB = await ctx.db
      .query("friendships")
      .withIndex("by_b", (q) => q.eq("b", args.userId))
      .collect();
    const ids = new Set<string>();
    for (const f of asA) if (f.status === "accepted") ids.add(f.b);
    for (const f of asB) if (f.status === "accepted") ids.add(f.a);
    const users = await Promise.all([...ids].map((id) => ctx.db.get(id)));
    return users
      .filter((u) => u !== null)
      .map((u) => ({ userId: u!._id, name: u!.name }));
  },
});

// Freundschaftsanfrage senden.
export const requestFriend = mutation({
  args: { from: v.id("users"), to: v.id("users") },
  handler: async (ctx, args) => {
    if (args.from === args.to) throw new Error("Cannot befriend yourself");
    await ctx.db.insert("friendships", {
      a: args.from,
      b: args.to,
      status: "pending",
      requestedBy: args.from,
    });
  },
});

