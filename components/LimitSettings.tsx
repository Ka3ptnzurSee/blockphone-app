import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "../lib/browser";
import { formatRation } from "../lib/limits";
import { loadLimits, setDailyLimit, type LimitState } from "../lib/limitStore";

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

// Presets in Minuten (Tagesration). Off = 0 (immer gesperrt).
const PRESETS = [0, 10, 20, 30, 60, 120];

export default function LimitSettings() {
  const [limits, setLimits] = useState<LimitState | null>(null);
  const [busy, setBusy] = useState<Platform | null>(null);

  useEffect(() => {
    (async () => setLimits(await loadLimits()))();
  }, []);

  async function apply(p: Platform, minutes: number) {
    setBusy(p);
    try {
      setLimits(await setDailyLimit(p, minutes * 60));
    } catch {
      /* ignorieren — UI bleibt auf altem Stand */
    } finally {
      setBusy(null);
    }
  }

  if (!limits) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.dot} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <Text style={styles.sectionLabel}>TAGESLIMIT JE APP</Text>
      <Text style={styles.hint}>
        Nach Ablauf des Limits ist die Plattform bis Mitternacht gesperrt — Freischaltung nur
        noch über eine Atem-Intervention.
      </Text>

      {PLATFORMS.map(({ key, label }) => {
        const current = limits[key]?.limitSeconds ?? 0;
        return (
          <View key={key} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.platform}>{label}</Text>
              <Text style={styles.current}>
                {current === 0 ? "OFF" : formatRation(current) + " / TAG"}
              </Text>
            </View>
            <View style={styles.chips}>
              {PRESETS.map((min) => {
                const active = current === min * 60;
                return (
                  <Pressable
                    key={min}
                    onPress={() => void apply(key, min)}
                    disabled={busy === key}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {min === 0 ? "OFF" : min + "m"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
    marginBottom: 6,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  platform: {
    fontFamily: "SpaceGrotesk",
    fontSize: 15,
    color: C.text,
    letterSpacing: 1,
  },
  current: {
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
  chipActive: { borderColor: C.dot, backgroundColor: C.dot },
  chipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    letterSpacing: 1,
  },
  chipTextActive: { color: C.bg, fontWeight: "700" },
});
