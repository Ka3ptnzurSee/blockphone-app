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
import * as SecureStore from "expo-secure-store";
import LottieView from "lottie-react-native";

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

// Geräte aus devices.json des Netzwerkblockers (Raspi/AdGuard)
const DEVICES = [
  { name: "meister", ip: "192.168.0.253" },
  { name: "laptop", ip: "192.168.0.88" },
  { name: "ipad", ip: "192.168.0.29" },
  { name: "iphone", ip: "192.168.0.215" },
  { name: "tvstick", ip: "192.168.0.133" },
];

const MARKER = "# CENTRAL-BLOCK";

const STORAGE = {
  url: "pb-server-url",
  user: "pb-user",
  pass: "pb-pass",
};

type Cfg = { url: string; user: string; pass: string };

// UTF-8 → Bytes (codePointAt-basiert, keine deprecated APIs)
function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++; // Surrogate-Paar überspringen
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

// base64 (RFC 4648, UTF-8-sicher) — Hermes hat kein natives btoa
function b64(s: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b1 >> 2];
    out += chars[((b1 & 3) << 4) | (b2 >> 4)];
    out += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    out += i + 2 < bytes.length ? chars[b3 & 63] : "=";
  }
  return out;
}

// Wörtliche private IPv4 (vollständiger Match + Oktett-Check) — KEIN Präfix-Match,
// damit Hostnamen wie "192.168.0.1.attacker.com" NICHT durchrutschen.
function isPrivateIPv4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

// Nur https ODER http zu wörtlichen privaten IPs / localhost / .local (kein Klartext-Auth zu fremden Hosts)
function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const proto = u.protocol.toLowerCase();
    if (proto === "https:") return true;
    if (proto !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (isPrivateIPv4(h)) return true;
    if (h === "localhost" || h.endsWith(".local")) return true;
    return false;
  } catch {
    return false;
  }
}

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
// AdGuard-Client (spricht direkt die AdGuard-Home-API auf dem Raspi an)
// Sperre = DNS-Filterregel  /.*/$client=<ip>  # CENTRAL-BLOCK
// ─────────────────────────────────────────────────────────────────────────────
function authHeader(cfg: Cfg): string {
  return "Basic " + b64(`${cfg.user}:${cfg.pass}`);
}

