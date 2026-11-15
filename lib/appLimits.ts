// lib/appLimits.ts — Limit-Regeln pro App (Sperre/Limits) inklusive
// Pflicht-Wartezeit für Änderungen.
//
// Pure, testbare Logik: kein I/O, kein React. Die Persistenz liegt in
// lib/appLimitsStore.ts, die Durchsetzung in ManagedSettings (Screen Time).
//
// Regeln:
//   dailySeconds  0 = kein Tageslimit
//   weeklySeconds 0 = kein Wochenlimit
//   pauseSeconds  Pflicht-Pause, die nach Erreichen des Limits greift
//   opensPerDay   0 = unbegrenzt (wie oft die App pro Tag aufgehen darf)
//   blocked       Dauer-Sperre (unabhängig von Limits)
//
// Jede Änderung an einer Regel wird erst nach der Wartezeit wirksam
// (Default 1 Tag, einstellbar). Das ist der Schutz gegen "future-you", der im
// Impuls hochdreht — dasselbe Muster wie Dulls 24-h-Filter-Delay.

/** Wartezeit-Stufen für Änderungen (Stunden). Default 24 h = 1 Tag. */
export const DELAY_PRESETS_H = [12, 24, 48] as const;
export const DEFAULT_DELAY_H = 24;
export const MIN_DELAY_H = 1;
export const MAX_DELAY_H = 72;

export type AppRuleValues = {
  dailySeconds: number;
  weeklySeconds: number;
  pauseSeconds: number;
  opensPerDay: number;
  blocked: boolean;
};

export type AppRule = AppRuleValues & {
  index: number; // Position im FamilyActivitySelection
  label: string; // "APP 3" (Apple gibt Namen außerhalb der Extension nicht heraus)
  pending: PendingAppChange | null;
};

export type PendingAppChange = { at: number; changes: Partial<AppRuleValues> };

export const MAX_DAILY_S = 24 * 3600;
export const MAX_WEEKLY_S = 7 * 24 * 3600;
export const MAX_PAUSE_S = 3600;
export const MAX_OPENS = 99;

/** Neutralwerte = "keine Regel": App bleibt frei. */
export const EMPTY_VALUES: AppRuleValues = {
  dailySeconds: 0,
  weeklySeconds: 0,
  pauseSeconds: 0,
  opensPerDay: 0,
  blocked: false,
};

const clampInt = (v: unknown, lo: number, hi: number, fallback = 0): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(Math.max(n, lo), hi);
};

export function delayMsFor(hours: number): number {
  return clampInt(hours, MIN_DELAY_H, MAX_DELAY_H, DEFAULT_DELAY_H) * 3600_000;
}

/** Regeln aus unbekannter Quelle (AsyncStorage) validieren. */
export function normalizeRule(raw: unknown, now = Date.now()): AppRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const index = typeof r.index === "number" ? Math.floor(r.index) : NaN;
  if (!Number.isFinite(index) || index < 0) return null;
  const pendingRaw = r.pending as Record<string, unknown> | null | undefined;
  let pending: PendingAppChange | null = null;
  if (pendingRaw && typeof pendingRaw === "object") {
    const at = typeof pendingRaw.at === "number" ? pendingRaw.at : NaN;
    const changes = pendingRaw.changes as Record<string, unknown> | undefined;
    if (Number.isFinite(at) && at > 0 && changes && typeof changes === "object") {
      pending = {
        // Manipulierte Zeitstempel dürfen die Wartezeit nicht verkürzen.
        at: Math.min(at, now + delayMsFor(MAX_DELAY_H)),
        changes: sanitizeChanges(changes),
      };
      if (Object.keys(pending.changes).length === 0) pending = null;
    }
  }
  return {
    index,
    label: typeof r.label === "string" && r.label ? r.label.slice(0, 24) : `APP ${index + 1}`,
    dailySeconds: clampInt(r.dailySeconds, 0, MAX_DAILY_S),
    weeklySeconds: clampInt(r.weeklySeconds, 0, MAX_WEEKLY_S),
    pauseSeconds: clampInt(r.pauseSeconds, 0, MAX_PAUSE_S),
    opensPerDay: clampInt(r.opensPerDay, 0, MAX_OPENS),
    blocked: r.blocked === true,
    pending,
  };
}

