// Persistenz für Posting-Fenster (Scheduled Access): wie viele der erlaubten
// Fenster heute schon geöffnet wurden und bis wann das aktuelle läuft.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayKey } from "./streak";
import { MINUTE_MS, type PostingQuota } from "./schedule";

const KEY = "pb-posting-usage";

export type PostingUsage = {
  day: string; // "YYYY-MM-DD"
  used: number; // heute geöffnete Fenster
  until: number; // epoch ms, 0 = kein offenes Fenster
};

export function emptyUsage(day = todayKey()): PostingUsage {
  return { day, used: 0, until: 0 };
}

// Fremde/kaputte Daten dürfen kein Fenster öffnen (fail-closed).
export function normalizeUsage(x: unknown, day = todayKey()): PostingUsage {
  if (!x || typeof x !== "object" || Array.isArray(x)) return emptyUsage(day);
  const r = x as Record<string, unknown>;
  const used = typeof r.used === "number" && Number.isFinite(r.used) ? Math.floor(r.used) : 0;
  const until = typeof r.until === "number" && Number.isFinite(r.until) ? Math.floor(r.until) : 0;
  if (r.day !== day) return { day, used: 0, until: 0 };
  return { day, used: Math.max(0, used), until: Math.max(0, until) };
}

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function loadPostingUsage(now = Date.now()): Promise<PostingUsage> {
  return withLock(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const day = todayKey(new Date(now));
      return normalizeUsage(raw ? JSON.parse(raw) : null, day);
    } catch {
      return emptyUsage(todayKey(new Date(now)));
    }
  });
}

// Ein Fenster öffnen — nur wenn Kontingent übrig und kein Fenster läuft.
// Gibt null zurück, wenn das Kontingent erschöpft ist (fail-closed).
export function openPostingWindow(
  quota: PostingQuota,
  now = Date.now(),
): Promise<PostingUsage | null> {
  return withLock(async () => {
    const day = todayKey(new Date(now));
    let current = emptyUsage(day);
    try {
      const raw = await AsyncStorage.getItem(KEY);
      current = normalizeUsage(raw ? JSON.parse(raw) : null, day);
    } catch {
      current = emptyUsage(day);
    }
    if (current.until > now) return current;
    if (quota.timesPerDay <= 0 || current.used >= quota.timesPerDay) return null;
    const next: PostingUsage = {
      day,
      used: current.used + 1,
      until: now + quota.durationMin * MINUTE_MS,
    };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return null;
    }
    return next;
  });
}

export function closePostingWindow(): Promise<PostingUsage> {
  return withLock(async () => {
    const usage = emptyUsage();
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(usage));
    } catch {
      /* best effort */
    }
    return usage;
  });
}
