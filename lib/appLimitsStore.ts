// lib/appLimitsStore.ts — Persistenz + native Sync der Pro-App-Regeln.
//
// Zwei Speicherorte:
//   1. AsyncStorage  → Wahrheit für die UI (inkl. ausstehender Änderungen)
//   2. ScreenTimeShield.setLimits(json) → Kopie für die Monitor-Extension
//      (die Extension liest sie später, um Limits ohne geöffnete App zu greifen)

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_DELAY_H,
  MAX_DELAY_H,
  MIN_DELAY_H,
  applyPending,
  cancelPending,
  delayMsFor,
  effectiveValues,
  normalizeRule,
  requestChange,
  type AppRule,
  type AppRuleValues,
} from "./appLimits";
import { setLimits, startLimits, stopLimits } from "../shield/ScreenTimeShield";
import { buildMonitorPayload, hasMonitorRules, limitsStartProblem } from "./limitMonitor";

const RULES_KEY = "pb-app-limits";
const DELAY_KEY = "pb-app-limits-delay";

function parseRules(raw: string | null): AppRule[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((x) => normalizeRule(x)).filter((x): x is AppRule => x !== null);
  } catch {
    return [];
  }
}

/** Wartezeit in Stunden (Default 1 Tag). */
export async function loadDelayHours(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(DELAY_KEY);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return DEFAULT_DELAY_H;
    return Math.min(Math.max(Math.round(n), MIN_DELAY_H), MAX_DELAY_H);
  } catch {
    return DEFAULT_DELAY_H;
  }
}

export async function saveDelayHours(hours: number): Promise<number> {
  const h = Math.min(Math.max(Math.round(hours), MIN_DELAY_H), MAX_DELAY_H);
  try {
    await AsyncStorage.setItem(DELAY_KEY, String(h));
  } catch {
    /* best effort */
  }
  return h;
}

async function loadAllRules(now = Date.now()): Promise<AppRule[]> {
  let stored: AppRule[] = [];
  try {
    stored = parseRules(await AsyncStorage.getItem(RULES_KEY));
  } catch {
    stored = [];
  }
  return stored.map((r) => applyPending(r, now));
}

/**
 * Regeln für die UI: auf die aktuelle App-Auswahl zugeschnitten (appCount
 * Zeilen). Regeln außerhalb der Auswahl bleiben gespeichert (siehe persist) —
 * wird die App später wieder gewählt, ist ihre Regel noch da.
 */
export async function loadRules(appCount: number, now = Date.now()): Promise<AppRule[]> {
  const all = await loadAllRules(now);
  const byIndex = new Map(all.map((r) => [r.index, r]));
  const count = Math.max(0, Math.floor(appCount));
  const out: AppRule[] = [];
  for (let i = 0; i < count; i++) {
    const r = byIndex.get(i);
    out.push(r ?? blankRule(i));
  }
  return out;
}

/** AsyncStorage-Schlüssel der letzten Start-Diagnose ("" = alles gut). */
const LIMITS_PROBLEM_KEY = "blockphone.limitsProblem";

/** Letzte gemeldete Ursache, warum Limits nicht laufen (null = kein Problem). */
export async function loadLimitsProblem(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(LIMITS_PROBLEM_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function persist(rules: AppRule[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    /* best effort */
  }
  // Kopie für die Monitor-Extension (JSON, nur gültige Regeln).
  const payload = rules
    .filter((r) => !r.pending)
    .map((r) => ({ index: r.index, ...effectiveValues(r) }));
  try {
    await setLimits(JSON.stringify(payload));
  } catch {
    /* Extension-Sync ist best effort (Modul fehlt z. B. in Expo Go) */
  }
  // Schwellen bei iOS registrieren — ohne diesen Schritt feuert kein Limit,
  // weil das System die App beendet und die Monitor-Extension allein läuft.
  try {
    if (hasMonitorRules(rules)) {
      const res = await startLimits(buildMonitorPayload(rules));
      // Ergebnis PRÜFEN: ohne Auswahl oder bei abgelehntem Zeitfenster feuert
      // kein Limit — das darf die UI nicht als „aktiv" verkaufen.
      const problem = limitsStartProblem(res);
      await AsyncStorage.setItem(LIMITS_PROBLEM_KEY, problem ?? "");
    } else {
      await stopLimits();
      await AsyncStorage.setItem(LIMITS_PROBLEM_KEY, "");
    }
  } catch {
    /* Ohne Modul (Expo Go) bleibt die UI-Wahrheit in AsyncStorage */
  }
}

/** Änderung beantragen (wirkt erst nach der Wartezeit). */
export async function requestRuleChange(
  index: number,
  changes: Partial<AppRuleValues>,
  appCount: number,
): Promise<AppRule[]> {
  const [all, delay] = await Promise.all([loadAllRules(), loadDelayHours()]);
  const now = Date.now();
  const next = all.map((r) => (r.index === index ? requestChange(r, changes, now, delay) : r));
  await persist(next);
  return visible(next, appCount);
}

/** Ausstehende Änderung verwerfen (nur nach PIN). */
export async function cancelRulePending(index: number, appCount: number): Promise<AppRule[]> {
  const all = await loadAllRules();
  const next = all.map((r) => (r.index === index ? cancelPending(r) : r));
  await persist(next);
  return visible(next, appCount);
}

/** Fällige Änderungen anwenden + Ergebnis persistieren. */
export async function applyDueChanges(appCount: number): Promise<AppRule[]> {
  const before = await loadAllRules();
  const now = Date.now();
  const next = before.map((r) => applyPending(r, now));
  if (next.some((r, i) => r !== before[i])) await persist(next);
  return visible(next, appCount);
}

/** Nur die Zeilen der aktuellen Auswahl (Rest bleibt in der Ablage). */
function visible(rules: AppRule[], appCount: number): AppRule[] {
  const count = Math.max(0, Math.floor(appCount));
  const byIndex = new Map(rules.map((r) => [r.index, r]));
  const out: AppRule[] = [];
  for (let i = 0; i < count; i++) out.push(byIndex.get(i) ?? blankRule(i));
  return out;
}

function blankRule(index: number): AppRule {
  return {
    index,
    label: `APP ${index + 1}`,
    dailySeconds: 0,
    weeklySeconds: 0,
    pauseSeconds: 0,
    opensPerDay: 0,
    blocked: false,
    pending: null,
  };
}

/** Für die UI: Minuten-Presets → Sekunden. */
export const minutes = (m: number): number => m * 60;
export const hours = (h: number): number => h * 3600;

export { delayMsFor };
