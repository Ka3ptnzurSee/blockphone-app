import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatMinutes, type PostingQuota, type QuietHours, type SessionSettings } from "../lib/schedule";
import {
  loadPosting,
  loadQuietHours,
  savePosting,
  saveQuietHours,
} from "../lib/scheduleStore";
import { loadSessionSettings, saveSessionSettings } from "../lib/sessionStore";
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

const START_PRESETS = [20 * 60, 21 * 60, 22 * 60, 23 * 60];
const END_PRESETS = [5 * 60, 6 * 60, 7 * 60, 8 * 60];
const TIMES_PRESETS = [1, 2, 3, 5, 10];
const DURATION_PRESETS = [5, 10, 15, 30];
const COOLDOWN_PRESETS = [0, 5, 10, 15, 30];
const SESSION_PRESETS = [0, 15, 30, 45, 60];

/**
 * Zeitfenster (Dull/SocialLite-Muster): Quiet Hours (tägliches Sperrfenster)
 * + Posting Mode (Scheduled Access, X Fenster/Tag à Y Minuten).
 */
export default function ScheduleSettings() {
  const [lock, setLock] = useState<SettingsLockInfo | null>(null);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [posting, setPosting] = useState<PostingQuota | null>(null);
  const [session, setSession] = useState<SessionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [q, p, s, lk] = await Promise.all([
        loadQuietHours(),
        loadPosting(),
        loadSessionSettings(),
        loadSettingsLock(),
      ]);
      setQuiet(q);
      setPosting(p);
      setSession(s);
      setLock(lk);
    })();
  }, []);

  // Harte Sperre: Zeitsperren dürfen nicht umkonfiguriert werden, solange die
  // Einstellungen gesperrt sind (sonst wäre die Zeitsperre wirkungslos).
  const locked = lock?.locked === true;

  async function updateQuiet(next: QuietHours) {
    if (locked) return;
    setQuiet(next);
    setError(null);
    try {
      setQuiet(await saveQuietHours(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function updatePosting(next: PostingQuota) {
    if (locked) return;
    setPosting(next);
    setError(null);
    try {
      setPosting(await savePosting(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function updateSession(next: SessionSettings) {
    if (locked) return;
    setSession(next);
    setError(null);
    try {
      setSession(await saveSessionSettings(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!quiet || !posting || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.dot} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {locked && lock ? (
        <View style={styles.lockBanner}>
          <Text style={styles.lockTitle}>EINSTELLUNGEN GESPERRT</Text>
          <Text style={styles.lockBody}>
            {lock.canRecoverNow
              ? "Recovery abgelaufen — Freigabe jetzt in MEHR → COMMIT möglich."
              : `Zeitfenster gesperrt. Recovery in ${formatDurationMs(lock.recoveryLeftMs)} (MEHR → COMMIT).`}
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>ZEITFENSTER</Text>
      <Text style={styles.hint}>
        Quiet Hours sperren automatisch; Posting Mode öffnet ein kurzes Fenster zum Posten.
      </Text>
      {error ? <Text style={styles.error}>⚠ {error}</Text> : null}

      {/* Quiet Hours */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>QUIET HOURS</Text>
          <Pressable
            onPress={() => void updateQuiet({ ...quiet, enabled: !quiet.enabled })}
            style={[styles.switch, quiet.enabled && styles.switchOn]}
          >
            <Text style={[styles.switchText, quiet.enabled && styles.switchTextOn]}>
              {quiet.enabled ? "AN" : "AUS"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.cardBody}>
          Tägliches Sperrfenster — z. B. abends ab {formatMinutes(quiet.startMin)} bis morgens{" "}
          {formatMinutes(quiet.endMin)}.
        </Text>
        <Text style={styles.fieldLabel}>AB</Text>
        <View style={styles.chips}>
          {START_PRESETS.map((m) => (
            <Pressable
              key={m}
              onPress={() => void updateQuiet({ ...quiet, startMin: m })}
              style={[styles.chip, quiet.startMin === m && styles.chipActive]}
            >
              <Text style={[styles.chipText, quiet.startMin === m && styles.chipTextActive]}>
                {formatMinutes(m)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.fieldLabel}>BIS</Text>
        <View style={styles.chips}>
          {END_PRESETS.map((m) => (
            <Pressable
              key={m}
              onPress={() => void updateQuiet({ ...quiet, endMin: m })}
              style={[styles.chip, quiet.endMin === m && styles.chipActive]}
            >
              <Text style={[styles.chipText, quiet.endMin === m && styles.chipTextActive]}>
                {formatMinutes(m)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Posting Mode */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>POSTING MODE</Text>
        <Text style={styles.cardBody}>
          Öffnet eine gesperrte App für {posting.durationMin} min zum Posten —{" "}
          {posting.timesPerDay}× pro Tag.
        </Text>
        <Text style={styles.fieldLabel}>MAL PRO TAG</Text>
        <View style={styles.chips}>
          {TIMES_PRESETS.map((n) => (
            <Pressable
              key={n}
              onPress={() => void updatePosting({ ...posting, timesPerDay: n })}
              style={[styles.chip, posting.timesPerDay === n && styles.chipActive]}
            >
              <Text style={[styles.chipText, posting.timesPerDay === n && styles.chipTextActive]}>
                {n}×
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.fieldLabel}>DAUER (MIN)</Text>
        <View style={styles.chips}>
          {DURATION_PRESETS.map((n) => (
            <Pressable
              key={n}
              onPress={() => void updatePosting({ ...posting, durationMin: n })}
              style={[styles.chip, posting.durationMin === n && styles.chipActive]}
            >
              <Text style={[styles.chipText, posting.durationMin === n && styles.chipTextActive]}>
                {n}m
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Cooldown */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>COOLDOWN</Text>
        <Text style={styles.cardBody}>
          Nach einer Entsperrung musst du diese Zeit warten, bevor du erneut entsperren kannst — gegen Binge-Entsperren.
        </Text>
        <Text style={styles.fieldLabel}>WARTEZEIT (MIN · 0 = AUS)</Text>
        <View style={styles.chips}>
          {COOLDOWN_PRESETS.map((n) => (
            <Pressable
              key={n}
              onPress={() => void updateSession({ ...session, cooldownMin: n })}
              style={[styles.chip, session.cooldownMin === n && styles.chipActive]}
            >
              <Text style={[styles.chipText, session.cooldownMin === n && styles.chipTextActive]}>
                {n === 0 ? "AUS" : n + "m"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Session-Timer */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>SESSION-TIMER</Text>
        <Text style={styles.cardBody}>
          Maximale Dauer einer Sitzung — danach sperrt die App automatisch wieder.
        </Text>
        <Text style={styles.fieldLabel}>MAX. DAUER (MIN · 0 = AUS)</Text>
        <View style={styles.chips}>
          {SESSION_PRESETS.map((n) => (
            <Pressable
              key={n}
              onPress={() => void updateSession({ ...session, sessionLimitMin: n })}
              style={[styles.chip, session.sessionLimitMin === n && styles.chipActive]}
            >
              <Text style={[styles.chipText, session.sessionLimitMin === n && styles.chipTextActive]}>
                {n === 0 ? "AUS" : n + "m"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
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
  fieldLabel: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 2,
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
  switch: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  switchOn: { borderColor: C.dot, backgroundColor: C.dot },
  switchText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 1,
  },
  switchTextOn: { color: C.bg, fontWeight: "700" },
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
