// lib/dnsBlocklist.ts — Domain-Zuordnung für das systemweite DNS-Blocking.
//
// Der PacketTunnelProvider (Personal VPN, native/ios/PacketTunnelProvider) blockt
// DNS-Anfragen per Suffix-Match (DnsFilter.isBlocked). Diese Zuordnung übersetzt
// die Plattformen aus browser.ts in die Domains, die die nativen Apps UND die
// Web-Versionen nutzen — analog zu Freedoms Blocklist, aber fokussiert auf die
// 5 unterstützten Plattformen.
//
// Bewusst KEINE breiten Shared-CDN-Domains (z. B. gstatic.com), die fremde
// Google-Dienste (Gmail, Suche) mitblocken würden. Nur Plattform-eigene oder
// klar zuordenbare Domains.
import type { Platform } from "./browser";

export const PLATFORM_DOMAINS: Record<Platform, string[]> = {
  youtube: [
    "youtube.com",
    "youtu.be",            // Shortlinks
    "googlevideo.com",     // Video-Streaming (sonst spielen Videos trotz Block)
    "ytimg.com",           // Thumbnails/CDN
    "youtube-nocookie.com", // Embed
    "yt.be",
  ],
  instagram: [
    "instagram.com",
    "cdninstagram.com",
    "instagramstatic.com",
    "ig.me",               // Shortlinks
  ],
  facebook: [
    "facebook.com",
    "fb.com",
    "facebook.net",        // FB-API/CDN
    "fbsbx.com",           // statische Assets
    "messenger.com",
    "fbwat.ch",            // Video-Shortlinks
  ],
  x: [
    "x.com",
    "twitter.com",
    "twimg.com",           // Bilder/CDN
    "t.co",                // Shortlinks (überall in X genutzt)
  ],
  reddit: [
    "reddit.com",
    "redd.it",             // Shortlinks
    "redditmedia.com",     // Media-CDNs
    "redditstatic.com",    // statische Assets
  ],
};

/** Alle unterstützten Plattformen (Reihenfolge stabil aus PLATFORM_DOMAINS). */
export const ALL_PLATFORMS: Platform[] = Object.keys(PLATFORM_DOMAINS) as Platform[];

/**
 * Union der Domains für die gewählten Plattformen — normalisiert (lowercase,
 * getrimmt, Rand-Punkte entfernt), dedupliziert, sortiert. Leere Auswahl → [].
 */
export function buildDnsBlocklist(platforms: readonly Platform[]): string[] {
  const set = new Set<string>();
  for (const p of platforms) {
    for (const d of PLATFORM_DOMAINS[p] ?? []) {
      const clean = d.toLowerCase().trim().replace(/^\.+|\.+$/g, "");
      if (clean) set.add(clean);
    }
  }
  return [...set].sort();
}

/** Default: alle Plattformen systemweit blocken. */
export const DEFAULT_DNS_BLOCKLIST: string[] = buildDnsBlocklist(ALL_PLATFORMS);
