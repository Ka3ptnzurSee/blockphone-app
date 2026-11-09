// AsyncStorage-Anbindung für Zeitfenster (Quiet Hours + Posting Mode), keine UI.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as S from "./schedule";

const K_QUIET = "pb-quiet-hours";
const K_POSTING = "pb-posting";

export async function loadQuietHours(): Promise<S.QuietHours> {
  try {
    const raw = await AsyncStorage.getItem(K_QUIET);
    return S.normalizeQuietHours(raw ? JSON.parse(raw) : null) ?? S.emptyQuietHours();
  } catch {
    return S.emptyQuietHours();
  }
}

export async function saveQuietHours(q: S.QuietHours): Promise<S.QuietHours> {
  await AsyncStorage.setItem(K_QUIET, JSON.stringify(q));
  return q;
}

export async function loadPosting(): Promise<S.PostingQuota> {
  try {
    const raw = await AsyncStorage.getItem(K_POSTING);
    return S.normalizePosting(raw ? JSON.parse(raw) : null) ?? S.emptyPosting();
  } catch {
    return S.emptyPosting();
  }
}

export async function savePosting(p: S.PostingQuota): Promise<S.PostingQuota> {
  await AsyncStorage.setItem(K_POSTING, JSON.stringify(p));
  return p;
}
