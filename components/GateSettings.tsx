// components/GateSettings.tsx — SETUP → APP-START
//
// Die "harten Regeln" beim Öffnen der App sind optional: PIN-Gate und die
// Intervention (Atmen/Mathe/Journal). Wer sie will, schaltet sie hier ein — nie
// aufgezwungen. Dazu der Hinweis, was der PIN wirklich kann (Selbstkontrolle,
// kein Sicherheitsschloss).

import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  loadGateSettings,
  saveGateSettings,
  type GateSettings as Gates,
} from "../lib/gateSettings";
import { hasPin } from "../lib/streakStore";

const C = {
  bg: "#000000",
  surface: "#141414",
  surface2: "#1f1f1f",
  border: "#2a2a2a",
  text: "#ffffff",
  text2: "#8a8a8a",
  text3: "#5a5a5a",
};

export default function GateSettings() {
  const [gates, setGates] = useState<Gates>({ pinRequired: true, interventionRequired: true });
  const [pinSet, setPinSet] = useState(false);

  useEffect(() => {
    void (async () => {
      setGates(await loadGateSettings());
      setPinSet(await hasPin());
    })();
  }, []);

  const toggle = async (key: keyof Gates) => {
    const next = await saveGateSettings({ ...gates, [key]: !gates[key] });
    setGates(next);
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>APP-START</Text>
      <Text style={s.sub}>
        Was passiert, wenn du Blockphone öffnest. Alles hier ist freiwillig — die Sperren
        funktionieren auch ohne PIN und ohne Intervention.
      </Text>

      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>PIN VERLANGEN</Text>
            <Text style={s.rowSub}>
              {pinSet ? "PIN ist gesetzt" : "noch kein PIN gesetzt"} ·{" "}
              {gates.pinRequired ? "wird beim Öffnen abgefragt" : "Öffnen ohne PIN"}
            </Text>
          </View>
          <Pressable onPress={() => void toggle("pinRequired")} style={[s.switch, gates.pinRequired && s.switchOn]}>
            <Text style={[s.switchText, gates.pinRequired && s.switchTextOn]}>
              {gates.pinRequired ? "AN" : "AUS"}
            </Text>
          </Pressable>
        </View>
        <Text style={s.hint}>
          Der PIN ist Selbstkontrolle, kein Sicherheitsschloss: er bremst den Impuls, er hält
          niemanden auf, der ihn wirklich loswerden will. Beim ersten Start mit aktivem PIN wird
          einer gesetzt.
        </Text>
      </View>

      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>INTERVENTION VOR DEM ÖFFNEN</Text>
            <Text style={s.rowSub}>
              {gates.interventionRequired
                ? "Atmen / Mathe / Journal vor dem Öffnen"
                : "direkt rein, ohne Unterbrechung"}
            </Text>
          </View>
          <Pressable
            onPress={() => void toggle("interventionRequired")}
            style={[s.switch, gates.interventionRequired && s.switchOn]}
          >
            <Text style={[s.switchText, gates.interventionRequired && s.switchTextOn]}>
              {gates.interventionRequired ? "AN" : "AUS"}
            </Text>
          </Pressable>
        </View>
        <Text style={s.hint}>
          Die Intervention ist der wirksamste Teil gegen reflexhaftes Öffnen (one-sec-Prinzip).
          Wenn sie nur nervt, schalte sie aus — die App-Sperre selbst bleibt davon unberührt.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.rowTitle}>WAS DER PIN NICHT KANN</Text>
        <Text style={s.hint}>
          Er verhindert nicht, dass die App gelöscht wird, und nicht, dass Bildschirmzeit-Regeln
          geändert werden. Dafür braucht es das Löschen-Verbot in der Bildschirmzeit (Code bei
          einer anderen Person) — siehe SPERREN → APPS → LÖSCHSCHUTZ.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  title: { fontFamily: "Ndot57", fontSize: 20, color: C.text, letterSpacing: 3 },
  sub: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text2,
    letterSpacing: 0.6,
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
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: "Ndot57", fontSize: 14, color: C.text, letterSpacing: 1.6 },
  rowSub: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text2, letterSpacing: 0.5 },
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    lineHeight: 17,
    letterSpacing: 0.4,
  },
  switch: {
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
    alignItems: "center",
  },
  switchOn: { backgroundColor: C.text, borderColor: C.text },
  switchText: { fontFamily: "Ndot57", fontSize: 11, color: C.text2, letterSpacing: 1.5 },
  switchTextOn: { color: C.bg },
});
