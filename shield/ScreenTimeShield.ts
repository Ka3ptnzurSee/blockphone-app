import { NativeModules, Platform } from "react-native";

type ShieldStatus = { status: "approved" | "denied" | "notDetermined" };
const M = Platform.OS === "ios" ? (NativeModules.ScreenTimeShield as any) : null;

export const screenTimeAvailable = !!M;

/** Bildschirmzeit-Zugriff fuer die eigene Person anfragen (.individual, kein Family Sharing noetig). */
export async function requestScreenTimeAccess(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined" };
  return M.requestAuthorization();
}
export async function screenTimeStatus(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined" };
  return M.status();
}
/** Oeffnet den System-Picker: Nutzer waehlt Apps/Kategorien/Webseiten aus, die gesperrt werden. */
export async function pickAppsToBlock(): Promise<{ selection: string }> {
  if (!M) return { selection: "unavailable" };
  return M.presentPicker();
}
export async function applyShield(): Promise<{ shield: string; apps?: number }> {
  if (!M) return { shield: "unavailable" };
  return M.applyShield();
}
export async function clearShield(): Promise<{ shield: string }> {
  if (!M) return { shield: "unavailable" };
  return M.clearShield();
}
export async function selectedAppsCount(): Promise<number> {
  if (!M) return 0;
  return M.selectedCount();
}

