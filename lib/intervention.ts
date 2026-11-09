// Pure Intervention-Logik (one sec-Muster): bewusste Unterbrechung VOR dem Öffnen.
// Kern: Re-Intervention-Fenster — die Ziel-App darf X Minuten ohne erneute
// Intervention wieder geöffnet werden (der eigentliche Anti-Reels-Hebel).
// Kein I/O, kein React.

export type InterventionKind = "breathing" | "math" | "journal";

export const RE_INTERVENTION_WINDOW_MS = 10 * 60_000; // 10 min

export type InterventionState = {
  lastCompletedAt: number; // epoch ms; 0 = nie
  kind: InterventionKind;
};

export function emptyIntervention(): InterventionState {
  return { lastCompletedAt: 0, kind: "breathing" };
}

// Innerhalb des Fensters? Dann keine erneute Intervention nötig.
export function withinReInterventionWindow(s: InterventionState, now: number): boolean {
  return s.lastCompletedAt > 0 && now - s.lastCompletedAt < RE_INTERVENTION_WINDOW_MS;
}

export function windowRemaining(s: InterventionState, now: number): number {
  if (!s.lastCompletedAt) return 0;
  return Math.max(0, RE_INTERVENTION_WINDOW_MS - (now - s.lastCompletedAt));
}

export function recordIntervention(
  s: InterventionState,
  kind: InterventionKind,
  now: number,
): InterventionState {
  return { lastCompletedAt: now, kind };
}

// ── Mathe-Challenge (Addition) ────────────────────────────────────────────────
export type MathChallenge = { a: number; b: number; answer: number };

export function newMathChallenge(maxA = 20, maxB = 20): MathChallenge {
  const a = Math.floor(Math.random() * (maxA + 1));
  const b = Math.floor(Math.random() * (maxB + 1));
  return { a, b, answer: a + b };
}

export function checkMathAnswer(c: MathChallenge, answer: number): boolean {
  return c.answer === answer;
}

// ── Validierung aus unbekannter Quelle (AsyncStorage) ────────────────────────
export function normalizeIntervention(x: unknown): InterventionState | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const last =
    typeof r.lastCompletedAt === "number" && Number.isFinite(r.lastCompletedAt)
      ? Math.max(0, r.lastCompletedAt)
      : 0;
  const kind: InterventionKind =
    r.kind === "math" || r.kind === "journal" ? r.kind : "breathing";
  return { lastCompletedAt: last, kind };
}
