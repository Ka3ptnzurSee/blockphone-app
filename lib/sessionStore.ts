// AsyncStorage-Anbindung für Session-Timer + Cooldown (keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as S from "./schedule";

const K_SETTINGS = "pb-session-settings";
const K_UNLOCKED_AT = "pb-session-unlockedAt";
const K_STARTED_AT = "pb-session-startedAt";

export async function loadSessionSettings(): Promise<S.SessionSettings> {
  try {
    const raw = await AsyncStorage.getItem(K_SETTINGS);
    return S.normalizeSessionSettings(raw ? JSON.parse(raw) : null) ?? S.emptySessionSettings();
  } catch {
    return S.emptySessionSettings();
  }
}

export async function saveSessionSettings(s: S.SessionSettings): Promise<S.SessionSettings> {
  await AsyncStorage.setItem(K_SETTINGS, JSON.stringify(s));
  return s;
}

export async function markUnlocked(now?: number): Promise<number> {
  const t = now || Date.now();
  try { await AsyncStorage.setItem(K_UNLOCKED_AT, String(t)); } catch { /* best effort */ }
  return t;
}

export async function getUnlockedAt(): Promise<number> {
  try { return Number(await AsyncStorage.getItem(K_UNLOCKED_AT)) || 0; } catch { return 0; }
}

export async function markSessionStarted(now?: number): Promise<number> {
  const t = now || Date.now();
  try { await AsyncStorage.setItem(K_STARTED_AT, String(t)); } catch { /* best effort */ }
  return t;
}

export async function getSessionStartedAt(): Promise<number> {
  try { return Number(await AsyncStorage.getItem(K_STARTED_AT)) || 0; } catch { return 0; }
}

