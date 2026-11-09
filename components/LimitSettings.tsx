import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { DEFAULT_FILTER_CONFIG, type FilterConfig, type Platform } from "../lib/browser";
import { DEFAULT_LIMITS, formatRation } from "../lib/limits";
import { loadLimits, setDailyLimit, type LimitState } from "../lib/limitStore";
import { loadFilterConfig, saveFilterConfig } from "../lib/filterStore";
import { loadSettingsLock } from "../lib/commitmentStore";
import { formatDurationMs, type SettingsLockInfo } from "../lib/commitment";

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

// Welche Feed-Bestandteile je Plattform schaltbar sind (true = blockieren).
const FILTER_KEYS: Record<Platform, { key: keyof FilterConfig; label: string }[]> = {
  youtube: [
    { key: "shorts", label: "SHORTS" },
    { key: "watchRecommendations", label: "EMPFEHLUNGEN AUF WATCH" },
    { key: "bottomNav", label: "UNTERE NAVIGATION" },
    { key: "ads", label: "WERBUNG" },
    { key: "subscriptionsLockdown", label: "ABO-FEED OHNE EMPFEHLUNGEN" },
    { key: "ytBackground", label: "AUDIO IM HINTERGRUND (KOMPORT)" },
  ],
  instagram: [
    { key: "reels", label: "REELS" },
    { key: "suggested", label: "VORGESCHLAGEN" },
    { key: "friendsOnly", label: "NUR FOLLOWING" },
    { key: "stories", label: "STORY-LEISTE" },
    { key: "forYou", label: "FOR-YOU-TAB" },
    { key: "explore", label: "EXPLORE" },
    { key: "messagesOnly", label: "NUR NACHRICHTEN" },
  ],
  facebook: [
    { key: "reels", label: "REELS" },
    { key: "suggested", label: "VORGESCHLAGEN" },
    { key: "feedsOnly", label: "NUR FOLLOW-FEED" },
    { key: "feedVideoHomeRedirect", label: "VIDEO-LINKS AUF HOME" },
  ],
  x: [
    { key: "grok", label: "GROK" },
    { key: "trending", label: "TRENDS" },
    { key: "suggestions", label: "WEM FOLGEN" },
    { key: "premium", label: "PREMIUM-WERBUNG" },
  ],
  reddit: [
    { key: "popular", label: "POPULAR / ALL" },
    { key: "ads", label: "WERBUNG" },
  ],
};

export default function LimitSettings() {
  const [limits, setLimits] = useState<LimitState | null>(null);
  const [busy, setBusy] = useState<Platform | null>(null);
  const [filterCfg, setFilterCfg] = useState<FilterConfig>(DEFAULT_FILTER_CONFIG);
  const [filterPlatform, setFilterPlatform] = useState<Platform>("youtube");
  const [lock, setLock] = useState<SettingsLockInfo>({
    locked: false,
    since: 0,
    recoveryLeftMs: 0,
    canRecoverNow: false,
  });

  useEffect(() => {
    (async () => {
      const [st, fc, lk] = await Promise.all([loadLimits(), loadFilterConfig(), loadSettingsLock()]);
      setLimits(st);
      setFilterCfg(fc);
      setLock(lk);
    })();
  }, []);

  // Harte Sperre: Änderungen sind gesperrt (Umgehungsschutz). Aufheben nur
  // über MEHR → COMMIT (PIN oder 48h-Recovery).
  const locked = lock.locked;

  async function toggleFilter(key: keyof FilterConfig) {
    if (locked) return;
    const next: FilterConfig = { ...filterCfg, [key]: !filterCfg[key] };
    setFilterCfg(next);
    setFilterCfg(await saveFilterConfig(next));
  }

  async function apply(p: Platform, minutes: number) {
    if (locked) return;
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
      {locked ? (
        <View style={styles.lockBanner}>
          <Text style={styles.lockTitle}>EINSTELLUNGEN GESPERRT</Text>
          <Text style={styles.lockBody}>
            {lock.canRecoverNow
              ? "Recovery abgelaufen — Freigabe jetzt in MEHR → COMMIT möglich."
              : `Änderungen gesperrt. Recovery in ${formatDurationMs(lock.recoveryLeftMs)} (MEHR → COMMIT).`}
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>TAGESLIMIT JE APP</Text>
      <Text style={styles.hint}>
        Nach Ablauf des Limits ist die Plattform bis Mitternacht gesperrt — Freischaltung nur
        noch über eine Atem-Intervention.
      </Text>

      {PLATFORMS.map(({ key, label }) => {
        const current = limits[key]?.limitSeconds ?? DEFAULT_LIMITS[key];
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

      <Text style={[styles.sectionLabel, styles.spacer]}>FEED-FILTER</Text>
      <Text style={styles.hint}>
        Was im eingebauten Browser ausgeblendet wird. Gesperrt (weiß) = wird entfernt. Die Filter
        greifen beim Laden der Seite.
      </Text>

      <View style={styles.chips}>
        {PLATFORMS.map(({ key, label }) => {
          const active = filterPlatform === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilterPlatform(key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.card}>
        {FILTER_KEYS[filterPlatform].map(({ key, label }) => {
          const on = filterCfg[key] === true;
          return (
            <Pressable key={String(key)} onPress={() => void toggleFilter(key)} style={styles.row}>
              <View style={[styles.checkbox, on && styles.checkboxOn]}>
                {on ? <View style={styles.checkDot} /> : null}
              </View>
              <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
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
  spacer: { marginTop: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: C.dot, borderColor: C.dot },
  checkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.bg },
  rowLabel: {
    flex: 1,
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 1,
  },
  rowLabelOn: { color: C.text },
  lockBanner: {
    borderWidth: 1,
    borderColor: C.dot,
    borderRadius: 12,
    padding: 14,
    gap: 4,
    marginBottom: 6,
  },
  lockTitle: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.text, letterSpacing: 2 },
  lockBody: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text3, lineHeight: 16 },
});
