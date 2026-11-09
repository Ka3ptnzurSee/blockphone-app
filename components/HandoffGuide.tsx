import { ScrollView, StyleSheet, Text, View } from "react-native";

const C = {
  bg: "#000000", surface: "#141414", border: "#2a2a2a",
  text: "#ffffff", text2: "#8a8a8a", text3: "#5a5a5a", dot: "#ffffff",
};

const STEPS = [
  { t: "BLOCKIERTE APP ANTIPPEN", d: "Öffne eine gesperrte App. Statt der App siehst du BlockPhones Schild-Bildschirm." },
  { t: "„ZU BLOCKPHONE SCHICKEN“", d: "Der Bildschirm dimmt sich und du bekommst eine Benachrichtigung. Tippe auf „zu BlockPhone schicken“." },
  { t: "BENACHRICHTIGUNG ANTIPPEN", d: "Die Benachrichtigung bringt dich in BlockPhones gefilterte Version der App — Feed weg, Kernfunktionen bleiben." },
];

// Hard-Block Handoff (Dull v1.9.4): der Schild-Bildschirm leitet in die
// gefilterte Browser-Version um, statt die App einfach nur zu sperren.
export default function HandoffGuide() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>HARD-BLOCK HANDOFF</Text>
      <Text style={styles.hint}>
        Du musst die App nicht komplett löschen: Der Schild schickt dich in die
        entschärfte Version — Posten, Nachrichten, Freunde bleiben, der Feed ist weg.
      </Text>
      {STEPS.map((s, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.numWrap}>
            <Text style={styles.num}>{i + 1}</Text>
          </View>
          <Text style={styles.stepTitle}>{s.t}</Text>
          <Text style={styles.stepBody}>{s.d}</Text>
        </View>
      ))}
      <Text style={styles.foot}>
        Voraussetzung: FamilyControls-/Screen-Time-Freigabe (Apple-Antrag läuft).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 12 },
  sectionLabel: { fontFamily: "Ndot57", fontSize: 16, color: C.text2, letterSpacing: 3, marginBottom: 4 },
  hint: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.text3, letterSpacing: 1, lineHeight: 18 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, gap: 8 },
  numWrap: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: C.dot, alignItems: "center", justifyContent: "center" },
  num: { fontFamily: "Ndot57", fontSize: 12, color: C.dot },
  stepTitle: { fontFamily: "Ndot57", fontSize: 15, color: C.text, letterSpacing: 2 },
  stepBody: { fontFamily: "SpaceGrotesk", fontSize: 13, color: C.text2, lineHeight: 19 },
  foot: { fontFamily: "SpaceGrotesk", fontSize: 12, color: C.text3, letterSpacing: 1, lineHeight: 18, marginTop: 4 },
});

