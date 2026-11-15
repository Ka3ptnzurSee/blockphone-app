// shield/ScreenTimeShield.ts — JS-Brücke zum nativen ScreenTimeShield-Modul
// (shield/AppTarget/ScreenTimeShield.swift, via plugins/withScreenTimeShield.js).
//
// Alle Aufrufe sind defensiv: in Expo Go / ohne natives Modul liefern sie
// neutrale Werte, statt zu crashen.

import { NativeModules, Platform } from "react-native";

type ShieldStatus = { status: "approved" | "denied" | "notDetermined" };
const M = Platform.OS === "ios" ? (NativeModules.ScreenTimeShield as any) : null;

export const screenTimeAvailable = !!M;

export type ShieldState = {
  active: boolean;
  apps: number;
  categories: number;
  webDomains: number;
  selected: { apps: number; categories: number; webDomains: number };
};

const EMPTY_STATE: ShieldState = {
  active: false,
  apps: 0,
  categories: 0,
  webDomains: 0,
  selected: { apps: 0, categories: 0, webDomains: 0 },
};

/** Bildschirmzeit-Zugriff für die eigene Person anfragen (.individual). */
export async function requestScreenTimeAccess(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined" };
  return M.requestAuthorization();
}

export async function screenTimeStatus(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined" };
  return M.status();
}

/** System-Picker: Apps/Kategorien/Webseiten auswählen (vollflächig). */
export async function pickAppsToBlock(): Promise<{
  selection: string;
  apps?: number;
  categories?: number;
  webDomains?: number;
}> {
  if (!M) return { selection: "unavailable" };
  return M.presentPicker();
}

/** Sperre für die gesamte Auswahl anwenden (Apps + Kategorien + Webseiten). */
export async function applyShield(): Promise<{ shield: string; apps?: number }> {
  if (!M) return { shield: "unavailable" };
  return M.applyShield();
}

export async function clearShield(): Promise<{ shield: string }> {
  if (!M) return { shield: "unavailable" };
  return M.clearShield();
}

/** Nur einzelne Apps der Auswahl sperren (Index-Liste). */
export async function shieldApps(indexes: number[]): Promise<{ shield: string; apps?: number }> {
  if (!M) return { shield: "unavailable" };
  return M.shieldApps(indexes);
}

/** Echter Sperr-Zustand aus dem ManagedSettingsStore (nicht geraten). */
export async function shieldState(): Promise<ShieldState> {
  if (!M) return EMPTY_STATE;
  try {
    const s = await M.shieldState();
    return {
      active: !!s?.active,
      apps: Number(s?.apps ?? 0),
      categories: Number(s?.categories ?? 0),
      webDomains: Number(s?.webDomains ?? 0),
      selected: {
        apps: Number(s?.selected?.apps ?? 0),
        categories: Number(s?.selected?.categories ?? 0),
        webDomains: Number(s?.selected?.webDomains ?? 0),
      },
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function selectedAppsCount(): Promise<number> {
  if (!M) return 0;
  return M.selectedCount();
}

/** Anzahl der Apps in der Auswahl (ohne Kategorien/Webseiten). */
export async function selectedAppsOnly(): Promise<number> {
  if (!M) return 0;
  try {
    return await M.selectedApps();
  } catch {
    return 0;
  }
}

/** Limit-Regeln für die Monitor-Extension ablegen (JSON-String). */
export async function setLimits(json: string): Promise<void> {
  if (!M) return;
  try {
    await M.setLimits(json);
  } catch {
    /* Persistenz ist best effort — UI rechnet weiter mit AsyncStorage */
  }
}
