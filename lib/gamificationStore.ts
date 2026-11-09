// AsyncStorage-Anbindung für Gamification (Grace Day + Weekly Receipt), keine UI.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { K } from "./streakStore";
import { todayKey } from "./streak";
import {
  shouldResetGrace,
  streakDaysWithGrace,
  weeklyStats,
  type GraceInfo,
  type WeekStats,
} from "./gamification";

const K_GRACE = "pb-grace-available";

function parseActiveDays(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x))) return v;
  } catch { /* korrupt → leer */ }
  return [];
}

async function loadGraceAvailable(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(K_GRACE)) !== "false"; }
  catch { return true; }
}

export type GamificationInfo = {
  grace: GraceInfo;
  week: WeekStats;
  streakDays: number; // ohne Kulanz-Tag
};

export async function loadGamification(): Promise<GamificationInfo> {
  const today = todayKey();
  const raw = await AsyncStorage.getItem(K.activeDays);
  const active = parseActiveDays(raw);

  let graceAvailable = await loadGraceAvailable();
  // Kulanz-Tag zurücksetzen bei frischem Start (Streak komplett gebrochen).
  if (!graceAvailable && shouldResetGrace(active, today)) {
    graceAvailable = true;
    try { await AsyncStorage.setItem(K_GRACE, "true"); } catch { /* best effort */ }
  }

  const grace = streakDaysWithGrace(active, graceAvailable, today);
  // Kulanz-Tag verbrauchen, sobald er eine Lücke überbrückt hat.
  if (grace.graceConsumed && graceAvailable) {
    try { await AsyncStorage.setItem(K_GRACE, "false"); } catch { /* best effort */ }
  }

  return { grace, week: weeklyStats(active, today), streakDays: grace.days };
}

