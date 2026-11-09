import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Breathing from "./Breathing";
import {
  checkMathAnswer,
  newMathChallenge,
  type InterventionKind,
  type MathChallenge,
} from "../lib/intervention";
import { recordIntervention } from "../lib/interventionStore";

// Nothing-Design-Palette (identisch zu App.tsx)
const C = {
  bg: "#000000",
  surface: "#141414",
  surface2: "#1f1f1f",
  border: "#2a2a2a",
  text: "#ffffff",
  text2: "#8a8a8a",
  text3: "#5a5a5a",
  dot: "#ffffff",
  dotOff: "#3a3a3a",
};

type Mode = "pick" | "breathing" | "math" | "journal";

/**
 * Intervention-Gate (one sec-Muster): bewusste Unterbrechung VOR dem Öffnen.
 * Drei Modi: Atmung (Box/4-7-8), Mathe-Challenge, Intentionstagebuch.
 * Nach Abschluss wird die Intervention gespeichert → Re-Intervention-Fenster.
 */
export default function InterventionGate({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("pick");
  const [challenge, setChallenge] = useState<MathChallenge>(() => newMathChallenge());
  const [answer, setAnswer] = useState("");
  const [journal, setJournal] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function finish(kind: InterventionKind) {
    await recordIntervention(kind);
    onDone();
  }

  function checkMath() {
    const n = parseInt(answer, 10);
    if (Number.isNaN(n)) {
      setError("Zahl eingeben.");
      return;
    }
    if (checkMathAnswer(challenge, n)) {
      setAnswer("");
      setError(null);
      void finish("math");
    } else {
      setError("Falsch — nochmal.");
      setAnswer("");
      setChallenge(newMathChallenge());
    }
  }

  if (mode === "breathing") {
    return (
      <Breathing
        cycles={2}
        onDone={() => void finish("breathing")}
        onSkip={() => void finish("breathing")}
      />
    );
  }

  if (mode === "math") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.brand}>MATHE</Text>
          <Text style={styles.title}>Bevor du öffnest:</Text>
          <Text style={styles.challenge}>
            {challenge.a} + {challenge.b} = ?
          </Text>
          <TextInput
            style={styles.input}
            value={answer}
            onChangeText={(t) => {
              setAnswer(t.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            onSubmitEditing={checkMath}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
          />
          {error ? <Text style={styles.error}>⚠ {error}</Text> : null}
          <Pressable onPress={checkMath} style={styles.btn}>
            <Text style={styles.btnText}>PRÜFEN</Text>
          </Pressable>
          <Pressable onPress={() => setMode("pick")} style={styles.link}>
            <Text style={styles.linkText}>ZURÜCK</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (mode === "journal") {
    return (
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.brand}>ABSICHT</Text>
          <Text style={styles.title}>Warum jetzt?</Text>
          <Text style={styles.subtitle}>Ist das Absicht — oder Autopilot?</Text>
          <TextInput
            style={[styles.input, styles.journalInput]}
            value={journal}
            onChangeText={setJournal}
            placeholder="Ich öffne das, weil …"
            placeholderTextColor={C.text3}
            multiline
            autoFocus
          />
          <Pressable
            onPress={() => void finish("journal")}
            disabled={journal.trim().length === 0}
            style={[styles.btn, journal.trim().length === 0 && styles.btnDisabled]}
          >
            <Text style={styles.btnText}>DAS IST ABSICHT</Text>
          </Pressable>
          <Pressable onPress={() => setMode("pick")} style={styles.link}>
            <Text style={styles.linkText}>ZURÜCK</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // mode === "pick"
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.center}>
        <Text style={styles.brand}>BLOCKPHONE</Text>
        <Text style={styles.title}>KURZE PAUSE</Text>
        <Text style={styles.subtitle}>
          Bevor du öffnest — wähle deine Unterbrechung.
        </Text>

        <Pressable style={styles.card} onPress={() => setMode("breathing")}>
          <Text style={styles.cardTitle}>ATMUNG</Text>
          <Text style={styles.cardBody}>Box- oder 4-7-8-Atmung · 2 Zyklen.</Text>
        </Pressable>
        <Pressable style={styles.card} onPress={() => setMode("math")}>
          <Text style={styles.cardTitle}>MATHE</Text>
          <Text style={styles.cardBody}>Eine kleine Rechenaufgabe.</Text>
        </Pressable>
        <Pressable style={styles.card} onPress={() => setMode("journal")}>
          <Text style={styles.cardTitle}>ABSICHT</Text>
          <Text style={styles.cardBody}>Warum jetzt? — kurz aufschreiben.</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  brand: {
    fontFamily: "Ndot57",
    fontSize: 26,
    color: C.text2,
    letterSpacing: 6,
    marginBottom: 4,
  },
  title: {
    fontFamily: "Ndot57",
    fontSize: 34,
    color: C.text,
    letterSpacing: 4,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 8,
  },
  challenge: {
    fontFamily: "Ndot57",
    fontSize: 56,
    color: C.dot,
    letterSpacing: 4,
    marginVertical: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    color: C.text,
    backgroundColor: C.surface,
    fontFamily: "SpaceGrotesk",
    textAlign: "center",
    minWidth: 180,
  },
  journalInput: {
    minWidth: 260,
    minHeight: 110,
    fontSize: 15,
    textAlign: "left",
    textAlignVertical: "top",
  },
  error: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: "#ff5c6a",
    lineHeight: 18,
  },
  btn: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingHorizontal: 40,
    paddingVertical: 14,
    marginTop: 6,
    minWidth: 200,
    alignItems: "center",
  },
  btnDisabled: { backgroundColor: C.surface2 },
  btnText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
  link: { marginTop: 4, padding: 8 },
  linkText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    letterSpacing: 2,
  },
  card: {
    width: "100%",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 18,
    gap: 4,
  },
  cardTitle: {
    fontFamily: "Ndot57",
    fontSize: 18,
    color: C.text,
    letterSpacing: 3,
  },
  cardBody: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    lineHeight: 18,
  },
});
