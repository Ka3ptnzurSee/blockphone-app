// Pure Gamification-Logik (Dull-Muster): Grace Day (Kulanz-Tag) + Weekly Receipt.
// Kein I/O, kein React — nur reine Funktionen (importiert Helpers aus ./streak).
import { shiftKey, streakDays, todayKey, yesterdayKey } from "./streak";

// ─────────────────────────────────────────────────────────────────────────────
// Grace Day ("restraint.history.graceDay"): ein Kulanz-Tag pro Streak-Lauf.
// Überbrückt genau EINEN verpassten Tag MITTEN im Streak (aktiver Tag davor und
// dahinter), ohne den Streak zu brechen. Vor dem Streak-Beginn wird NICHT
// verlängert.
// ─────────────────────────────────────────────────────────────────────────────
export type GraceInfo = {
  days: number;
  graceConsumed: boolean; // wurde der Kulanz-Tag bei dieser Berechnung gebraucht?
  graceAvailable: boolean; // ist er (noch) verfügbar?
};

export function streakDaysWithGrace(
  activeDays: readonly string[],
  graceAvailable: boolean,
  today: string = todayKey(),
): GraceInfo {
  const set = new Set(activeDays);
  // Heute noch nicht aktiv → ab gestern zählen (der heutige Tag ist noch offen).
  let cursor = set.has(today) ? today : yesterdayKey(today);
  let days = 0;
  let grace = graceAvailable;
  let graceConsumed = false;

  while (true) {
    if (set.has(cursor)) {
      days++;
      cursor = shiftKey(cursor, -1);
    } else if (grace && set.has(shiftKey(cursor, -1))) {
      // Lücke MITTEN im Streak: dahinter liegt ein aktiver Tag → überbrücken.
      grace = false;
      graceConsumed = true;
      days++;
      cursor = shiftKey(cursor, -1);
    } else {
      break;
    }
  }
  return { days, graceConsumed, graceAvailable: grace };
}

// Kulanz-Tag zurücksetzen, wenn der Streak komplett gebrochen ist (frischer Start).
export function shouldResetGrace(
  activeDays: readonly string[],
  today: string = todayKey(),
): boolean {
  return streakDays(activeDays, today) === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Receipt ("WEEKLY RECEIPT"): Wochenzusammenfassung, Woche = Mo..So.
// ─────────────────────────────────────────────────────────────────────────────
export type WeekBounds = { start: string; end: string };

export function weekBounds(today: string = todayKey()): WeekBounds {
  const [y, m, d] = today.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=Montag … 6=Sonntag
  return { start: shiftKey(today, -dow), end: shiftKey(today, 6 - dow) };
}

export type WeekStats = {
  start: string;
  end: string;
  activeDays: number;
  totalDays: number;
  ratio: number; // 0..1
};

export function weeklyStats(
  activeDays: readonly string[],
  today: string = todayKey(),
): WeekStats {
  const { start, end } = weekBounds(today);
  const set = new Set(activeDays);
  let active = 0;
  for (let k = start; k <= end; k = shiftKey(k, 1)) {
    if (set.has(k)) active++;
  }
  return { start, end, activeDays: active, totalDays: 7, ratio: active / 7 };
}