function sanitizeChanges(raw: Record<string, unknown>): Partial<AppRuleValues> {
  const out: Partial<AppRuleValues> = {};
  if ("dailySeconds" in raw) out.dailySeconds = clampInt(raw.dailySeconds, 0, MAX_DAILY_S);
  if ("weeklySeconds" in raw) out.weeklySeconds = clampInt(raw.weeklySeconds, 0, MAX_WEEKLY_S);
  if ("pauseSeconds" in raw) out.pauseSeconds = clampInt(raw.pauseSeconds, 0, MAX_PAUSE_S);
  if ("opensPerDay" in raw) out.opensPerDay = clampInt(raw.opensPerDay, 0, MAX_OPENS);
  if ("blocked" in raw) out.blocked = raw.blocked === true;
  return out;
}

/** Aktuell gültige Werte (ausstehende Änderungen noch nicht angewandt). */
export function effectiveValues(rule: AppRule): AppRuleValues {
  return {
    dailySeconds: rule.dailySeconds,
    weeklySeconds: rule.weeklySeconds,
    pauseSeconds: rule.pauseSeconds,
    opensPerDay: rule.opensPerDay,
    blocked: rule.blocked,
  };
}

export function hasRule(values: AppRuleValues): boolean {
  return (
    values.dailySeconds > 0 ||
    values.weeklySeconds > 0 ||
    values.pauseSeconds > 0 ||
    values.opensPerDay > 0 ||
    values.blocked
  );
}

/**
 * Änderung beantragen. Ein offener Antrag wird NICHT überschrieben — sonst
 * ließe sich eine Verschärfung durch einen laxeren Folgeantrag aushebeln.
 * Identische Werte erzeugen keinen Antrag.
 */
export function requestChange(
  rule: AppRule,
  changes: Partial<AppRuleValues>,
  now: number,
  delayHours = DEFAULT_DELAY_H,
): AppRule {
  if (rule.pending) return rule;
  const clean = sanitizeChanges(changes as Record<string, unknown>);
  const current = effectiveValues(rule);
  const diff: Partial<AppRuleValues> = {};
  for (const key of Object.keys(clean) as (keyof AppRuleValues)[]) {
    if (clean[key] !== current[key]) {
      (diff as Record<string, unknown>)[key] = clean[key];
    }
  }
  if (Object.keys(diff).length === 0) return rule;
  return { ...rule, pending: { at: now + delayMsFor(delayHours), changes: diff } };
}

/** Ausstehenden Antrag verwerfen (nur nach PIN-Bestätigung aufrufen). */
export function cancelPending(rule: AppRule): AppRule {
  return rule.pending ? { ...rule, pending: null } : rule;
}

/** Fälligen Antrag anwenden. Idempotent; ohne Antrag unverändert. */
export function applyPending(rule: AppRule, now: number): AppRule {
  if (!rule.pending) return rule;
  if (now < rule.pending.at) return rule;
  return { ...rule, ...rule.pending.changes, pending: null };
}

export function pendingRemainingMs(rule: AppRule, now: number): number {
  if (!rule.pending) return 0;
  return Math.max(0, rule.pending.at - now);
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} T ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** "30m", "1h 30m", "AUS" für 0. */
export function formatAmount(seconds: number): string {
  if (!(seconds > 0)) return "AUS";
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(seconds / 60)}m`;
}

/** Inhalt einer Regel-Zeile für die UI ("30m/d · 2h/w · Pause 5m · 3×/d"). */
export function describeRule(values: AppRuleValues): string {
  const parts: string[] = [];
  if (values.blocked) parts.push("GESPERRT");
  if (values.dailySeconds > 0) parts.push(`${formatAmount(values.dailySeconds)}/TAG`);
  if (values.weeklySeconds > 0) parts.push(`${formatAmount(values.weeklySeconds)}/WOCHE`);
  if (values.opensPerDay > 0) parts.push(`${values.opensPerDay}×/TAG`);
  if (values.pauseSeconds > 0) parts.push(`PAUSE ${formatAmount(values.pauseSeconds)}`);
  return parts.length ? parts.join(" · ") : "KEINE REGEL";
}

/**
 * Regeln für die Monitor-Extension: nur Apps mit echter Regel und ohne
 * ausstehende Änderung (was noch nicht gilt, darf nicht durchgesetzt werden).
 */
export function enforceableRules(rules: AppRule[]): { index: number; values: AppRuleValues }[] {
  return rules
    .filter((r) => !r.pending && hasRule(r))
    .map((r) => ({ index: r.index, values: effectiveValues(r) }));
}
