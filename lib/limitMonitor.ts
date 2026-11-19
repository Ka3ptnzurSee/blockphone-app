// lib/limitMonitor.ts — Übersetzung der Pro-App-Regeln in das, was die
// DeviceActivity-Monitor-Extension braucht.
//
// Warum es diese Datei gibt: Die Extension bekommt von iOS nur ein *Event* mit
// Namen und Zeitfenster („Schwelle erreicht"). Sie kennt weder die App-Namen
// noch die Regeln — die müssen über die App Group mitkommen. Damit die
// Erwartung an die Extension testbar ist (und nicht nur in Swift-Land lebt),
// wird der Payload hier gebaut und geprüft.
//
// Vertrag mit Swift (`ScreenTimeShieldModule.startLimits` /
// `DeviceActivityMonitorExtension`):
//   [{ "index": 0, "dailySeconds": 1800, "weeklySeconds": 0 }]
//   * index = Position im FamilyActivitySelection — Swift sortiert die Tokens
//     dazu stabil (`orderedAppTokens`), weil die Set-Iteration prozessabhängig
//     ist (sonst zeigt derselbe Index nach einem Neustart auf eine andere App)
//   * fehlende/0-Werte = kein Limit → kein Event
//   * Schwellen < MIN_THRESHOLD_S werden verworfen: iOS feuert sonst beim
//     ersten Sekundenbruchteil und die Sperre käme einer Dauer-Sperre gleich.

import type { AppRule } from "./appLimits";

/** Kleinste sinnvolle Schwelle (Sekunden). */
export const MIN_THRESHOLD_S = 60;

export type MonitorRule = {
  index: number;
  dailySeconds: number;
  weeklySeconds: number;
};

/** Minuten-Presets der UI liegen teils unter einer Minute → hier geklemmt. */
function clampThreshold(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const s = Math.floor(seconds);
  return s < MIN_THRESHOLD_S ? 0 : s;
}

/**
 * Aus den sichtbaren Regeln den Monitor-Payload bauen.
 *
 * - ausstehende Änderungen (`pending`) zählen nicht (erst nach Wartezeit)
 * - `blocked` braucht kein Limit: das ist eine Dauer-Sperre über ManagedSettings
 * - Regeln ohne Schwelle fallen raus (sonst startet die Extension leere Events)
 */
export function buildMonitorRules(rules: AppRule[]): MonitorRule[] {
  const out: MonitorRule[] = [];
  for (const r of rules) {
    if (r.pending) continue;
    if (r.blocked) continue;
    const dailySeconds = clampThreshold(r.dailySeconds);
    const weeklySeconds = clampThreshold(r.weeklySeconds);
    if (dailySeconds === 0 && weeklySeconds === 0) continue;
    out.push({ index: r.index, dailySeconds, weeklySeconds });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Antwort von `ScreenTimeShield.startLimits(...)` (nur die geprüften Felder). */
export type LimitsResult = {
  monitoring?: string;
  started?: string[];
  errors?: string[];
  group?: boolean;
};

/** JSON für `ScreenTimeShield.startLimits(...)`. */
export function buildMonitorPayload(rules: AppRule[]): string {
  return JSON.stringify(buildMonitorRules(rules));
}

/** true, wenn es überhaupt etwas zu überwachen gibt. */
export function hasMonitorRules(rules: AppRule[]): boolean {
  return buildMonitorRules(rules).length > 0;
}

/**
 * Klartext-Grund, warum die Limits NICHT laufen — `null`, wenn alles steht.
 *
 * Vorher wurde das Ergebnis von `startMonitoring` ignoriert: die UI zeigte
 * „Limit aktiv", obwohl iOS das Zeitfenster abgelehnt hatte und nie ein Event
 * feuerte. Diese Funktion macht daraus eine sichtbare Meldung.
 */
export function limitsStartProblem(res: LimitsResult | null | undefined): string | null {
  if (!res) return "Sperr-Modul antwortet nicht (Limits nicht registriert).";
  if (res.monitoring === "on") return null;
  if (res.monitoring === "no_selection") {
    return "Keine App-Auswahl — Limits können nicht greifen.";
  }
  const err = (res.errors ?? []).filter((e) => e && e.length > 0).join("; ");
  return err ? `Limits nicht aktiv: ${err}` : "Limits nicht aktiv (iOS hat das Zeitfenster abgelehnt).";
}