async function getRules(cfg: Cfg): Promise<string[]> {
  const res = await fetchWithTimeout(`${cfg.url.replace(/\/+$/, "")}/control/filtering/status`, {
    headers: { Accept: "application/json", Authorization: authHeader(cfg) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.user_rules || []).map(String);
}

async function setRules(cfg: Cfg, rules: string[]): Promise<void> {
  const res = await fetchWithTimeout(`${cfg.url.replace(/\/+$/, "")}/control/filtering/set_rules`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(cfg),
    },
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function ruleIp(r: string): string | null {
  const m = r.match(/\$client=([0-9.]+)(?=\s|$)/);
  return m ? m[1] : null;
}

function blockedIps(rules: string[]): Set<string> {
  const s = new Set<string>();
  for (const r of rules) {
    if (!r.includes(MARKER)) continue;
    const ip = ruleIp(r);
    if (ip) s.add(ip);
  }
  return s;
}

async function applyBlock(cfg: Cfg, ip: string, on: boolean) {
  const rules = await getRules(cfg);
  const without = rules.filter((r) => !(r.includes(MARKER) && ruleIp(r) === ip));
  const next = on ? [...without, `/.*/$client=${ip}  ${MARKER}`] : without;
  await setRules(cfg, next);
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

  const [tab, setTab] = useState<"glyph" | "devices" | "server">("glyph");
  const [now, setNow] = useState(() => new Date());

  // Server-Config (aus AsyncStorage, Default = Raspi-AdGuard im Heimnetz)
  const [cfg, setCfg] = useState<Cfg>({ url: "http://192.168.0.221:3000", user: "admin", pass: "" });
  const [cfgDraft, setCfgDraft] = useState<Cfg>(cfg);
  const [serverOpen, setServerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Geräte-Status
  const [rules, setRules] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [url, user, pass] = await Promise.all([
          AsyncStorage.getItem(STORAGE.url),
          AsyncStorage.getItem(STORAGE.user),
          SecureStore.getItemAsync(STORAGE.pass),
        ]);
        const next: Cfg = {
          url: url && isAllowedUrl(url) ? url : cfg.url,
          user: user || cfg.user,
          pass: pass || "",
        };
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
      setRules(await getRules(cfg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRules(null);
    }
  }

  useEffect(() => {
    if (tab === "devices") {
      refresh();
      const t = setInterval(refresh, 4000);
      return () => clearInterval(t);
    }
  }, [tab, cfg]);

  async function toggleDevice(ip: string, on: boolean) {
    if (busyRef.current) return; // synchroner Mutex: ein Toggle app-weit gleichzeitig
    busyRef.current = true;
    setBusyIp(ip);
    setError(null);
    try {
      await applyBlock(cfg, ip, on);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusyIp(null);
    }
  }

  async function saveServer() {
    const next: Cfg = {
      url: cfgDraft.url.trim().replace(/\/+$/, ""),
      user: cfgDraft.user.trim(),
      pass: cfgDraft.pass,
    };
    if (!isAllowedUrl(next.url)) {
      setSaveError("URL nur https oder lokales Netz (http://192.168.x.x / .local).");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await AsyncStorage.multiSet([
        [STORAGE.url, next.url],
        [STORAGE.user, next.user],
      ]);
      if (next.pass) {
        await SecureStore.setItemAsync(STORAGE.pass, next.pass);
      } else {
        await SecureStore.deleteItemAsync(STORAGE.pass);
      }
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

  const blocked = blockedIps(rules || []);
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
          {rules === null && !error ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.dot} />
              <Text style={styles.hint}>verbinde …</Text>
            </View>
          ) : (
            DEVICES.map((d) => {
              const isBlocked = blocked.has(d.ip);
              const busy = busyIp === d.ip;
              return (
                <View key={d.ip} style={styles.deviceCard}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{d.name}</Text>
                    <Text style={styles.deviceIp}>{d.ip}</Text>
                  </View>
                  <View style={styles.deviceState}>
                    <View style={[styles.stateDot, { backgroundColor: isBlocked ? C.dotOff : C.dot }]} />
                    <Text style={[styles.stateText, { color: isBlocked ? C.text3 : C.text }]}>
                      {isBlocked ? "GESPERRT" : "ONLINE"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => toggleDevice(d.ip, !isBlocked)}
                    disabled={busy}
                    style={[styles.toggleBtn, isBlocked && styles.toggleBtnOn]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={C.text} />
                    ) : (
                      <Text style={styles.toggleText}>{isBlocked ? "ENTSPERREN" : "SPERREN"}</Text>
                    )}
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {tab === "server" && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          <Text style={styles.sectionLabel}>SERVER (ADGUARD)</Text>
          <Text style={styles.hint}>
            Die App spricht direkt die AdGuard-Home-API auf dem Raspberry Pi an (Heimnetz). URL und
            Benutzer werden lokal gespeichert; das Passwort liegt im iOS-Keychain (SecureStore).
          </Text>
          {saveError ? <Text style={styles.error}>⚠ {saveError}</Text> : null}
          <Text style={styles.fieldLabel}>URL</Text>
          <TextInput
            style={styles.input}
            value={cfgDraft.url}
            onChangeText={(t) => setCfgDraft((c) => ({ ...c, url: t }))}
            placeholder="http://192.168.0.221:3000"
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.fieldLabel}>BENUTZER</Text>
          <TextInput
            style={styles.input}
            value={cfgDraft.user}
            onChangeText={(t) => setCfgDraft((c) => ({ ...c, user: t }))}
            placeholder="admin"
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldLabel}>PASSWORT</Text>
          <TextInput
            style={styles.input}
            value={cfgDraft.pass}
            onChangeText={(t) => setCfgDraft((c) => ({ ...c, pass: t }))}
            placeholder="AdGuard-Passwort"
            placeholderTextColor={C.text3}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
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
