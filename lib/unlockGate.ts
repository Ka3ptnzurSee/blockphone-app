// lib/unlockGate.ts — Gnadenfrist für das App-PIN-Gate.
//
// Problem vorher: `unlocked` war nur React-State → jeder Kaltstart (iOS killt
// die App im Hintergrund ständig) verlangte Intervention + PIN. Das ist Reibung
// ohne Nutzen, wenn man die App nur kurz weggelegt hat.
//
// Lösung: Zeitstempel des letzten erfolgreichen Entsperrens persistieren.
// Innerhalb von UNLOCK_GRACE_MS öffnet die App direkt (kein PIN, keine
// Intervention). Danach wieder voller Flow.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pb-app-unlocked-at";

/** 15 Minuten: kurz weggelegt → offen; neue Sitzung → PIN. */
export const UNLOCK_GRACE_MS = 15 * 60_000;

export async function markAppUnlocked(now = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(now));
  } catch {
    /* best effort — im Zweifel fragt die App wieder nach dem PIN */
  }
}

export async function lastAppUnlock(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** true, wenn das letzte Entsperren innerhalb der Gnadenfrist liegt. */
export async function withinUnlockGrace(now = Date.now()): Promise<boolean> {
  const t = await lastAppUnlock();
  if (t <= 0) return false;
  const delta = now - t;
  // Negativer Delta (Uhr zurückgestellt) → nicht als "frisch" werten.
  return delta >= 0 && delta < UNLOCK_GRACE_MS;
}

/** Gnadenfrist sofort beenden (z. B. "jetzt sperren"). */
export async function clearUnlockGrace(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
}
