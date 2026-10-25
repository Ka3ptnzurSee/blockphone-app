import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  DEFAULT_FILTER_CONFIG,
  PLATFORM_URLS,
  buildBeforeContentScript,
  buildInjectedScript,
  type Platform,
} from "../lib/browser";
import { addUsage, ensureLimit, relock, unlockFor, type LimitState } from "../lib/limitStore";
import {
  formatCountdown,
  formatRation,
  freshEntry,
  unlockRemaining,
} from "../lib/limits";
import { todayKey } from "../lib/streak";
import Breathing from "./Breathing";

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

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "youtube", label: "YOUTUBE" },
  { key: "instagram", label: "INSTAGRAM" },
  { key: "facebook", label: "FACEBOOK" },
  { key: "x", label: "X" },
  { key: "reddit", label: "REDDIT" },
];

// iPhone-User-Agent erzwingen → die Plattformen liefern ihre Mobile-Web-Version.
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Nur die 5 Plattform-Origins erlauben — der "Blocker"-Browser darf nicht auf
// beliebige Seiten ausweichen (sonst läuft die Bridge auf fremden Origins).
const ALLOWED_ORIGINS = Object.values(PLATFORM_URLS).map((u) => new URL(u).origin);

// Same-origin Link-Shim/Redirect-Endpunkte (m.youtube.com/redirect, m.facebook.com/l.php, /away.php …).
// Ein 3xx-Redirect umgeht onShouldStartLoadWithRequest (WKWebView folgt ihm intern);
// das Ziel ist immer extern. → Navigation zum Endpunkt selbst präventiv blocken.
const REDIRECT_PATH_RE = /\/(redirect|redir|away(?:\.php)?|l\.php|flx\/warn|linkshim|exit)(\/|\?|$)/i;

// Nutzung alle 30 s persistieren (Rebase), damit ein App-Kill max. 30 s verliert.
const CHECKPOINT_MS = 30_000;

