import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  DEFAULT_FILTER_CONFIG,
  PLATFORM_URLS,
  buildBeforeContentScript,
  buildInjectedScript,
  type Platform,
} from "../lib/browser";

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

export default function Browser() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(0);
  const [url, setUrl] = useState("");
  const webviewRef = useRef<WebView>(null);

  // Key erzwingt Neu-Mount bei Plattform-Wechsel (frische Session, keine Alt-State).
  const key = platform;

  const cfg = DEFAULT_FILTER_CONFIG;
  const before = useMemo(() => buildBeforeContentScript(cfg), []);
  const injected = useMemo(() => buildInjectedScript(platform, cfg), [platform]);

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerWrap}>
        {PLATFORMS.map((p) => {
          const active = p.key === platform;
          return (
            <Pressable key={p.key} onPress={() => { setPlatform(p.key); setBlocked(0); setLoading(true); }} style={styles.pick}>
              <Text style={[styles.pickText, active && styles.pickTextActive]}>{p.label}</Text>
              {active && <View style={styles.pickDot} />}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* WebView mit injizierten Feed-Filtern */}
      <View style={styles.webview}>
        <WebView
          key={key}
          ref={webviewRef}
          source={{ uri: PLATFORM_URLS[platform] }}
          userAgent={MOBILE_UA}
          originWhitelist={ALLOWED_ORIGINS}
          onShouldStartLoadWithRequest={(req) => {
            try {
              const u = new URL(req.url);
              // pathname ist prozent-kodiert → dekodieren, sonst umgeht /%72edirect den Block.
              const path = decodeURIComponent(u.pathname);
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
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={C.dot} />
          </View>
        )}
      </View>

      {/* Status + Nav */}
      <View style={styles.bar}>
        <Text style={styles.status}>
          {blocked > 0 ? `${blocked} ENTFERNT` : "FILTER AKTIV"}
        </Text>
        <View style={styles.nav}>
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
});
