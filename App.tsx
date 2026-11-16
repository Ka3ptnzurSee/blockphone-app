import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useFonts } from "expo-font";
import Constants from "expo-constants";
import LottieView from "lottie-react-native";
import { browserExitTab } from "./lib/browser";
import Browser from "./components/Browser";
import PinGate from "./components/PinGate";
import LimitSettings from "./components/LimitSettings";
import Shield from "./components/Shield";
import AppBlocker from "./components/AppBlocker";
import CommitmentSettings from "./components/CommitmentSettings";
import InterventionGate from "./components/InterventionGate";
import ScheduleSettings from "./components/ScheduleSettings";
import GateSettings from "./components/GateSettings";
import { loadGamification, type GamificationInfo } from "./lib/gamificationStore";
import { hasPin, loadStreak, type StreakInfo } from "./lib/streakStore";
import { withinReInterventionWindow } from "./lib/interventionStore";
import { markAppUnlocked, withinUnlockGrace } from "./lib/unlockGate";
import { loadGateSettings } from "./lib/gateSettings";

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
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

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
// Unlock-Flow: Intervention (one sec-Muster) → PIN.
// Re-Intervention-Fenster: kurz zuvor entsperrt → Intervention überspringen.
// ─────────────────────────────────────────────────────────────────────────────
// `fresh` = true nur nach echter PIN-Eingabe. Nur dann wird die Gnadenfrist
// neu gestartet — sonst würde jedes Öffnen innerhalb der Frist sie verlängern
// (Gleitfenster: App alle 14 min auf = nie wieder PIN).
function UnlockFlow({ onUnlock }: { onUnlock: (fresh: boolean) => void }) {
  const [step, setStep] = useState<"loading" | "intervention" | "pin">("loading");

  useEffect(() => {
    (async () => {
      try {
        // Gnadenfrist: gerade eben entsperrt (z. B. App weggewischt und wieder
        // geöffnet) → direkt rein, ohne Intervention und ohne PIN.
        if (await withinUnlockGrace()) {
          onUnlock(false);
          return;
        }
        const [pinned, inWindow, gates] = await Promise.all([
          hasPin(),
          withinReInterventionWindow(),
          loadGateSettings(),
        ]);
        // Harte Regeln sind optional: ohne PIN-Pflicht geht es direkt rein,
        // ohne Interventions-Pflicht direkt zum PIN (bzw. rein).
        if (!gates.pinRequired) {
          onUnlock(true);
          return;
        }
        // Erster Start (noch kein PIN), Intervention aus oder gerade entsperrt → PIN.
        setStep(!pinned || inWindow || !gates.interventionRequired ? "pin" : "intervention");
      } catch {
        // Speicher-Lesefehler: nicht im ewigen Spinner hängen bleiben — PIN-Gate
        // ist immer bedienbar (ohne gesetzten PIN öffnet es direkt).
        setStep("pin");
      }
    })();
  }, []);

  if (step === "loading") {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.dot} />
      </SafeAreaView>
    );
  }
  if (step === "intervention") {
    return <InterventionGate onDone={() => setStep("pin")} />;
  }
  return <PinGate onUnlock={() => onUnlock(true)} />;
}

