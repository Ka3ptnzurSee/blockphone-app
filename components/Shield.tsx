import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ALL_PLATFORMS } from "../lib/dnsBlocklist";
import {
  disableDnsBlocking,
  dnsBlockingAvailable,
  dnsBlockingStatus,
  enableDnsBlocking,
} from "../lib/vpn";

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

const LABELS: Record<string, string> = {
  youtube: "YOUTUBE",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  x: "X",
  reddit: "REDDIT",
};

// Systemweites DNS-Blocking (PacketTunnelProvider, Personal VPN).
// Blockt die Plattform-Domains über DNS — gilt app-übergreifend (auch native Apps),
// nicht nur im eingebauten Browser.
export default function Shield() {
  const available = dnsBlockingAvailable();
  const busyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await dnsBlockingStatus();
      setConnected(s.connected);
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle() {
    if (busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    setError(null);
    try {
      if (connected) {
        await disableDnsBlocking();
      } else {
        await enableDnsBlocking(ALL_PLATFORMS);
      }
      // Der Tunnel braucht einen Moment (iOS-Dialog + Verbindungsaufbau) →
      // ein paar Mal nachfassen, statt sofort "INAKTIV" anzuzeigen.
      let s = await dnsBlockingStatus();
      for (let i = 0; i < 8 && !s.connected; i++) {
        await new Promise((r) => setTimeout(r, 750));
        s = await dnsBlockingStatus();
      }
      setConnected(s.connected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>SYSTEMWEITE SPERRE</Text>
      <Text style={styles.hint}>
        DNS-VPN-Schild: blockt die Plattform-Domains auf Geräteebene — gilt für native Apps
        UND den Browser. Domains werden per DNS (NXDOMAIN) aufgelöst.
      </Text>

      {!available && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>NICHT VERFÜGBAR</Text>
          <Text style={styles.cardBody}>
            Das native VpnManager-Modul fehlt. Systemweites Blocking läuft nur im nativen
            iOS-Build (nicht in Expo Go).
          </Text>
        </View>
      )}

      {/* Status */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.stateDot, { backgroundColor: connected ? C.dot : C.dotOff }]} />
          <Text style={styles.cardTitle}>{connected ? "AKTIV" : "INAKTIV"}</Text>
        </View>

        <View style={styles.chips}>
          {ALL_PLATFORMS.map((p) => (
            <View key={p} style={styles.chip}>
              <Text style={styles.chipText}>{LABELS[p] ?? p.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>⚠ {error}</Text> : null}

        <Pressable
          onPress={() => void toggle()}
          disabled={!available || busy}
          style={[styles.toggle, !available && styles.toggleDisabled]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Text style={styles.toggleText}>{connected ? "DEAKTIVIEREN" : "AKTIVIEREN"}</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Beim ersten Aktivieren fragt iOS nach der VPN-Erlaubnis. Der Tunnel leitet nur
        DNS-Anfragen um — der restliche Datenverkehr läuft normal.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10 },
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
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    gap: 12,
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stateDot: { width: 12, height: 12, borderRadius: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 1,
  },
  error: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: "#ff5c6a",
    lineHeight: 18,
  },
  toggle: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  toggleDisabled: { opacity: 0.35 },
  toggleText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
});
