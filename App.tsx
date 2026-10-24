import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFonts } from "expo-font";
import AsyncStorage from "@react-native-async-storage/async-storage";
import LottieView from "lottie-react-native";
import { isAllowedUrl } from "./lib/blocker";
import Browser from "./components/Browser";

// ─────────────────────────────────────────────────────────────────────────────
// Nothing-Design: monochrome Palette (keine Farbakzente, kein Gradient)
// ─────────────────────────────────────────────────────────────────────────────
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

// Geräte werden dynamisch von NetSitter (/api/status) geladen.

const STORAGE = { url: "pb-server-url" };

type Cfg = { url: string };

// Server-Default: NetSitter auf dem Raspi (Port 3199, keine Auth). URL kann beim
// Build via EXPO_PUBLIC_NETSITTER_URL injiziert werden.
const DEFAULT_CFG: Cfg = {
  url: process.env.EXPO_PUBLIC_NETSITTER_URL || "http://192.168.0.221:3199",
};

// fetch mit Timeout + Redirect-Schutz (Credentials nie an Redirect-Ziele weiterreichen)
async function fetchWithTimeout(url: string, init: RequestInit, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, redirect: "error", signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// ─────────────────────────────────────────────────────────────────────────────
// NetSitter-Client (keine Auth — API auf dem Raspi, Port 3199)
// ─────────────────────────────────────────────────────────────────────────────
type Device = {
  id: string;
  ip: string;
  mac: string;
  name: string;
  blocked: boolean;
  reason: string;
  schedule_blocked: boolean;
  schedule_reason: string;
};

async function getStatus(cfg: Cfg): Promise<Device[]> {
  const res = await fetchWithTimeout(`${cfg.url.replace(/\/+$/, "")}/api/status`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = (data.devices || {}) as Record<string, any>;
  return Object.entries(raw).map(([id, d]) => ({
    id,
    ip: d.ip || "",
    mac: d.mac || "",
    name: d.name || id,
    blocked: !!d.blocked,
    reason: d.reason || "",
    schedule_blocked: !!d.schedule_blocked,
    schedule_reason: d.schedule_reason || "",
  }));
}

async function setBlock(cfg: Cfg, id: string, on: boolean): Promise<void> {
  const res = await fetchWithTimeout(`${cfg.url.replace(/\/+$/, "")}/api/${on ? "block" : "unblock"}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ device: id }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Glyph-Motiv — die echte Nothing-Dot-Matrix-Animation (Lottie, aus Nothing X)
// ─────────────────────────────────────────────────────────────────────────────
function Glyph({ size = 230 }: { size?: number }) {
  return (
    <LottieView
      source={require("./assets/lottie/dot-animation-dark.json")}
      autoPlay
      loop
      style={{ width: size, height: size }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    Ndot57: require("./assets/fonts/ndot57.otf"),
    Ndot: require("./assets/fonts/ndot.otf"),
    SpaceGrotesk: require("./assets/fonts/SpaceGrotesk-Medium.ttf"),
    SpaceGroteskBold: require("./assets/fonts/SpaceGrotesk-Bold.ttf"),
  });

  const [tab, setTab] = useState<"glyph" | "devices" | "server" | "browser">("glyph");
  const [now, setNow] = useState(() => new Date());

  // Server-Config (aus AsyncStorage, Default = Raspi-AdGuard im Heimnetz)
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [cfgDraft, setCfgDraft] = useState<Cfg>(cfg);
  const [serverOpen, setServerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Geräte-Status (NetSitter /api/status)
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const url = await AsyncStorage.getItem(STORAGE.url);
        const next: Cfg = { url: url && isAllowedUrl(url) ? url : DEFAULT_CFG.url };
        setCfg(next);
        setCfgDraft(next);
      } catch {
        /* ignorieren */
      }
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    setError(null);
    try {
      setDevices(await getStatus(cfg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDevices(null);
    }
  }

  useEffect(() => {
    if (tab === "devices") {
      refresh();
      const t = setInterval(refresh, 4000);
      return () => clearInterval(t);
    }
  }, [tab, cfg]);

  async function toggleDevice(id: string, on: boolean) {
    if (busyRef.current) return; // synchroner Mutex: ein Toggle app-weit gleichzeitig
    busyRef.current = true;
    setBusyIp(id);
    setError(null);
    try {
      await setBlock(cfg, id, on);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusyIp(null);
    }
  }

  async function saveServer() {
    const next: Cfg = { url: cfgDraft.url.trim().replace(/\/+$/, "") };
    if (!isAllowedUrl(next.url)) {
      setSaveError("URL nur https oder lokales Netz (http://192.168.x.x / .local).");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await AsyncStorage.setItem(STORAGE.url, next.url);
      setCfg(next);
      setServerOpen(false);
    } catch (e) {
      setSaveError(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.dot} />
      </SafeAreaView>
    );
  }

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dateStr = `${DAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BLOCKPHONE</Text>
        <Text style={styles.headerSub}>NOTHING · MONOCHROME</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(
          [
            ["glyph", "GLYPH"],
            ["devices", "GERÄTE"],
            ["browser", "BROWSER"],
            ["server", "SERVER"],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.tab}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {tab === key && <View style={styles.tabDot} />}
          </Pressable>
        ))}
      </View>

      {tab === "glyph" && (
        <View style={styles.glyphScreen}>
          <Glyph />
          <Text style={styles.clock}>{`${hh}:${mm}`}</Text>
          <Text style={styles.date}>{dateStr}</Text>
          <Text style={styles.hint}>Sperre & Fokus — schwarz auf weiß.</Text>
        </View>
      )}

      {tab === "devices" && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          <Text style={styles.sectionLabel}>GERÄTE IM NETZ</Text>
          {error ? <Text style={styles.error}>⚠ {error}</Text> : null}
          {devices === null && !error ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.dot} />
              <Text style={styles.hint}>verbinde …</Text>
            </View>
          ) : (
            (devices || []).map((d) => {
              const isBlocked = d.blocked || d.schedule_blocked;
              const busy = busyIp === d.id;
              return (
                <View key={d.id} style={styles.deviceCard}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{d.name}</Text>
                    <Text style={styles.deviceIp}>
                      {d.ip}{d.schedule_blocked ? " · Zeitplan" : ""}
                    </Text>
                  </View>
                  <View style={styles.deviceState}>
                    <View style={[styles.stateDot, { backgroundColor: isBlocked ? C.dotOff : C.dot }]} />
                    <Text style={[styles.stateText, { color: isBlocked ? C.text3 : C.text }]}>
                      {isBlocked ? "GESPERRT" : "ONLINE"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => toggleDevice(d.id, !d.blocked)}
                    disabled={busy}
                    style={[styles.toggleBtn, d.blocked && styles.toggleBtnOn]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={C.text} />
                    ) : (
                      <Text style={styles.toggleText}>{d.blocked ? "ENTSPERREN" : "SPERREN"}</Text>
                    )}
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {tab === "browser" && <Browser />}

      {tab === "server" && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          <Text style={styles.sectionLabel}>SERVER (NETSITTER)</Text>
          <Text style={styles.hint}>
            Die App spricht die NetSitter-API auf dem Raspberry Pi an (Heimnetz, Port 3199). Keine
            Anmeldung nötig — nur die URL wird lokal gespeichert.
          </Text>
          {saveError ? <Text style={styles.error}>⚠ {saveError}</Text> : null}
          <Text style={styles.fieldLabel}>URL</Text>
          <TextInput
            style={styles.input}
            value={cfgDraft.url}
            onChangeText={(t) => setCfgDraft((c) => ({ ...c, url: t }))}
            placeholder="http://192.168.0.221:3199"
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Pressable onPress={saveServer} disabled={saving} style={styles.saveBtn}>
            {saving ? (
              <ActivityIndicator size="small" color={C.bg} />
            ) : (
              <Text style={styles.saveBtnText}>SPEICHERN</Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: "Ndot57",
    fontSize: 30,
    color: C.text,
    letterSpacing: 3,
  },
  headerSub: {
    fontFamily: "SpaceGrotesk",
    fontSize: 10,
    color: C.text3,
    letterSpacing: 4,
    marginTop: 2,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  tabText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
  },
  tabTextActive: { color: C.text },
  tabDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.dot,
    marginTop: 6,
  },
  glyphScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  clock: {
    fontFamily: "Ndot57",
    fontSize: 64,
    color: C.text,
    letterSpacing: 4,
    marginTop: 4,
  },
  date: {
    fontFamily: "SpaceGrotesk",
    fontSize: 14,
    color: C.text2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 1,
    textAlign: "center",
    lineHeight: 18,
  },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 10 },
  sectionLabel: {
    fontFamily: "Ndot57",
    fontSize: 16,
    color: C.text2,
    letterSpacing: 3,
    marginBottom: 4,
  },
  error: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: "#ff5c6a",
    lineHeight: 18,
  },
  fieldLabel: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    backgroundColor: C.surface,
    fontFamily: "SpaceGrotesk",
  },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  deviceInfo: { flex: 1 },
  deviceName: {
    fontFamily: "SpaceGrotesk",
    fontSize: 15,
    color: C.text,
  },
  deviceIp: {
    fontFamily: "Ndot",
    fontSize: 13,
    color: C.text2,
    letterSpacing: 1,
    marginTop: 2,
  },
  deviceState: {
    alignItems: "center",
    gap: 3,
  },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  stateText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 9,
    letterSpacing: 1,
  },
  toggleBtn: {
    borderWidth: 1,
    borderColor: C.text2,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 96,
    alignItems: "center",
  },
  toggleBtnOn: {
    borderColor: C.dot,
    backgroundColor: C.dot,
  },
  toggleText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text,
    letterSpacing: 1,
  },
  saveBtn: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 18,
  },
  saveBtnText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
});
