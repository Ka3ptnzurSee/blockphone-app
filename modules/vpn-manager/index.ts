// modules/vpn-manager/index.ts
//
// JS-Seite des lokalen Expo-Moduls (ios/VpnManagerModule.swift).
// `requireOptionalNativeModule` → in Expo Go / Web ist das Modul einfach `null`
// statt eines Absturzes; die UI fragt `dnsBlockingAvailable()` ab.

import { requireOptionalNativeModule } from "expo-modules-core";

export type VpnStatus = {
  connected: boolean;
  configured?: boolean;
  status?: string;
};

export type VpnNativeModule = {
  /**
   * Startet den DNS-Tunnel.
   * mode "blocklist" = nur `domains` sperren.
   * mode "allowlist" = ALLES sperren außer `allowlist` (= Internet aus).
   */
  start(
    domains: string[],
    allowlist: string[],
    mode: "blocklist" | "allowlist",
    ads: boolean,
  ): Promise<boolean>;
  /** Stoppt den Tunnel und schaltet On-Demand ab. */
  stop(): Promise<boolean>;
  /** Verbindungsstatus des Tunnels. */
  status(): Promise<VpnStatus>;
  /** Blocklist im bestehenden Profil tauschen (startet den Tunnel ggf. neu). */
  setBlocklist(domains: string[]): Promise<boolean>;
};

const VpnManager = requireOptionalNativeModule<VpnNativeModule>("VpnManager");

export default VpnManager;
