// AsyncStorage-Anbindung für Intervention (Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as I from "./intervention";

const KEY = "pb-intervention";

export async function loadIntervention(): Promise<I.InterventionState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return I.normalizeIntervention(raw ? JSON.parse(raw) : null) ?? I.emptyIntervention();
  } catch {
    return I.emptyIntervention();
  }
}

export async function recordIntervention(
  kind: I.InterventionKind,
): Promise<I.InterventionState> {
  const s = await loadIntervention();
  const next = I.recordIntervention(s, kind, Date.now());
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best effort — Intervention nicht an Storage-Fehler scheitern lassen */
  }
  return next;
}

// True, wenn die letzte Intervention noch im Re-Intervention-Fenster liegt.
export async function withinReInterventionWindow(): Promise<boolean> {
  const s = await loadIntervention();
  return I.withinReInterventionWindow(s, Date.now());
}
