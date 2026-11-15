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
import { setLimits } from "../shield/ScreenTimeShield";

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

/** Regeln laden und auf die aktuelle App-Auswahl zuschneiden (appCount Zeilen). */
export async function loadRules(appCount: number, now = Date.now()): Promise<AppRule[]> {
  let stored: AppRule[] = [];
  try {
    stored = parseRules(await AsyncStorage.getItem(RULES_KEY));
  } catch {
    stored = [];
  }
  const byIndex = new Map(stored.map((r) => [r.index, applyPending(r, now)]));
  const count = Math.max(0, Math.floor(appCount));
  const out: AppRule[] = [];
  for (let i = 0; i < count; i++) {
    const r = byIndex.get(i);
    out.push(
      r ?? {
        index: i,
        label: `APP ${i + 1}`,
        dailySeconds: 0,
        weeklySeconds: 0,
        pauseSeconds: 0,
        opensPerDay: 0,
        blocked: false,
        pending: null,
      },
    );
  }
  return out;
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
  await setLimits(JSON.stringify(payload));
}

/** Änderung beantragen (wirkt erst nach der Wartezeit). */
export async function requestRuleChange(
  index: number,
  changes: Partial<AppRuleValues>,
  appCount: number,
): Promise<AppRule[]> {
  const [rules, delay] = await Promise.all([loadRules(appCount), loadDelayHours()]);
  const now = Date.now();
  const next = rules.map((r) => (r.index === index ? requestChange(r, changes, now, delay) : r));
  await persist(next);
  return next;
}

/** Ausstehende Änderung verwerfen (nur nach PIN). */
export async function cancelRulePending(index: number, appCount: number): Promise<AppRule[]> {
  const rules = await loadRules(appCount);
  const next = rules.map((r) => (r.index === index ? cancelPending(r) : r));
  await persist(next);
  return next;
}

/** Fällige Änderungen anwenden + Ergebnis persistieren. */
export async function applyDueChanges(appCount: number): Promise<AppRule[]> {
  const rules = await loadRules(appCount);
  const now = Date.now();
  const next = rules.map((r) => applyPending(r, now));
  if (next.some((r, i) => r !== rules[i])) await persist(next);
  return next;
}

/** Für die UI: Minuten-Presets → Sekunden. */
export const minutes = (m: number): number => m * 60;
export const hours = (h: number): number => h * 3600;

export { delayMsFor };
