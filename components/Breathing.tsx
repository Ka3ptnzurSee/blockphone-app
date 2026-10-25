import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

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

export type BreathingPattern = "box" | "478";

type Phase = { label: string; seconds: number; scale: number };

// one sec-Atemmuster: Box 4-4-4-4 und 4-7-8 (Welle vereinfacht auf 4-7-8).
const PATTERNS: Record<BreathingPattern, Phase[]> = {
  box: [
    { label: "EINATMEN", seconds: 4, scale: 1.3 },
    { label: "HALTEN", seconds: 4, scale: 1.3 },
    { label: "AUSATMEN", seconds: 4, scale: 1 },
    { label: "HALTEN", seconds: 4, scale: 1 },
  ],
  "478": [
    { label: "EINATMEN", seconds: 4, scale: 1.3 },
    { label: "HALTEN", seconds: 7, scale: 1.3 },
    { label: "AUSATMEN", seconds: 8, scale: 1 },
  ],
};

export default function Breathing({
  pattern = "478",
  cycles = 3,
  onDone,
  onSkip,
}: {
  pattern?: BreathingPattern;
  cycles?: number;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const phases = PATTERNS[pattern];
  const totalSteps = phases.length * cycles;
  const [step, setStep] = useState(0);
  const scale = useRef(new Animated.Value(1)).current;

  const phase = phases[Math.min(step, totalSteps - 1) % phases.length];
  const cycleNumber = Math.min(Math.floor(step / phases.length) + 1, cycles);

  // Kreis auf die Zielgröße der aktuellen Phase animieren.
  useEffect(() => {
    Animated.timing(scale, {
      toValue: phase.scale,
      duration: phase.seconds * 1000,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Phase-Schritt + Abschluss nach allen Zyklen.
  useEffect(() => {
    if (step >= totalSteps) {
      onDone();
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), phase.seconds * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>ATMUNG</Text>
      <Text style={styles.phase}>{phase.label}</Text>

      <View style={styles.stage}>
        <Animated.View style={[styles.circle, { transform: [{ scale }] }]} />
      </View>

      <Text style={styles.meta}>
        {cycleNumber}/{cycles} · {phase.seconds}s
      </Text>

      <Pressable onPress={onSkip || onDone} style={styles.skip}>
        <Text style={styles.skipText}>ÜBERSPRINGEN</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  brand: {
    fontFamily: "Ndot57",
    fontSize: 22,
    color: C.text2,
    letterSpacing: 6,
    marginBottom: 4,
  },
  phase: {
    fontFamily: "Ndot57",
    fontSize: 40,
    color: C.text,
    letterSpacing: 4,
  },
  stage: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 16,
  },
  circle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: C.dot,
    backgroundColor: C.surface,
  },
  meta: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.text3,
    letterSpacing: 2,
  },
  skip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 16,
  },
  skipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    letterSpacing: 2,
  },
});
