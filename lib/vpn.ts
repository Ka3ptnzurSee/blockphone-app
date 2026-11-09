// lib/vpn.ts — Typisierter Zugriff auf das native VpnManager-Modul.
//
// Steuert den DNS-Blocking-Tunnel (PacketTunnelProvider). Nur im nativen
// Development-Build verfügbar (NativeModules.VpnManager), nicht in Expo Go.

import { NativeModules } from "react-native";
import type { Platform } from "./browser";
import { buildDnsBlocklist } from "./dnsBlocklist";

const { VpnManager } = NativeModules as {
  VpnManager?: {
    start(): Promise<boolean>;
    stop(): Promise<boolean>;
    status(): Promise<{ connected: boolean }>;
    setBlocklist(domains: string[]): Promise<boolean>;
  };
};

/** Startet das systemweite DNS-Blocking (fragt beim ersten Mal den VPN-Hinweis ab). */
export async function startDnsBlocking(): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.start();
}

/** Stoppt den Tunnel (hebt alle DNS-Blocks auf). */
export async function stopDnsBlocking(): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.stop();
}

/** Liefert den Verbindungsstatus des Tunnels. */
export async function dnsBlockingStatus(): Promise<{ connected: boolean }> {
  if (!VpnManager) return { connected: false };
  return VpnManager.status();
}

/** Schreibt die Domain-Blocklist in die App Group (wird vom Tunnel gelesen). */
export async function setDnsBlocklist(domains: string[]): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  return VpnManager.setBlocklist(domains);
}

/**
 * Systemweites DNS-Blocking für die gewählten Plattformen aktivieren:
 * Blocklist bauen → in die App Group schreiben → Tunnel starten.
 * Leere Auswahl = Blocking aus (stop statt start).
 */
export async function enableDnsBlocking(platforms: readonly Platform[]): Promise<boolean> {
  if (!VpnManager) throw new Error("VpnManager-Modul fehlt — nur im nativen Build verfügbar");
  const domains = buildDnsBlocklist(platforms);
  if (domains.length === 0) return VpnManager.stop();
  await setDnsBlocklist(domains);
  return VpnManager.start();
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
