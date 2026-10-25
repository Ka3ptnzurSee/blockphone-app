import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { hasPin, setPin, verifyPin } from "../lib/streakStore";

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

type Phase = "loading" | "set" | "confirm" | "enter";

/**
 * 4-stelliger PIN-Gate + Streak-Einstieg ("DAYS ON YOUR TERMS").
 * Erster Start → PIN setzen (2× eingeben). Danach → PIN eingeben.
 * Bewusst ein Selbstkontroll-Nudge, kein Sicherheits-Schloss (wie Dull).
 */
export default function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    (async () => {
      const locked = await hasPin();
      setPhase(locked ? "enter" : "set");
    })();
  }, []);

  useEffect(() => {
    // Nach jedem Phasen-Wechsel Feld fokussieren (Keypad sofort bereit).
    if (phase !== "loading") inputRef.current?.focus();
  }, [phase]);

  function reset(showError?: string) {
    setPin("");
    setError(showError || null);
  }

  async function submit() {
    if (pin.length !== 4) return;
    if (phase === "set") {
      setFirstPin(pin);
      setPin("");
      setError(null);
      setPhase("confirm");
    } else if (phase === "confirm") {
      if (pin !== firstPin) {
        reset("PINs stimmen nicht überein — nochmal.");
        setPhase("set");
        return;
      }
      try {
        await setPin(pin);
        onUnlock();
      } catch (e) {
        reset(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      }
    } else if (phase === "enter") {
      const ok = await verifyPin(pin);
      if (ok) onUnlock();
      else reset("Falscher PIN — nochmal.");
    }
  }

  const title =
    phase === "set"
      ? "PIN SETZEN"
      : phase === "confirm"
      ? "PIN BESTÄTIGEN"
      : phase === "enter"
      ? "ENTSICHERN"
      : "…";

  const subtitle =
    phase === "set"
      ? "Vier Ziffern. Deine tägliche Reibung."
      : phase === "confirm"
      ? "Nochmal dieselben vier Ziffern."
      : phase === "enter"
      ? "DAYS ON YOUR TERMS."
      : "";

  if (phase === "loading") {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.dot} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.center}>
        <Text style={styles.brand}>BLOCKPHONE</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* PIN-Punkte */}
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i < pin.length ? C.dot : C.dotOff }]}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>⚠ {error}</Text> : null}

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={pin}
          onChangeText={(t) => {
            setPin(t.replace(/\D/g, "").slice(0, 4));
            setError(null);
          }}
          onSubmitEditing={submit}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
          autoFocus
          caretHidden
        />

        <Pressable
          onPress={submit}
          disabled={pin.length !== 4}
          style={[styles.btn, pin.length !== 4 && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>
            {phase === "confirm" ? "BESTÄTIGEN" : phase === "set" ? "WEITER" : "ÖFFNEN"}
          </Text>
        </Pressable>

        {phase === "set" ? (
          <Text style={styles.hint}>Nudge, kein Schloss — der PIN ist für dich, nicht gegen dich.</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  brand: {
    fontFamily: "Ndot57",
    fontSize: 26,
    color: C.text2,
    letterSpacing: 6,
    marginBottom: 8,
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
  dots: { flexDirection: "row", gap: 20, marginVertical: 18 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  error: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: "#ff5c6a",
    lineHeight: 18,
    textAlign: "center",
  },
  input: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  btn: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingHorizontal: 48,
    paddingVertical: 14,
    marginTop: 12,
    minWidth: 160,
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
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 16,
  },
});
