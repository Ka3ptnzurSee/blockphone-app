// AsyncStorage-Anbindung für Streak + PIN (reine Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addActiveDay, isValidPin, newSalt, pinHash, streakDays, todayKey } from "./streak";

export const K = {
  pinHash: "pb-pin-hash",
  pinSalt: "pb-pin-salt",
  installedAt: "pb-installed-at",
  activeDays: "pb-active-days",
};

export type StreakInfo = { days: number };

// Gespeicherte "aktive Tage" robust parsen. AsyncStorage kann korrupte oder
// typfremde Werte enthalten (JSON.parse liefert Zahl/String/Objekt) — nie blind
// an new Set()/streakDays() weiterreichen.
function parseActiveDays(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (
      Array.isArray(v) &&
      v.every((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x))
    ) {
      return v;
    }
  } catch {
    /* korrupt → leer */
  }
  return [];
}

export async function loadStreak(): Promise<StreakInfo> {
  try {
    const activeDaysRaw = await AsyncStorage.getItem(K.activeDays);
    const active = parseActiveDays(activeDaysRaw);
    return { days: streakDays(active, todayKey()) };
  } catch {
    return { days: 0 };
  }
}

// True, wenn bereits eine PIN gesetzt ist.
export async function hasPin(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(K.pinHash));
  } catch {
    return false;
  }
}

// PIN erstmalig setzen (nach Doppel-Eingabe validiert).
export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("PIN muss 4 Ziffern sein");
  const salt = newSalt();
  await AsyncStorage.multiSet([
    [K.pinSalt, salt],
    [K.pinHash, pinHash(pin, salt)],
  ]);
  // Erster Setup-Tag zählt bereits als aktiver Tag (Tag 1 seit Installation).
  await touchActiveDay();
}

// PIN prüfen. Die Streak-Persistenz ist davon entkoppelt: ein korrekter PIN darf
// nie an einem fehlgeschlagenen Storage-Write scheitern (sonst Lockout).
export async function verifyPin(pin: string): Promise<boolean> {
  let ok = false;
  try {
    const [salt, hash] = await Promise.all([
      AsyncStorage.getItem(K.pinSalt),
      AsyncStorage.getItem(K.pinHash),
    ]);
    ok = !!salt && !!hash && isValidPin(pin) && pinHash(pin, salt) === hash;
  } catch {
    return false;
  }
  if (ok) {
    try {
      await touchActiveDay();
    } catch {
      /* Streak ist best effort — Unlock nicht blockieren */
    }
  }
  return ok;
}

// Heute als aktiven Tag vermerken (idempotent) + Installationsdatum sichern.
export async function touchActiveDay(): Promise<void> {
  const today = todayKey();
  const [installedAt, activeDaysRaw] = await Promise.all([
    AsyncStorage.getItem(K.installedAt),
    AsyncStorage.getItem(K.activeDays),
  ]);
  const active = parseActiveDays(activeDaysRaw);
  await AsyncStorage.multiSet([
    [K.installedAt, installedAt || today],
    [K.activeDays, JSON.stringify(addActiveDay(active, today))],
  ]);
}
