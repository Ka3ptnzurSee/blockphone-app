// modules/screentime-shield/index.ts
//
// JS-Seite des lokalen Expo-Moduls (ios/ScreenTimeShieldModule.swift).
// `requireOptionalNativeModule` → in Expo Go / Web ist das Modul `null`
// statt eines Absturzes (die UI fragt `screenTimeAvailable` ab).

import { requireOptionalNativeModule } from "expo-modules-core";

export type ShieldResult = {
  shield: "on" | "off" | "no_selection" | "not_applied" | "unavailable";
  apps?: number;
  categories?: number;
  webDomains?: number;
  applied?: number;
  requested?: boolean;
};

export type ShieldCounts = { apps: number; categories: number; webDomains: number };

export type ShieldState = {
  active: boolean;
  apps: number;
  categories: number;
  webDomains: number;
  selected: ShieldCounts;
};

export type Diagnostics = {
  module: string;
  authorization: "approved" | "denied" | "notDetermined";
  storage: "app_group" | "standard";
  selected: ShieldCounts;
  store: {
    apps: number;
    webDomains: number;
    categoriesSet: boolean;
    denyAppRemoval: boolean;
  };
  shieldFailed: boolean;
};

export type ScreenTimeShieldNative = {
  requestAuthorization(): Promise<{ status: "approved" | "denied" | "notDetermined"; error?: string }>;
  status(): Promise<{ status: "approved" | "denied" | "notDetermined" }>;
  presentPicker(): Promise<{
    selection: "saved" | "cancelled" | "no_root" | "unavailable";
    apps?: number;
    categories?: number;
    webDomains?: number;
  }>;
  selectedCount(): Promise<number>;
  selectedApps(): Promise<number>;
  applyShield(): Promise<ShieldResult>;
  clearShield(): Promise<ShieldResult>;
  shieldApps(indexes: number[]): Promise<ShieldResult>;
  shieldState(): Promise<ShieldState>;
  setDenyAppRemoval(enabled: boolean): Promise<{ requested: boolean; applied: boolean }>;
  getDenyAppRemoval(): Promise<boolean>;
  diagnostics(): Promise<Diagnostics>;
  setLimits(json: string): Promise<void>;
  getLimits(): Promise<string>;
};

const ScreenTimeShield = requireOptionalNativeModule<ScreenTimeShieldNative>("ScreenTimeShield");

export default ScreenTimeShield;
