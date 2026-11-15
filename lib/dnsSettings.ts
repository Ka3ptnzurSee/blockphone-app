// lib/dnsSettings.ts — ein Ort für die DNS-/Werbeblocker-Einstellungen.
//
// Vorher lagen die Keys verteilt in components/Shield.tsx ("pb-dns-platforms",
// "pb-dns-mode") — dadurch konnte der APPS-Tab den Werbeblocker nicht
// unabhängig schalten. Jetzt: ein Objekt, alte Keys werden migriert.
//
// Der DNS-Tunnel und die App-Sperre (Screen Time) sind zwei getrennte Systeme:
// dieser Store betrifft NUR den DNS-Tunnel (Werbe-/Tracker-/Plattform-Domains).

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Platform } from "./browser";
import { ALL_PLATFORMS } from "./dnsBlocklist";
import { enableDnsBlocking, disableDnsBlocking, dnsBlockingStatus, type DnsMode } from "./vpn";

const KEY = "pb-dns-settings";
// Alte Keys (Migration, damit bestehende Installationen ihre Auswahl behalten).
const LEGACY_PLATFORMS = "pb-dns-platforms";
const LEGACY_MODE = "pb-dns-mode";

export type DnsSettings = {
  platforms: Platform[];
  mode: DnsMode;
  /** Werbe-/Tracker-Domains blocken (unabhängig von den Plattformen). */
  ads: boolean;
};

export const DEFAULT_DNS: DnsSettings = {
  platforms: ALL_PLATFORMS,
  mode: "blocklist",
  ads: true,
};

export async function loadDnsSettings(): Promise<DnsSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return normalize(v);
    }
    // Migration: alte Einzel-Keys
    const [rawPlatforms, rawMode] = await Promise.all([
      AsyncStorage.getItem(LEGACY_PLATFORMS),
      AsyncStorage.getItem(LEGACY_MODE),
    ]);
    const platforms = rawPlatforms ? JSON.parse(rawPlatforms) : null;
    const mode = rawMode === "allowlist" ? "allowlist" : "blocklist";
    return normalize({ platforms: Array.isArray(platforms) ? platforms : DEFAULT_DNS.platforms, mode });
  } catch {
    return DEFAULT_DNS;
  }
}

function normalize(v: unknown): DnsSettings {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const list = Array.isArray(r.platforms) ? r.platforms : [];
  const platforms = list.filter((p): p is Platform => (ALL_PLATFORMS as string[]).includes(p as string));
  return {
    platforms: platforms.length > 0 ? platforms : DEFAULT_DNS.platforms,
    mode: r.mode === "allowlist" ? "allowlist" : "blocklist",
    // Default an: Werbeblocker ist der Kern dieses Schalters.
    ads: r.ads === undefined ? true : r.ads === true,
  };
}

export async function saveDnsSettings(s: DnsSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best effort */
  }
}

/** Einstellungen anwenden: Tunnel mit dieser Konfiguration (neu) starten. */
export async function applyDnsSettings(s: DnsSettings): Promise<boolean> {
  return enableDnsBlocking(s.platforms, s.mode, [], s.ads);
}

/** Tunnel aus. */
export async function stopDns(): Promise<boolean> {
  return disableDnsBlocking();
}

export async function dnsRunning(): Promise<boolean> {
  try {
    const st = await dnsBlockingStatus();
    return !!st.connected;
  } catch {
    return false;
  }
}

/** Kurzfassung für die UI ("3 Domains/Plattformen + Werbung"). */
export function describeDns(s: DnsSettings): string {
  if (s.mode === "allowlist") return "INTERNET AUS (alles außer Ausnahmen)";
  const parts: string[] = [];
  if (s.ads) parts.push("WERBUNG + TRACKER");
  if (s.platforms.length > 0) parts.push(`${s.platforms.length} PLATTFORMEN`);
  return parts.length ? parts.join(" + ") : "NICHTS AUSGEWÄHLT";
}
