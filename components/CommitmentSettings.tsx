import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "../lib/browser";
import {
  disableRemaining,
  formatDurationMs,
  isFilterLocked,
  LOCK_PRESETS_DAYS,
  recoveryRemaining,
  type CommitmentState,
} from "../lib/commitment";
import {
  cancelDisable,
  cancelRecovery,
  loadCommitment,
  lockFilter,
  requestDisable,
  startRecovery,
} from "../lib/commitmentStore";

// Nothing-Design-Palette (identisch zu App.tsx)
const C = {
  bg: "#000000",
  surface: "#141414",
  border: "#2a2a2a",
  text: "#ffffff",
  text2: "#8a8a8a",
  text3: "#5a5a5a",
  dot: "#ffffff",
  dotOff: "#3a3a3a",
};

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "youtube", label: "YOUTUBE" },
  { key: "instagram", label: "INSTAGRAM" },
  { key: "facebook", label: "FACEBOOK" },
  { key: "x", label: "X" },
  { key: "reddit", label: "REDDIT" },
];

/**
 * Commitment (Dull-Muster): Anti-Undo-Werkzeuge gegen "future-you".
 * 1) 48h-PIN-Recovery · 2) 24h-Filter-Delay · 3) Filter-Sperrdauer ("hold to lock").
 */
export default function CommitmentSettings() {
  const [state, setState] = useState<CommitmentState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    (async () => setState(await loadCommitment()))();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function act(key: string, fn: () => Promise<CommitmentState>) {
    setBusy(key);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.dot} />
      </View>
    );
  }

  const recRemaining = recoveryRemaining(state, now);
  const recActive = state.recoveryStartedAt > 0 && recRemaining > 0;
  const disRemaining = disableRemaining(state, now);
  const disActive = state.pendingDisableAt > 0 && disRemaining > 0;

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <Text style={styles.sectionLabel}>COMMITMENT</Text>
      <Text style={styles.hint}>
        Sperren für dein zukünftiges Ich — Abschalten wird absichtlich schwer gemacht.
      </Text>
      {error ? <Text style={styles.error}>⚠ {error}</Text> : null}

      {/* 48h-PIN-Recovery */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>PIN-RECOVERY (48H)</Text>
        <Text style={styles.cardBody}>
          PIN vergessen? Starte einen 48h-Warteprozess — erst danach ist die App wieder
          entsperrbar.
        </Text>
        {recActive ? (
          <Text style={styles.countdown}>entsperrt in {formatDurationMs(recRemaining)}</Text>
        ) : null}
        {recActive ? (
          <Pressable
            onPress={() => void act("rec-cancel", cancelRecovery)}
            disabled={busy !== null}
            style={styles.btnOutline}
          >
            <Text style={styles.btnOutlineText}>ABBRECHEN</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void act("rec-start", startRecovery)}
            disabled={busy !== null}
            style={styles.btn}
          >
            {busy === "rec-start" ? (
              <ActivityIndicator size="small" color={C.bg} />
            ) : (
              <Text style={styles.btnText}>48H STARTEN</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* 24h-Filter-Delay */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>24H-FILTER-DELAY</Text>
        <Text style={styles.cardBody}>
          Blocking ausschalten dauert 24 Stunden. Wieder-Anschalten bricht den Countdown ab.
        </Text>
        {disActive ? (
          <Text style={styles.countdown}>deaktiviert in {formatDurationMs(disRemaining)}</Text>
        ) : null}
        {disActive ? (
          <Pressable
            onPress={() => void act("delay-cancel", cancelDisable)}
            disabled={busy !== null}
            style={styles.btnOutline}
          >
            <Text style={styles.btnOutlineText}>ABBRECHEN (WIEDER AN)</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void act("delay-start", requestDisable)}
            disabled={busy !== null}
            style={styles.btn}
          >
            {busy === "delay-start" ? (
              <ActivityIndicator size="small" color={C.bg} />
            ) : (
              <Text style={styles.btnText}>DEAKTIVIERUNG ARMEREN</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Filter-Sperrdauer */}
      <Text style={styles.sectionLabel}>FILTER-SPERRE</Text>
      <Text style={styles.hint}>Plattform für X Tage festsperren — „hold to lock".</Text>
      {PLATFORMS.map(({ key, label }) => {
        const locked = isFilterLocked(state, key, now);
        return (
          <View key={key} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.platform}>{label}</Text>
              {locked ? (
                <Text style={styles.countdown}>
                  gesperrt {formatDurationMs(state.filterLockedUntil[key] - now)}
                </Text>
              ) : (
                <Text style={styles.platformState}>offen</Text>
              )}
            </View>
            <View style={styles.chips}>
              {LOCK_PRESETS_DAYS.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => void act(`lock-${key}`, () => lockFilter(key, d))}
                  disabled={busy !== null}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{d}T</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: C.bg },
  listContent: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  sectionLabel: {
    fontFamily: "Ndot57",
    fontSize: 16,
    color: C.text2,
    letterSpacing: 3,
    marginBottom: 4,
  },
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 1,
    lineHeight: 18,
    marginBottom: 4,
  },
  error: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: "#ff5c6a",
    lineHeight: 18,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: {
    fontFamily: "Ndot57",
    fontSize: 16,
    color: C.text,
    letterSpacing: 2,
  },
  cardBody: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    lineHeight: 18,
  },
  platform: {
    fontFamily: "SpaceGrotesk",
    fontSize: 15,
    color: C.text,
    letterSpacing: 1,
  },
  platformState: {
    fontFamily: "Ndot",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 1,
  },
  countdown: {
    fontFamily: "Ndot",
    fontSize: 13,
    color: C.dot,
    letterSpacing: 1,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    letterSpacing: 1,
  },
  btn: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: C.text2,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnOutlineText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.text,
    letterSpacing: 2,
  },
});
