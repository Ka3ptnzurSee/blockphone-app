import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { convexConfigured, loadLeaderboard } from "../lib/convexClient";
import { sortLeaderboard, type LeaderboardEntry } from "../lib/leaderboard";

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

/**
 * FRIENDS / RANGLISTE (Dull: Streak-Ranking über Convex).
 * Zeigt das sortierte Leaderboard; ohne EXPO_PUBLIC_CONVEX_URL leer/„nicht konfiguriert".
 */
export default function Leaderboard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setEntries(sortLeaderboard(await loadLeaderboard()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const ok = convexConfigured();
    setReady(ok);
    if (ok) void refresh();
  }, []);

  if (ready === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.dot} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>RANGLISTE</Text>
      {!ready ? (
        <Text style={styles.body}>Nicht konfiguriert — EXPO_PUBLIC_CONVEX_URL fehlt.</Text>
      ) : (
        <>
          {error ? <Text style={styles.error}>⚠ {error}</Text> : null}
          {entries.length === 0 ? (
            <Text style={styles.body}>Noch keine Einträge.</Text>
          ) : (
            entries.map((e, i) => (
              <View key={e.userId} style={[styles.row, i === 0 && styles.rowTop]}>
                <Text style={[styles.rank, i === 0 && styles.rankTop]}>#{i + 1}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={styles.streak}>
                  {e.streakDays} TAGE · {e.weekActiveDays}/7
                </Text>
              </View>
            ))
          )}
          <Pressable onPress={() => void refresh()} style={styles.btnGhost}>
            <Text style={styles.btnGhostText}>AKTUALISIEREN</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  title: { color: C.text, fontSize: 16, fontWeight: "700", letterSpacing: 2 },
  body: { color: C.text2, fontSize: 13, lineHeight: 19 },
  error: { color: "#ff6b6b", fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowTop: { borderColor: C.dot },
  rank: { color: C.text3, fontSize: 13, fontWeight: "700", width: 34 },
  rankTop: { color: C.dot },
  name: { flex: 1, color: C.text, fontSize: 14, fontWeight: "600" },
  streak: { color: C.text2, fontSize: 12 },
  btnGhost: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 4,
  },
  btnGhostText: { color: C.text2, fontSize: 13, fontWeight: "600", letterSpacing: 1 },
});

