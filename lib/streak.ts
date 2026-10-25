// Pure, testbare Logik für den "DAYS ON YOUR TERMS"-Streak + 4-stellige PIN.
// Kein I/O, kein React — nur reine Funktionen (analog lib/blocker.ts).

// ─────────────────────────────────────────────────────────────────────────────
// Datums-Keys ("YYYY-MM-DD", lokal)
// ─────────────────────────────────────────────────────────────────────────────

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Key um n Tage verschieben (n kann negativ sein).
export function shiftKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayKey(dt);
}

export function yesterdayKey(today: string): string {
  return shiftKey(today, -1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Streak: zusammenhängende aktive Tage, endend bei "heute" (oder gestern, wenn
// heute noch nicht aktiv ist — der Tag läuft ja noch).
// ─────────────────────────────────────────────────────────────────────────────

export function streakDays(activeDays: readonly string[], today: string = todayKey()): number {
  const set = new Set(activeDays);
  // Heute noch nicht aktiv → ab gestern zählen (der heutige Tag ist noch offen).
  let cursor = set.has(today) ? today : yesterdayKey(today);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = shiftKey(cursor, -1);
  }
  return streak;
}

// Alle "aktiven Tage" (lokal, dedupliziert, sortiert) — heute hinzufügen.
export function addActiveDay(activeDays: readonly string[], day: string): string[] {
  const set = new Set(activeDays);
  set.add(day);
  return [...set].sort();
}

// Tage seit Installation (inkl. heute = 1, wenn heute installiert).
export function daysSince(installedAt: string, today: string = todayKey()): number {
  const [y, m, d] = installedAt.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const a = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const b = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return b - a + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4-stellige PIN — bewusst als "Nudge", NICHT als Sicherheitsgrenze.
// (Spiegelt Dull: der PIN ist eine Reibung, kein Schloss. Trotzdem kein
// Klartext in AsyncStorage — einfacher Salted-Hash.)
// ─────────────────────────────────────────────────────────────────────────────

// FNV-1a 32-bit (nicht kryptographisch — für einen Selbstkontroll-Nudge
// ausreichend; kryptographische Härtung wäre hier falsche Signalwirkung).
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pinHash(pin: string, salt: string): string {
  return fnv1a(`${salt}:${pin}`).toString(16).padStart(8, "0");
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function pinMatches(pin: string, salt: string, storedHash: string): boolean {
  return isValidPin(pin) && pinHash(pin, salt) === storedHash;
}

// Salt pro Installation (z. B. zufällig beim ersten Start erzeugt).
export function newSalt(): string {
  let s = "";
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
