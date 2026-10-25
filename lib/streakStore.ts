// AsyncStorage-Anbindung für Streak + PIN (reine Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addActiveDay, daysSince, isValidPin, newSalt, pinHash, streakDays, todayKey } from "./streak";

export const K = {
  pinHash: "pb-pin-hash",
  pinSalt: "pb-pin-salt",
  installedAt: "pb-installed-at",
  activeDays: "pb-active-days",
};

export type StreakInfo = { days: number; since: number };

export async function loadStreak(): Promise<StreakInfo> {
  try {
    const [installedAt, activeDaysRaw] = await Promise.all([
      AsyncStorage.getItem(K.installedAt),
      AsyncStorage.getItem(K.activeDays),
    ]);
    const today = todayKey();
    const installed = installedAt || today;
    const active: string[] = activeDaysRaw ? JSON.parse(activeDaysRaw) : [];
    return { days: streakDays(active, today), since: daysSince(installed, today) };
  } catch {
    return { days: 0, since: 1 };
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
}

// PIN prüfen; bei Erfolg heute als aktiven Tag eintragen (Streak).
export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const [salt, hash] = await Promise.all([
      AsyncStorage.getItem(K.pinSalt),
      AsyncStorage.getItem(K.pinHash),
    ]);
    if (!salt || !hash) return false;
    const ok = isValidPin(pin) && pinHash(pin, salt) === hash;
    if (ok) await touchActiveDay();
    return ok;
  } catch {
    return false;
  }
}

// Heute als aktiven Tag vermerken (idempotent) + Installationsdatum sichern.
export async function touchActiveDay(): Promise<void> {
  const today = todayKey();
  const [installedAt, activeDaysRaw] = await Promise.all([
    AsyncStorage.getItem(K.installedAt),
    AsyncStorage.getItem(K.activeDays),
  ]);
  const active: string[] = activeDaysRaw ? JSON.parse(activeDaysRaw) : [];
  await AsyncStorage.multiSet([
    [K.installedAt, installedAt || today],
    [K.activeDays, JSON.stringify(addActiveDay(active, today))],
  ]);
}
