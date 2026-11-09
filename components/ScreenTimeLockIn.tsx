import { ScrollView, StyleSheet, Text, View } from "react-native";

// Nothing-Design-Palette (identisch zu App.tsx)
const C = {
  bg: "#000000", surface: "#141414", border: "#2a2a2a",
  text: "#ffffff", text2: "#8a8a8a", text3: "#5a5a5a", dot: "#ffffff",
};

const STEPS = [
  { t: "HANDY ABGEBEN", d: "Gib dein Handy einer Person, der du vertraust — Partner oder Freund, die dir den Code nicht gibt, wenn du fragst." },
  { t: "SCREEN-TIME-PASSCODE", d: "Sie setzt einen Screen-Time-Passcode: Einstellungen → Bildschirmzeit → Bildschirmzeit-Code sperren. Schau nicht hin." },
  { t: "EIGENES APPLE-KONTO", d: "Zur Wiederherstellung nutzt sie ihr eigenes Apple-Konto. Mit deinem könntest du den Code selbst zurücksetzen." },
];

// Screen-Time-Passcode Lock-In (Dull v1.9.4: "make it stick"). Erklärt, warum
// BlockPhone+ auf den Screen-Time-Zugriff angewiesen ist und wie man ihn gegen
// das eigene zukünftige Ich absichert.
export default function ScreenTimeLockIn() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>MAKE IT STICK</Text>
      <Text style={styles.hint}>
        Der Redirect läuft über deinen Screen-Time-Zugriff. iOS erlaubt dir, den in den
        Einstellungen auszuschalten — außer jemand anderes hält deinen Screen-Time-Passcode.
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
        Danach fragt das Abschalten des BlockPhone-Zugriffs nach IHREM Code.
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

