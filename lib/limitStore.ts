// AsyncStorage-Anbindung für die Tageslimit-Engine (Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Platform } from "./browser";
import { todayKey } from "./streak";
import { freshEntry, MAX_LIMIT_S, MAX_WEEK_LIMIT_S, normalizeEntry, rolloverEntry, applyPendingLimit, requestLimitChange, cancelPendingLimit, type LimitEntry } from "./limits";

const KEY = "pb-limits";
const MAX_UNLOCK_MIN = 60; // max. 60 min Freischaltung

export type LimitState = Record<string, LimitEntry>;

// Gespeicherte Limits robust parsen: jedes Entry einzeln validieren.
function parseState(raw: string | null): LimitState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error("limit_store_shape");
    }
    const out: LimitState = {};
    for (const [k, e] of Object.entries(v)) {
      const n = normalizeEntry(e);
      if (n) out[k] = n;
    }
    return out;
  } catch (err) {
    // Korruptes JSON NICHT als "leer" behandeln: das wäre eine frische Ration
    // (fail-open). Durchreichen, damit der Aufrufer fail-closed sperrt.
    throw new Error("limit_store_corrupt", { cause: err });
  }
}

// Tageswechsel über alle Einträge anwenden (usedSeconds → 0) und fällige
// Limit-Änderungen (2-Tage-Wartezeit) aktivieren.
function rolloverState(state: LimitState, today: string): LimitState {
  const now = Date.now();
  const out: LimitState = {};
  for (const [k, e] of Object.entries(state)) {
    out[k] = applyPendingLimit(rolloverEntry(e, today), now);
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

// Lese-/Parse-Fehler werden NICHT geschluckt: ein leeres Ergebnis würde als
// "0 Sekunden verbraucht" gelesen (frische Ration) und wäre damit ein Fail-open —
// Tageslimit/Sperre ließen sich durch korrupten Storage aushebeln. Aufrufer
// (z.B. Browser.tsx reloadAll) behandeln den Fehler fail-closed.
export async function loadLimits(): Promise<LimitState> {
  const raw = await AsyncStorage.getItem(KEY);
  return rolloverState(parseState(raw), todayKey());
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
// Zählt auf Tages- UND Wochenbudget.
export function addUsage(platform: Platform, seconds: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    const secs = Math.max(0, Math.floor(seconds));
    e.usedSeconds += secs;
    e.weekUsedSeconds += secs;
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

// Tagesration SOFORT ändern (nur intern/Reset — die UI nutzt requestDailyLimit).
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

// Tagesration ÄNDERN mit 2-Tage-Wartezeit: wird erst nach 48 h wirksam.
export function requestDailyLimit(platform: Platform, limitSeconds: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    state[platform] = requestLimitChange(e, limitSeconds, Date.now());
    await save(state);
    return state;
  });
}

// Ausstehende Änderung verwerfen (Aufrufer muss vorher den PIN geprüft haben).
export function cancelPendingDailyLimit(platform: Platform): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    state[platform] = cancelPendingLimit(e);
    await save(state);
    return state;
  });
}

// Wochenbudget setzen (0 = aus). Gilt sofort — es ist eine Verschärfung oder
// ein Budget, das erst beim Erreichen greift.
export function setWeeklyLimit(platform: Platform, limitSeconds: number): Promise<LimitState> {
  return withLock(async () => {
    const state = await loadLimits();
    const e = state[platform] || freshEntry(platform, todayKey());
    e.weekLimitSeconds = Math.min(Math.max(0, Math.floor(limitSeconds)), MAX_WEEK_LIMIT_S);
    state[platform] = e;
    await save(state);
    return state;
  });
}
