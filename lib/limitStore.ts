// AsyncStorage-Anbindung für die Tageslimit-Engine (Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Platform } from "./browser";
import { todayKey } from "./streak";
import { freshEntry, MAX_LIMIT_S, normalizeEntry, rolloverEntry, type LimitEntry } from "./limits";

const KEY = "pb-limits";
const MAX_UNLOCK_MIN = 60; // max. 60 min Freischaltung

export type LimitState = Record<string, LimitEntry>;

// Gespeicherte Limits robust parsen: jedes Entry einzeln validieren.

// Gespeicherte Limits robust parsen: jedes Entry einzeln validieren.
function parseState(raw: string | null): LimitState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: LimitState = {};
    for (const [k, e] of Object.entries(v)) {
      const n = normalizeEntry(e);
      if (n) out[k] = n;
    }
    return out;
  } catch {
    /* korrupt → leer */
  }
  return {};
}

// Tageswechsel über alle Einträge anwenden (usedSeconds → 0).
function rolloverState(state: LimitState, today: string): LimitState {
  const out: LimitState = {};
  for (const [k, e] of Object.entries(state)) {
    out[k] = rolloverEntry(e, today);
  }
  return out;
}

async function save(state: LimitState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}

// Serialisierung: read-modify-write-Mutationen sind sonst race-anfällig
// (paralleles addUsage + unlockFor/relock würden Unlock still verwerfen).
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function loadLimits(): Promise<LimitState> {
  try {
    return rolloverState(parseState(await AsyncStorage.getItem(KEY)), todayKey());
  } catch {
    return {};
  }
}

// Eintrag für eine Plattform sichern (falls fehlt, frisch anlegen).
export function ensureLimit(platform: Platform): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    if (!state[platform]) state[platform] = freshEntry(platform, todayKey());
    await save(state);
    return state;
  });
}

// Verbrauchte Sekunden aufschlagen (Rollover passiert in loadLimits).
export function addUsage(platform: Platform, seconds: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    e.usedSeconds += Math.max(0, Math.floor(seconds));
    state[platform] = e;
    await save(state);
    return state;
  });
}

// Temporär freischalten ("%@ left"): unlockedUntil = jetzt + minutes.
export function unlockFor(platform: Platform, minutes: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    const mins = Math.min(Math.max(1, Math.floor(minutes)), MAX_UNLOCK_MIN);
    e.unlockedUntilMs = Date.now() + mins * 60_000;
    state[platform] = e;
    await save(state);
    return state;
  });
}

// Re-Shield: Freischaltung sofort beenden.
export function relock(platform: Platform): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    e.unlockedUntilMs = 0;
    state[platform] = e;
    await save(state);
    return state;
  });
}

// Tagesration ändern (Einstellung).
export function setDailyLimit(platform: Platform, limitSeconds: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    e.limitSeconds = Math.min(Math.max(0, Math.floor(limitSeconds)), MAX_LIMIT_S);
    state[platform] = e;
    await save(state);
    return state;
  });
}
