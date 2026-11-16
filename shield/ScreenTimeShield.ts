// shield/ScreenTimeShield.ts — JS-Brücke zum nativen ScreenTimeShield-Modul
// (modules/screentime-shield/ios/ScreenTimeShieldModule.swift).
//
// WICHTIG (Build 148): Das Modul ist jetzt ein **Expo-Modul**
// (`requireOptionalNativeModule`). Vorher war es ein Legacy-RCT-Modul, das über
// `NativeModules.ScreenTimeShield` geholt wurde — in RN 0.86 / Expo SDK 57 kam
// dort `undefined` an, alle Aufrufe liefen still ins Leere ("Sperre geht
// nicht"). Zusätzlich liefert das Modul jetzt echte Ergebnisse
// (`applied`/`not_applied`) und eine `diagnostics()`-Auskunft, statt Fehler zu
// verschlucken.

import { Platform } from "react-native";
import ScreenTimeShieldNative, {
  type Diagnostics,
  type ShieldState,
  type ShieldResult,
} from "../modules/screentime-shield";

const M = Platform.OS === "ios" ? ScreenTimeShieldNative : null;

export const screenTimeAvailable = !!M;

/** Warum das Modul fehlt (für die Diagnose-Anzeige). */
export function screenTimeUnavailableReason(): string | null {
  if (M) return null;
  if (Platform.OS !== "ios") return `Plattform ${Platform.OS} — Screen Time gibt es nur auf iOS`;
  return "Natives Modul ScreenTimeShield nicht geladen (Build ohne Modul?)";
}

export type ShieldStatus = { status: "approved" | "denied" | "notDetermined"; error?: string };

export type { ShieldState, ShieldResult, Diagnostics };

const EMPTY_STATE: ShieldState = {
  active: false,
  apps: 0,
  categories: 0,
  webDomains: 0,
  selected: { apps: 0, categories: 0, webDomains: 0 },
};

const EMPTY_DIAG: Diagnostics = {
  module: "—",
  authorization: "notDetermined",
  storage: "standard",
  selected: { apps: 0, categories: 0, webDomains: 0 },
  store: { apps: 0, webDomains: 0, categoriesSet: false, denyAppRemoval: false },
  shieldFailed: false,
};

/** Bildschirmzeit-Zugriff für die eigene Person anfragen (.individual). */
export async function requestScreenTimeAccess(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined", error: screenTimeUnavailableReason() ?? undefined };
  try {
    return await M.requestAuthorization();
  } catch (e) {
    return { status: "denied", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function screenTimeStatus(): Promise<ShieldStatus> {
  if (!M) return { status: "notDetermined", error: screenTimeUnavailableReason() ?? undefined };
  try {
    return await M.status();
  } catch (e) {
    return { status: "notDetermined", error: e instanceof Error ? e.message : String(e) };
  }
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
export async function applyShield(): Promise<ShieldResult> {
  if (!M) return { shield: "unavailable" };
  return M.applyShield();
}

export async function clearShield(): Promise<ShieldResult> {
  if (!M) return { shield: "unavailable" };
  return M.clearShield();
}

/** Nur einzelne Apps der Auswahl sperren (Index-Liste). */
export async function shieldApps(indexes: number[]): Promise<ShieldResult> {
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

/** Vollständige Diagnose: Modul, Autorisierung, Speicherort, Auswahl, Store. */
export async function shieldDiagnostics(): Promise<Diagnostics> {
  if (!M) {
    return { ...EMPTY_DIAG, module: screenTimeUnavailableReason() ?? "unbekannt" };
  }
  try {
    return await M.diagnostics();
  } catch (e) {
    return { ...EMPTY_DIAG, module: e instanceof Error ? e.message : String(e) };
  }
}

/** Löschschutz: verhindert das Löschen von Apps (nur mit Kind-/Family-Autorisierung wirksam). */
export async function setDenyAppRemoval(enabled: boolean): Promise<{ requested: boolean; applied: boolean }> {
  if (!M) return { requested: enabled, applied: false };
  try {
    return await M.setDenyAppRemoval(enabled);
  } catch {
    return { requested: enabled, applied: false };
  }
}

export async function getDenyAppRemoval(): Promise<boolean> {
  if (!M) return false;
  try {
    return await M.getDenyAppRemoval();
  } catch {
    return false;
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
