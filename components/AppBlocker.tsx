import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  applyShield,
  clearShield,
  pickAppsToBlock,
  requestScreenTimeAccess,
  screenTimeAvailable,
  screenTimeStatus,
  selectedAppsCount,
} from "../shield/ScreenTimeShield";

const C = {
  bg: "#000000",
  surface: "#141414",
  surface2: "#1f1f1f",
  border: "#2a2a2a",
  text: "#ffffff",
  text2: "#8a8a8a",
  text3: "#5a5a5a",
  dot: "#ffffff",
  warn: "#ffb300",
};

type Status = "approved" | "denied" | "notDetermined";

export default function AppBlocker() {
  const [status, setStatus] = useState<Status>("notDetermined");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await screenTimeStatus();
    setStatus(s.status);
    setCount(await selectedAppsCount());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grant = async () => {
    setBusy(true);
    const r = await requestScreenTimeAccess();
    setStatus(r.status);
    setMsg(r.status === "approved" ? "Bildschirmzeit-Zugriff erlaubt." : "Zugriff nicht erteilt.");
    setBusy(false);
  };

  const pick = async () => {
    setBusy(true);
    const r = await pickAppsToBlock();
    setCount(await selectedAppsCount());
    setMsg(r.selection === "saved" ? "Auswahl gespeichert." : "Picker nicht verfuegbar.");
    setBusy(false);
  };

  const toggle = async () => {
    setBusy(true);
    if (active) {
      await clearShield();
      setActive(false);
      setMsg("Sperre aus.");
    } else {
      const r = await applyShield();
      setActive(r.shield === "on");
      setMsg(r.shield === "on" ? "Apps gesperrt." : "Keine Auswahl getroffen.");
    }
    setBusy(false);
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>APPS SPERREN</Text>
      <Text style={s.sub}>Bildschirmzeit-Sperre fuer ausgewaehlte Apps, Kategorien und Webseiten.</Text>

      {!screenTimeAvailable ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>NOCH NICHT AKTIV</Text>
          <Text style={s.cardText}>
            Dieser Build enthaelt die Screen-Time-Sperre noch nicht. Apple muss das Family-Controls-Entitlement
            freigeben; danach wird sie mit dem naechsten Build aktiv.
          </Text>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.rowLabel}>ZUGRIFF</Text>
        <Text style={s.rowValue}>
          {status === "approved" ? "erlaubt" : status === "denied" ? "verweigert" : "nicht erteilt"}
        </Text>
        <Pressable style={s.btn} onPress={grant} disabled={busy}>
          <Text style={s.btnText}>BILDSCHIRMZEIT-ZUGRIFF ERLAUBEN</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.rowLabel}>AUSWAHL</Text>
        <Text style={s.rowValue}>{count} Apps/Kategorien</Text>
        <Pressable style={s.btn} onPress={pick} disabled={busy}>
          <Text style={s.btnText}>APPS AUSWAEHLEN</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.rowLabel}>SPERRE</Text>
        <Text style={s.rowValue}>{active ? "aktiv" : "aus"}</Text>
        <Pressable style={[s.btn, active && s.btnOn]} onPress={toggle} disabled={busy}>
          <Text style={[s.btnText, active && s.btnTextOn]}>{active ? "SPERRE AUFHEBEN" : "SPERRE AKTIVIEREN"}</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator color={C.text} style={{ marginTop: 12 }} /> : null}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}
      <Text style={s.foot}>Internet-Sperre laeuft weiter ueber den SHIELD-Tab (DNS/VPN).</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 120 },
  title: { color: C.text, fontSize: 22, fontWeight: "700", letterSpacing: 2 },
  sub: { color: C.text2, fontSize: 13, marginTop: 6, marginBottom: 18 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { color: C.warn, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  cardText: { color: C.text2, fontSize: 13, lineHeight: 19 },
  rowLabel: { color: C.text3, fontSize: 11, letterSpacing: 1.5 },
  rowValue: { color: C.text, fontSize: 17, marginTop: 4, marginBottom: 12 },
  btn: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnOn: { backgroundColor: C.text, borderColor: C.text },
  btnText: { color: C.text, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  btnTextOn: { color: C.bg },
  msg: { color: C.text2, fontSize: 12, marginTop: 12 },
  foot: { color: C.text3, fontSize: 11, marginTop: 22 },
});