export default function Browser() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(0);
  const [url, setUrl] = useState("");

  // Tageslimit-Engine
  const [limits, setLimits] = useState<LimitState>({});
  const [now, setNow] = useState(() => Date.now());
  const [intervention, setIntervention] = useState(false);
  const [unlockMinutes, setUnlockMinutes] = useState(15);
  const sessionStartRef = useRef(Date.now());
  const sessionBaseRef = useRef(0);
  const pausedRef = useRef(false);
  const platformRef = useRef<Platform>("youtube");
  const webviewRef = useRef<WebView>(null);
  const flushChainRef = useRef<Promise<void>>(Promise.resolve());
  const lockEpochRef = useRef(0);

  // Key erzwingt Neu-Mount bei Plattform-Wechsel (frische Session, keine Alt-State).
  const key = platform;

  const cfg = DEFAULT_FILTER_CONFIG;
  const before = useMemo(() => buildBeforeContentScript(cfg), []);
  const injected = useMemo(() => buildInjectedScript(platform, cfg), [platform]);

  // ── Tageslimit: abgeleitete Werte ──────────────────────────────────────────
  const entry = limits[platform] || freshEntry(platform, todayKey());
  const elapsed = pausedRef.current
    ? 0
    : Math.max(0, Math.floor((now - sessionStartRef.current) / 1000));
  const usedTotal = sessionBaseRef.current + elapsed;
  const remaining = Math.max(0, entry.limitSeconds - usedTotal);
  const unlockLeft = unlockRemaining(entry, now);
  const locked = remaining <= 0 && unlockLeft <= 0;

  // Verbrauchte Session-Sekunden persistieren + Session neu basieren.
  // Serialisiert (Chain), damit parallele Checkpoints nicht doppelt zählen;
  // pausiert bei Sperre (kein Phantom-Verbrauch).
  function flushUsage(): Promise<void> {
    const run = flushChainRef.current.then(async () => {
      if (pausedRef.current) return;
      const p = platformRef.current;
      const s = Math.max(0, Math.floor((Date.now() - sessionStartRef.current) / 1000));
      if (s <= 0) return;
      const st = await addUsage(p, s);
      sessionStartRef.current = Date.now();
      sessionBaseRef.current = (st[p] || freshEntry(p, todayKey())).usedSeconds;
      setLimits(st);
    });
    flushChainRef.current = run.catch(() => {});
    return run;
  }

  // Plattform wechseln: alte Session abschließen, neue laden.
  async function selectPlatform(p: Platform) {
    try {
      await flushUsage();
      platformRef.current = p;
      const st = await ensureLimit(p);
      setLimits(st);
      sessionStartRef.current = Date.now();
      sessionBaseRef.current = (st[p] || freshEntry(p, todayKey())).usedSeconds;
      setPlatform(p);
      setBlocked(0);
      setLoading(true);
    } catch {
      /* ignorieren — Plattform-Wechsel bleibt aus */
    }
  }

  // Initial: Limits laden + Session starten.
  useEffect(() => {
    (async () => {
      const st = await ensureLimit("youtube");
      setLimits(st);
      sessionStartRef.current = Date.now();
      sessionBaseRef.current = (st.youtube || freshEntry("youtube", todayKey())).usedSeconds;
    })();
    // Unmount: laufende Session abschließen.
    return () => {
      void flushUsage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1s-Tick für Countdown + Live-Anzeige.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Checkpoint: alle 30 s persistieren.
  useEffect(() => {
    const t = setInterval(() => void flushUsage(), CHECKPOINT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bei Sperre: letzte aktive Sekunden sichern, DANN pausieren. Bei Freischaltung: fortsetzen.
  useEffect(() => {
    if (locked && !pausedRef.current) {
      const epoch = ++lockEpochRef.current;
      void flushUsage().then(() => {
        if (lockEpochRef.current === epoch) pausedRef.current = true;
      });
    } else if (!locked && pausedRef.current) {
      pausedRef.current = false;
      sessionStartRef.current = Date.now();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  async function doUnlock(minutes: number) {
    try {
      lockEpochRef.current++; // ausstehende Pause invalidieren
      const st = await unlockFor(platform, minutes);
      setLimits(st);
      pausedRef.current = false;
      sessionStartRef.current = Date.now();
    } catch {
      setIntervention(false); // zurück ins Lock-Overlay statt hängen zu bleiben
    }
  }

  async function doRelock() {
    try {
      const st = await relock(platform);
      setLimits(st);
    } catch {
      /* ignorieren — UI bleibt auf altem Stand */
    }
  }

  function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m && m.platform && typeof m.count === "number" && Number.isFinite(m.count)) {
        setBlocked(m.count);
      }
    } catch {
      /* ignorieren */
    }
  }

  function onNav(nav: WebViewNavigation) {
    // about:blank / initiale Leer-Navigation nicht als fremd behandeln.
    if (!nav.url || nav.url === "about:blank") return;
    // Redirect-Nachkontrolle: onShouldStartLoadWithRequest greift bei 3xx-Redirects
    // (z. B. m.youtube.com/redirect, l.instagram.com) nicht — hier hart zurücksetzen,
    // falls eine fremde Origin durchgerutscht ist.
    try {
      if (!ALLOWED_ORIGINS.includes(new URL(nav.url).origin)) {
        webviewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(PLATFORM_URLS[platform])}; true;`
        );
        return;
      }
    } catch {
      return;
    }
    // SPA-Route-Wechsel: filter.js soll neu scannen (idempotent).
    if (nav.url !== url) {
      webviewRef.current?.injectJavaScript(`window.dispatchEvent(new Event('dull-navigation')); true;`);
    }
    setUrl(nav.url);
    setLoading(nav.loading);
  }

  return (
    <View style={styles.root}>
      {/* Plattform-Picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!(locked || intervention)}
        pointerEvents={locked || intervention ? "none" : "auto"}
        style={styles.pickerWrap}
      >
        {PLATFORMS.map((p) => {
          const active = p.key === platform;
          return (
            <Pressable key={p.key} onPress={() => void selectPlatform(p.key)} style={styles.pick}>
              <Text style={[styles.pickText, active && styles.pickTextActive]}>{p.label}</Text>
              {active && <View style={styles.pickDot} />}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* WebView mit injizierten Feed-Filtern (versteckt, solange gesperrt) */}
      <View style={styles.webview}>
        {!locked && (
          <WebView
            key={key}
            ref={webviewRef}
            source={{ uri: PLATFORM_URLS[platform] }}
            userAgent={MOBILE_UA}
            originWhitelist={ALLOWED_ORIGINS}
            onShouldStartLoadWithRequest={(req) => {
              try {
                const u = new URL(req.url);
                // Nur http/https — custom schemes (youtube://, instagram://, …) öffnen
                // sonst die native App / Safari. App-Store-Links ebenso blocken.
                if (u.protocol !== "http:" && u.protocol !== "https:") return false;
                if (/apps\.apple\.com|itunes\.apple\.com/i.test(u.hostname)) return false;
                // pathname iterativ dekodieren (Doppel-Encoding wie /%2572edirect umgehen);
                // Fehler → fail-closed blocken.
                let path = u.pathname;
                let prev = "";
                while (path !== prev) {
                  prev = path;
                  try {
                    path = decodeURIComponent(path);
                  } catch {
                    return false;
                  }
                }
                // Redirect-Endpunkt präventiv blocken (Ziel immer extern, umgeht Policy-Prüfung).
                if (REDIRECT_PATH_RE.test(path)) return false;
                return ALLOWED_ORIGINS.includes(u.origin);
              } catch {
                return false;
              }
            }}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows={false}
            injectedJavaScriptBeforeContentLoaded={before}
            injectedJavaScript={injected}
            onMessage={onMessage}
            onNavigationStateChange={onNav}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => setLoading(false)}
            style={styles.webviewInner}
          />
        )}
        {loading && !locked && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={C.dot} />
          </View>
        )}

        {/* Lock-Overlay: Tageslimit erreicht */}
        {locked && !intervention && (
          <View style={styles.lockOverlay}>
            <Text style={styles.lockTitle}>TAGESLIMIT ERREICHT</Text>
            <Text style={styles.lockSub}>
              {formatRation(entry.limitSeconds)} / TAG · RESETS UM MITTERNACHT
            </Text>
            <View style={styles.lockActions}>
              {[5, 10, 15, 30].map((m) => {
                const active = unlockMinutes === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setUnlockMinutes(m)}
                    style={[styles.lockChip, active && styles.lockChipActive]}
                  >
                    <Text style={[styles.lockChipText, active && styles.lockChipTextActive]}>
                      {m} MIN
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setIntervention(true)} style={styles.lockGo}>
              <Text style={styles.lockGoText}>ATMEN & ENTSPERREN</Text>
            </Pressable>
          </View>
        )}

        {/* Intervention (Atmung) vor dem Freischalten — one sec-Muster */}
        {intervention && (
          <Breathing
            onDone={() => {
              setIntervention(false);
              void doUnlock(unlockMinutes);
            }}
            onSkip={() => setIntervention(false)}
          />
        )}
      </View>

      {/* Status + Nav */}
      <View style={styles.bar}>
        <Text style={styles.status}>
          {blocked > 0
            ? `${blocked} ENTFERNT · ${formatCountdown(remaining)} ÜBRIG`
            : unlockLeft > 0
            ? `ENTSPERRT · ${formatCountdown(unlockLeft)}`
            : `${formatCountdown(remaining)} ÜBRIG`}
        </Text>
        <View style={styles.nav}>
          {unlockLeft > 0 ? (
            <Pressable onPress={() => void doRelock()} style={styles.navBtn}>
              <Text style={styles.relockText}>⏻</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => webviewRef.current?.goBack()} style={styles.navBtn}>
            <Text style={styles.navText}>‹</Text>
          </Pressable>
          <Pressable onPress={() => webviewRef.current?.reload()} style={styles.navBtn}>
            <Text style={styles.navText}>↻</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              webviewRef.current?.injectJavaScript(
                `window.location.href = ${JSON.stringify(PLATFORM_URLS[platform])}; true;`
              );
            }}
            style={styles.navBtn}
          >
            <Text style={styles.navText}>⌂</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pickerWrap: { flexGrow: 0, borderBottomWidth: 1, borderColor: C.border },
  pick: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pickText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
  },
  pickTextActive: { color: C.text },
  pickDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.dot, marginTop: 5 },
  webview: { flex: 1, backgroundColor: C.bg },
  webviewInner: { backgroundColor: C.bg },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  lockOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
  lockTitle: {
    fontFamily: "Ndot57",
    fontSize: 28,
    color: C.text,
    letterSpacing: 4,
    textAlign: "center",
  },
  lockSub: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
    textAlign: "center",
  },
  lockActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  lockChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lockChipActive: { borderColor: C.dot, backgroundColor: C.dot },
  lockChipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 1,
  },
  lockChipTextActive: { color: C.bg, fontWeight: "700" },
  lockGo: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 18,
    alignItems: "center",
  },
  lockGoText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  status: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 2,
  },
  nav: { flexDirection: "row", gap: 6 },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { color: C.text, fontSize: 20, lineHeight: 24 },
  relockText: { color: C.text2, fontSize: 16 },
});
