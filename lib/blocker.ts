// Pure, testbare Helper-Logik des Blockphone-Clients (kein I/O, kein React).

export const MARKER = "# CENTRAL-BLOCK";

// UTF-8 → Bytes (codePointAt-basiert, keine deprecated APIs)
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++; // Surrogate-Paar überspringen
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

// base64 (RFC 4648, UTF-8-sicher) — Hermes hat kein natives btoa
export function b64(s: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b1 >> 2];
    out += chars[((b1 & 3) << 4) | (b2 >> 4)];
    out += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    out += i + 2 < bytes.length ? chars[b3 & 63] : "=";
  }
  return out;
}

// Wörtliche private IPv4 (vollständiger Match + Oktett-Check) — KEIN Präfix-Match,
// damit Hostnamen wie "192.168.0.1.attacker.com" NICHT durchrutschen.
export function isPrivateIPv4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

// Nur http/https zu wörtlichen privaten IPs / localhost / .local — auch https wird
// auf private/lokale Hosts beschränkt (kein Datenabfluss der Geräteliste an fremde Hosts).
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const proto = u.protocol.toLowerCase();
    if (proto !== "https:" && proto !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (isPrivateIPv4(h)) return true;
    if (h === "localhost" || h.endsWith(".local")) return true;
    return false;
  } catch {
    return false;
  }
}

// IP aus einer AdGuard-Filterregel extrahieren (mit Endanker, kein Substring-Match)
export function ruleIp(r: string): string | null {
  const m = r.match(/\$client=([0-9.]+)(?=\s|$)/);
  return m ? m[1] : null;
}

// Gesperrte IPs aus der Regel-Liste (nur CENTRAL-BLOCK-Marker)
export function blockedIps(rules: string[]): Set<string> {
  const s = new Set<string>();
  for (const r of rules) {
    if (!r.includes(MARKER)) continue;
    const ip = ruleIp(r);
    if (ip) s.add(ip);
  }
  return s;
}