// In-App-Kleinbild: kleines, verschiebbares Browser-Fenster über den Tabs.
const MINI_W = 168;
const MINI_H = 300;
const MINI_PAD = 8;
// Griff/✕ des Kleinbilds sitzen 26 px ÜBER dem Fenster — minimales y so, dass
// sie nicht über den oberen Bildschirmrand rutschen.
const MINI_MIN_Y = 26 + MINI_PAD;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// Build 148: EIN Einstellungs-Tab (SETUP) statt "APPS" + "MEHR" mit Unter-Tabs
// über die ganze App verteilt. SPERREN bündelt die beiden Sperr-Systeme.
type TabKey = "glyph" | "browser" | "sperren" | "setup";
type SperrenSub = "apps" | "domains";
type SetupSub = "limits" | "zeit" | "commit" | "start";

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

  const [tab, setTab] = useState<TabKey>("glyph");
  const [sperrenSub, setSperrenSub] = useState<SperrenSub>("apps");
  const [setupSub, setSetupSub] = useState<SetupSub>("limits");
  const [now, setNow] = useState(() => new Date());
  const [unlocked, setUnlocked] = useState(false);
  // Browser-Layer bleibt nach dem ersten Öffnen gemountet (PiP/Video läuft weiter).
  const [browserMounted, setBrowserMounted] = useState(false);
  // Kleinbild: Browser läuft klein in der Ecke weiter (Video bleibt an),
  // Tabs darunter bleiben bedienbar.
  const [mini, setMini] = useState(false);
  const [miniPos, setMiniPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const miniPosRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const { width: winW, height: winH } = useWindowDimensions();
  const [streak, setStreak] = useState<StreakInfo>({ days: 0 });
  const [gam, setGam] = useState<GamificationInfo | null>(null);

  useEffect(() => {
    if (tab === "browser") setBrowserMounted(true);
  }, [tab]);

  // Kleinbild: Startposition oben links im sichtbaren Rest (über den Tabs) und
  // bei Drehung/Fenstergröße im Bild halten.
  useEffect(() => {
    if (!mini) return;
    const maxX = Math.max(MINI_PAD, winW - MINI_W - MINI_PAD);
    const maxY = Math.max(MINI_MIN_Y, winH - MINI_H - MINI_PAD);
    setMiniPos((p) => {
      const next =
        p.x > 0 || p.y > 0
          ? { x: clamp(p.x, MINI_PAD, maxX), y: clamp(p.y, MINI_MIN_Y, maxY) }
          : { x: maxX - 4, y: Math.max(MINI_MIN_Y, maxY - 104) };
      miniPosRef.current = next;
      return next;
    });
  }, [mini, winW, winH]);

  const dimsRef = useRef({ w: winW, h: winH });
  dimsRef.current = { w: winW, h: winH };

  // Griff über dem Kleinbild: ziehen = verschieben, antippen = wieder groß.
  const miniPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartRef.current = { ...miniPosRef.current };
      },
      onPanResponderMove: (_e, g) => {
        const { w, h } = dimsRef.current;
        const maxX = Math.max(MINI_PAD, w - MINI_W - MINI_PAD);
        const maxY = Math.max(MINI_MIN_Y, h - MINI_H - MINI_PAD);
        const next = {
          x: clamp(dragStartRef.current.x + g.dx, MINI_PAD, maxX),
          y: clamp(dragStartRef.current.y + g.dy, MINI_MIN_Y, maxY),
        };
        miniPosRef.current = next;
        setMiniPos(next);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) setTab("browser");
      },
    }),
  ).current;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadStreak().then(setStreak).catch(() => setStreak({ days: 0 }));
      loadGamification().then(setGam).catch(() => setGam(null));
    }
  }, [unlocked]);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={C.dot} />
      </SafeAreaView>
    );
  }

  if (!unlocked) {
    return (
      <UnlockFlow
        onUnlock={(fresh) => {
          if (fresh) void markAppUnlocked();
          setUnlocked(true);
        }}
      />
    );
  }

  // BROWSER = eigener Vollbild-Modus: Header, Tabs und Statusbar fallen weg,
  // die WebView bekommt die volle Höhe (fast Vollbild). Zurück über das ✕ im
  // Browser oder den Tab-Wechsel-Button (führt zu SHIELD).
  //
  // WICHTIG (Picture-in-Picture): Die WebView wird NICHT mehr ausgehängt, wenn
  // der Tab wechselt. Vorher zerstörte der Unmount das <video>-Element und damit
  // jede laufende Wiedergabe — PiP konnte nie weiterlaufen. Jetzt bleibt der
  // Browser-Layer gemountet und wird nur unsichtbar (opacity 0, keine Touches).

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
            ["browser", "BROWSER"],
            ["sperren", "SPERREN"],
            ["setup", "SETUP"],
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
          <Text style={styles.streak}>DAY {streak.days} · DAYS ON YOUR TERMS</Text>
          {gam ? (
            <Text style={styles.streakSub}>
              {gam.grace.graceConsumed ? "KULANZ-TAG GENUTZT · " : ""}
              WOCHE {gam.week.activeDays}/{gam.week.totalDays} TAGE
            </Text>
          ) : null}
          <Text style={styles.hint}>Sperre & Fokus — schwarz auf weiß.</Text>
        </View>
      )}


      {tab === "sperren" && (
        <View style={styles.mehrRoot}>
          <View style={styles.mehrTabs}>
            {(
              [
                ["apps", "APPS"],
                ["domains", "DOMAINS"],
              ] as const
            ).map(([key, label]) => (
              <Pressable key={key} onPress={() => setSperrenSub(key)} style={styles.mehrTab}>
                <Text style={[styles.mehrTabText, sperrenSub === key && styles.mehrTabTextActive]}>
                  {label}
                </Text>
                {sperrenSub === key && <View style={styles.tabDot} />}
              </Pressable>
            ))}
          </View>
          {sperrenSub === "apps" ? <AppBlocker /> : <Shield />}
        </View>
      )}

      {tab === "setup" && (
        <View style={styles.mehrRoot}>
          <View style={styles.mehrTabs}>
            {(
              [
                ["limits", "LIMITS"],
                ["zeit", "ZEIT"],
                ["commit", "COMMIT"],
                ["start", "APP-START"],
              ] as const
            ).map(([key, label]) => (
              <Pressable key={key} onPress={() => setSetupSub(key)} style={styles.mehrTab}>
                <Text style={[styles.mehrTabText, setupSub === key && styles.mehrTabTextActive]}>
                  {label}
                </Text>
                {setupSub === key && <View style={styles.tabDot} />}
              </Pressable>
            ))}
          </View>
          {setupSub === "limits" ? (
            <LimitSettings />
          ) : setupSub === "zeit" ? (
            <ScheduleSettings />
          ) : setupSub === "commit" ? (
            <CommitmentSettings />
          ) : (
            <GateSettings />
          )}
          {/* Damit man am Gerät sofort sieht, welcher Build läuft. */}
          <Text style={styles.versionFoot}>
            BUILD {Constants.expoConfig?.ios?.buildNumber ?? "?"} · V
            {Constants.expoConfig?.version ?? "?"}
          </Text>
        </View>
      )}

      {/* Browser: einmal geöffnet bleibt er gemountet, damit Video/PiP beim
          Tab-Wechsel nicht abgewürgt wird. Aktiv = Vollbild über allem,
          Kleinbild = kleines verschiebbares Fenster, sonst unsichtbar. */}
      {browserMounted ? (
        <View
          style={[
            styles.browserLayer,
            tab === "browser"
              ? styles.browserOn
              : mini
                ? [styles.browserMini, { left: miniPos.x, top: miniPos.y }]
                : styles.browserOff,
          ]}
          pointerEvents={tab === "browser" || mini ? "auto" : "none"}
        >
          {tab === "browser" ? <StatusBar style="light" hidden /> : null}
          <Browser
            active={tab === "browser"}
            mini={mini && tab !== "browser"}
            onMini={() => {
              setMini(true);
              setTab(browserExitTab(tab));
            }}
            onExit={() => {
              setMini(false);
              setTab(browserExitTab(tab));
            }}
          />
        </View>
      ) : null}

      {/* Kleinbild-Griff: ziehen = verschieben, kurzer Tap = wieder Vollbild. */}
      {mini && tab !== "browser" ? (
        <>
          <View
            style={[styles.miniBar, { left: miniPos.x, top: miniPos.y - 26 }]}
            {...miniPan.panHandlers}
          >
            <Text style={styles.miniBarText}>⤢ KLEINBILD</Text>
          </View>
          <Pressable
            onPress={() => {
              setMini(false);
              setTab("sperren");
            }}
            style={[styles.miniClose, { left: miniPos.x + MINI_W - 26, top: miniPos.y - 26 }]}
          >
            <Text style={styles.miniCloseText}>✕</Text>
          </Pressable>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  // Browser-Layer: aktiv Vollbild über Header/Tabs, als Kleinbild ein kleines
  // Fenster (bleibt im View-Tree, damit <video>/PiP weiterlaufen).
  browserLayer: { position: "absolute" },
  browserOn: {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.bg,
    opacity: 1,
    zIndex: 10,
  },
  browserOff: { left: 0, right: 0, top: 0, bottom: 0, opacity: 0, zIndex: 0 },
  browserMini: {
    width: MINI_W,
    height: MINI_H,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    backgroundColor: C.bg,
    zIndex: 20,
  },
  miniBar: {
    position: "absolute",
    width: MINI_W - 26,
    height: 26,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    borderTopLeftRadius: 12,
    zIndex: 21,
  },
  miniBarText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 9,
    color: C.text2,
    letterSpacing: 2,
  },
  miniClose: {
    position: "absolute",
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    borderTopRightRadius: 12,
    zIndex: 21,
  },
  miniCloseText: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text2 },
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
    fontSize: 10,
    color: C.text3,
    letterSpacing: 1,
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
  streakSub: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 4,
  },
  versionFoot: {
    fontFamily: "SpaceGrotesk",
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2,
    textAlign: "center",
    paddingVertical: 14,
  },
  guidesWrap: { flex: 1, backgroundColor: C.bg },
  streak: {
    fontFamily: "Ndot",
    fontSize: 13,
    color: C.dot,
    letterSpacing: 2,
    marginTop: 6,
  },
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 1,
    textAlign: "center",
    lineHeight: 18,
  },
  mehrRoot: { flex: 1, backgroundColor: C.bg },
  mehrTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  mehrTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  mehrTabText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 2,
  },
  mehrTabTextActive: { color: C.text },
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
