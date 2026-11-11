import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { DEFAULT_FILTER_CONFIG, type FilterConfig, type Platform } from "../lib/browser";
import { DEFAULT_LIMITS, formatRation, pendingRemainingMs } from "../lib/limits";
import {
  cancelPendingLimit,
  loadLimits,
  requestDailyLimit,
  requestWeeklyLimit,
  type LimitState,
} from "../lib/limitStore";
import { verifyPin } from "../lib/streakStore";
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
// Wochenbudget in Stunden (0 = kein Wochenlimit).
const WEEK_PRESETS = [0, 1, 2, 5, 10, 20];

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
  // PIN-Abfrage zum Verwerfen einer ausstehenden Limit-Änderung.
  const [pinFor, setPinFor] = useState<Platform | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  // Tick für den Countdown der 2-Tage-Wartezeit.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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

  // Tagesration ändern: wird erst nach 48 h wirksam (2-Tage-Wartezeit).
  async function apply(p: Platform, minutes: number) {
    if (locked) return;
    setBusy(p);
    try {
      setLimits(await requestDailyLimit(p, minutes * 60));
    } catch {
      /* ignorieren — UI bleibt auf altem Stand */
    } finally {
      setBusy(null);
    }
  }

  // Wochenbudget ändern: gleicher 48h-Mechanismus wie die Tagesration.
  async function applyWeek(p: Platform, hours: number) {
    if (locked) return;
    setBusy(p);
    try {
      setLimits(await requestWeeklyLimit(p, hours * 3600));
    } catch {
      /* ignorieren */
    } finally {
      setBusy(null);
    }
  }

  // Ausstehende Änderung verwerfen — nur mit PIN.
  async function confirmCancel() {
    if (!pinFor) return;
    try {
      const ok = await verifyPin(pinInput);
      if (!ok) {
        setPinError("Falscher PIN.");
        setPinInput("");
        return;
      }
      setLimits(await cancelPendingLimit(pinFor));
      setPinFor(null);
      setPinInput("");
      setPinError(null);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Verwerfen fehlgeschlagen.");
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
    <>
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
        const e = limits[key];
        const current = e?.limitSeconds ?? DEFAULT_LIMITS[key];
        const weekLimit = e?.weekLimitSeconds ?? 0;
        const weekUsed = e?.weekUsedSeconds ?? 0;
        const pendingLeft = e ? pendingRemainingMs(e, Date.now()) : 0;
        const pending = e?.pending ?? null;
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
                    disabled={busy === key || pending !== null}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {min === 0 ? "OFF" : min + "m"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {pending !== null ? (
              <View style={styles.pending}>
                <Text style={styles.pendingTitle}>
                  {[
                    pending.dailySeconds !== null
                      ? `TAG: ${pending.dailySeconds === 0 ? "OFF" : formatRation(pending.dailySeconds)}`
                      : null,
                    pending.weekSeconds !== null
                      ? `WOCHE: ${pending.weekSeconds === 0 ? "AUS" : formatRation(pending.weekSeconds)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  ANGEFORDERT
                </Text>
                <Text style={styles.pendingBody}>
                  Wird in {formatDurationMs(pendingLeft)} aktiv (2-Tage-Wartezeit).
                </Text>
                <Pressable
                  onPress={() => {
                    setPinFor(key);
                    setPinInput("");
                    setPinError(null);
                  }}
                  style={styles.pendingCancel}
                >
                  <Text style={styles.pendingCancelText}>MIT PIN VERWERFEN</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.weekRow}>
              <Text style={styles.weekLabel}>WOCHE</Text>
              <Text style={styles.weekValue}>
                {weekLimit === 0
                  ? "KEIN WOCHENLIMIT"
                  : `${formatRation(Math.max(0, weekLimit - weekUsed))} übrig / ${formatRation(weekLimit)}`}
              </Text>
            </View>
            <View style={styles.chips}>
              {WEEK_PRESETS.map((h) => {
                const active = weekLimit === h * 3600;
                return (
                  <Pressable
                    key={`w${h}`}
                    onPress={() => void applyWeek(key, h)}
                    disabled={busy === key || pending !== null}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {h === 0 ? "AUS" : h + "h"}
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

      {/* PIN-Abfrage: ausstehende Limit-Änderung verwerfen */}
      <Modal visible={pinFor !== null} transparent animationType="fade" onRequestClose={() => setPinFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>PIN ZUM VERWERFEN</Text>
            <Text style={styles.modalBody}>
              Die angeforderte Änderung wird gelöscht. Das aktuelle Limit bleibt.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={pinInput}
              onChangeText={(t) => {
                setPinInput(t.replace(/\D/g, "").slice(0, 4));
                setPinError(null);
              }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              placeholder="••••"
              placeholderTextColor={C.text3}
            />
            {pinError ? <Text style={styles.modalError}>⚠ {pinError}</Text> : null}
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setPinFor(null)} style={styles.modalBtnGhost}>
                <Text style={styles.modalBtnGhostText}>ZURÜCK</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmCancel()}
                disabled={pinInput.length !== 4}
                style={[styles.modalBtn, pinInput.length !== 4 && styles.modalBtnDisabled]}
              >
                <Text style={styles.modalBtnText}>VERWERFEN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  pending: {
    borderWidth: 1,
    borderColor: C.dot,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  pendingTitle: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text, letterSpacing: 1 },
  pendingBody: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text3, lineHeight: 15 },
  pendingCancel: { alignSelf: "flex-start", marginTop: 4 },
  pendingCancelText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.dot,
    letterSpacing: 1,
    textDecorationLine: "underline",
  },
  weekRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weekLabel: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text3, letterSpacing: 2 },
  weekValue: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text2, letterSpacing: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  modalTitle: { fontFamily: "Ndot57", fontSize: 15, color: C.text, letterSpacing: 2 },
  modalBody: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.text3, lineHeight: 17 },
  modalInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontFamily: "SpaceGrotesk",
    fontSize: 18,
    letterSpacing: 8,
    textAlign: "center",
  },
  modalError: { fontFamily: "SpaceGrotesk", fontSize: 11, color: "#ff5c6a" },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1,
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalBtnDisabled: { backgroundColor: C.border },
  modalBtnText: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.bg, letterSpacing: 2, fontWeight: "700" },
  modalBtnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalBtnGhostText: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.text2, letterSpacing: 2 },
});
