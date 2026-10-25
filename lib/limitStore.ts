// AsyncStorage-Anbindung für die Tageslimit-Engine (Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Platform } from "./browser";
import { todayKey } from "./streak";
import { freshEntry, rolloverEntry, type LimitEntry } from "./limits";

const KEY = "pb-limits";

export type LimitState = Record<string, LimitEntry>;

// Gespeicherte Limits robust parsen (AsyncStorage kann korrupt/typfremd sein).
function parseState(raw: string | null): LimitState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as LimitState;
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

export async function loadLimits(): Promise<LimitState> {
  try {
    return rolloverState(parseState(await AsyncStorage.getItem(KEY)), todayKey());
  } catch {
    return {};
  }
}

// Eintrag für eine Plattform sichern (falls fehlt, frisch anlegen).
export async function ensureLimit(platform: Platform): Promise<LimitState> {
  const state = await loadLimits();
  if (!state[platform]) state[platform] = freshEntry(platform, todayKey());
  await save(state);
  return state;
}

// Verbrauchte Sekunden aufschlagen (Rollover passiert in loadLimits).
export async function addUsage(platform: Platform, seconds: number): Promise<LimitState> {
  const state = await loadLimits();
  const e = state[platform] || freshEntry(platform, todayKey());
  e.usedSeconds += Math.max(0, Math.floor(seconds));
  state[platform] = e;
  await save(state);
  return state;
}

// Temporär freischalten ("%@ left"): unlockedUntil = jetzt + minutes.
export async function unlockFor(platform: Platform, minutes: number): Promise<LimitState> {
  const state = await loadLimits();
  const e = state[platform] || freshEntry(platform, todayKey());
  e.unlockedUntilMs = Date.now() + minutes * 60_000;
  state[platform] = e;
  await save(state);
  return state;
}

// Re-Shield: Freischaltung sofort beenden.
export async function relock(platform: Platform): Promise<LimitState> {
  const state = await loadLimits();
  const e = state[platform] || freshEntry(platform, todayKey());
  e.unlockedUntilMs = 0;
  state[platform] = e;
  await save(state);
  return state;
}

// Tagesration ändern (Einstellung).
export async function setDailyLimit(platform: Platform, limitSeconds: number): Promise<LimitState> {
  const state = await loadLimits();
  const e = state[platform] || freshEntry(platform, todayKey());
  e.limitSeconds = Math.max(0, Math.floor(limitSeconds));
  state[platform] = e;
  await save(state);
  return state;
}
