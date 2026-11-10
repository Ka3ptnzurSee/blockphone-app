// lib/vpn.ts — Zugriff auf das lokale Expo-Modul `VpnManager`
// (modules/vpn-manager/ios/VpnManagerModule.swift).
//
// Steuert den DNS-Blocking-Tunnel (targets/packettunnel). Nur im nativen Build
// verfügbar; in Expo Go ist das Modul `null` und `dnsBlockingAvailable()` false.

import type { Platform } from "./browser";
import { buildDnsBlocklist } from "./dnsBlocklist";
import VpnManager, { type VpnStatus } from "../modules/vpn-manager";

/** Startet das systemweite DNS-Blocking (fragt beim ersten Mal den VPN-Hinweis ab). */
export async function startDnsBlocking(domains: string[]): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.start(domains);
}

/** Stoppt den Tunnel (hebt alle DNS-Blocks auf). */
export async function stopDnsBlocking(): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.stop();
}

/** Liefert den Verbindungsstatus des Tunnels. */
export async function dnsBlockingStatus(): Promise<VpnStatus> {
  if (!VpnManager) return { connected: false, configured: false, status: "unavailable" };
  return VpnManager.status();
}

/** Schreibt die Domain-Blocklist in das VPN-Profil (Tunnel startet ggf. neu). */
export async function setDnsBlocklist(domains: string[]): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.setBlocklist(domains);
}

/**
 * Systemweites DNS-Blocking für die gewählten Plattformen aktivieren:
 * Blocklist bauen → Tunnel mit dieser Liste starten.
 * Leere Auswahl = Blocking aus (stop statt start).
 */
export async function enableDnsBlocking(platforms: readonly Platform[]): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  const domains = buildDnsBlocklist(platforms);
  if (domains.length === 0) return VpnManager.stop();
  return VpnManager.start(domains);
}

/** Systemweites DNS-Blocking deaktivieren (Tunnel stoppen). */
export async function disableDnsBlocking(): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.stop();
}

/** true, wenn das native VpnManager-Modul vorhanden ist (nativer Build, nicht Expo Go). */
export function dnsBlockingAvailable(): boolean {
  return !!VpnManager;
}
