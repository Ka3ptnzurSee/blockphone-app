// Passwort-Tresor (pure Logik): pro Domain ein Benutzername + Secret.
// Kein I/O, kein React — die Persistenz macht lib/vaultStore.ts (SecureStore).
// Bedrohungsmodell: Websites dürfen den Tresor NICHT auslesen. Deshalb wird ein
// Secret ausschließlich nach expliziter Bestätigung im nativen Sheet injiziert,
// nie auf Zuruf einer Seite hin.

export type Credential = {
  host: string; // Basisd Domain, z. B. "youtube.com"
  username: string;
  secret: string;
  updatedAt: number;
};

export const MAX_CREDENTIALS = 30;
const MAX_USER = 120;
const MAX_SECRET = 256;

// Public-Suffixe mit zwei Labels (bewusst kleine, erweiterbare Liste statt
// vollständiger PSL). Ohne diese Liste würde baseDomain("m.youtube.co.uk") zu
// "co.uk" kollabieren — ein auf einer co.uk-Seite gespeichertes Passwort wäre
// dann auf JEDER co.uk-Seite verfügbar (Credential-Leak über Domain-Grenzen).
const MULTI_LABEL_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "co.nz", "net.nz", "org.nz",
  "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "co.id", "co.za",
  "com.br", "com.mx", "com.ar", "com.tr", "com.tw", "com.sg", "com.hk",
  "com.cn", "com.pl", "com.ua", "com.ru",
  // Shared-Hosting: jeder Subdomain-Pächter ist eine eigene Vertrauensgrenze.
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app",
  "netlify.app", "herokuapp.com", "appspot.com", "blogspot.com",
  "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com",
]);

// Generisches ccTLD-Muster (co.il, com.co, com.ph, ne.jp …): zweites Label ist
// ein registrierungsartiges Präfix und der Host endet auf einer 2-Buchstaben-TLD.
// Ohne diese Regel kollabieren solche Domains auf "<x>.<cc>" und Credentials
// würden über Domain-Grenzen angeboten. Die explizite Liste oben bleibt für
// Shared-Hosting-Suffixe (github.io, s3.amazonaws.com …).
const CC_SECOND_LEVEL =
  /^(?:co|com|net|org|gov|gob|edu|ac|mil|sch|ne|or|go|nom)\.([a-z]{2})$/;

// Registrierbare Domain — damit ein auf instagram.com gespeichertes Passwort
// auch auf www./m.instagram.com angeboten wird, ohne über Domain-Grenzen zu
// leaken (siehe MULTI_LABEL_SUFFIX).
export function baseDomain(host: string): string {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/:\d+$/, "");
  if (!h || !/^[a-z0-9.-]+$/.test(h)) return "";
  // IP-Literale sind atomar: "10.0.0.1" darf NICHT zu "0.1" kollabieren (sonst
  // teilen sich verschiedene LAN-Hosts denselben Tresor-Eintrag).
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  // Das LÄNGSTE passende Public-Suffix gewinnt ("s3.amazonaws.com" vor
  // "amazonaws.com", "co.uk" vor "uk"). Würde nur das letzte Label-Paar
  // geprüft, wäre der 3-Label-Eintrag "s3.amazonaws.com" wirkungslos: alle
  // Buckets kollabierten auf "amazonaws.com" → Credential-Fill über
  // Mandantengrenzen (mybucket.s3 vs. evil.s3).
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join(".");
    if (MULTI_LABEL_SUFFIX.has(suffix) || CC_SECOND_LEVEL.test(suffix)) {
      return parts.slice(Math.max(0, i - 1)).join(".");
    }
  }
  return parts.slice(-2).join(".");
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return baseDomain(u.hostname);
  } catch {
    return "";
  }
}

export function normalizeCredential(x: unknown, now = Date.now()): Credential | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const host = typeof r.host === "string" ? baseDomain(r.host) : "";
  const username = typeof r.username === "string" ? r.username.trim() : "";
  const rawSecret = typeof r.secret === "string" ? r.secret : "";
  // Secret NICHT trimmen: Leerzeichen können Teil des Passworts sein.
  const secret = rawSecret;
  if (!host || !username || !secret) return null;
  if (username.length > MAX_USER || secret.length > MAX_SECRET) return null;
  const updatedAt =
    typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? Math.floor(r.updatedAt) : now;
  return { host, username, secret, updatedAt: Math.max(0, updatedAt) };
}

// Neueste zuerst, gleicher Host+Benutzer wird ersetzt, Deckel MAX_CREDENTIALS.
export function upsertCredential(list: Credential[], c: Credential): Credential[] {
  const host = baseDomain(c.host);
  const username = c.username.trim();
  if (!host || !username || !c.secret) return list;
  const next = list.filter((e) => !(e.host === host && e.username === username));
  next.unshift({ ...c, host, username });
  return next.slice(0, MAX_CREDENTIALS);
}

export function removeCredential(list: Credential[], host: string, username: string): Credential[] {
  const h = baseDomain(host);
  return list.filter((e) => !(e.host === h && e.username === username));
}

export function credentialsForHost(list: Credential[], host: string): Credential[] {
  const h = baseDomain(host);
  if (!h) return [];
  return list.filter((e) => e.host === h);
}

// Anzeige: nur die letzten zwei Zeichen des Secrets.
export function maskSecret(secret: string): string {
  const s = String(secret || "");
  if (s.length <= 2) return "••";
  return "••••••" + s.slice(-2);
}

// Prüft, ob ein Fill-Versuch zum aktuell geladenen Host passt (Anti-Leak:
// ein offenes Sheet darf nicht auf eine fremde Seite schreiben).
export function canFillOn(list: Credential[], host: string, username: string): boolean {
  const h = baseDomain(host);
  if (!h) return false;
  return list.some((e) => e.host === h && e.username === username);
}
