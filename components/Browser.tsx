import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { accessMessage, accessState } from "../lib/access";
import {
  DEFAULT_FILTER_CONFIG,
  PLATFORM_URLS,
  buildBeforeContentScript,
  buildEarlyCssScript,
  buildInjectedScript,
  type FilterConfig,
  type Platform,
} from "../lib/browser";
import { buildCaptureScript, buildFillScript } from "../lib/autofill";
import { loadCommitment } from "../lib/commitmentStore";
import { loadFilterConfig } from "../lib/filterStore";
import { addUsage, ensureLimit, relock, unlockFor, type LimitState } from "../lib/limitStore";
import { formatCountdown, formatRation, freshEntry, unlockRemaining } from "../lib/limits";
import {
  cooldownRemaining,
  sessionRemaining,
  MINUTE_MS,
  type QuietHours,
  type PostingQuota,
  type SessionSettings,
  emptyPosting,
  emptyQuietHours,
} from "../lib/schedule";
import { loadPosting, loadQuietHours } from "../lib/scheduleStore";
import {
  getSessionStartedAt,
  getUnlockedAt,
  loadSessionSettings,
  markSessionStarted,
  markUnlocked,
} from "../lib/sessionStore";
import { loadPostingUsage, openPostingWindow, type PostingUsage } from "../lib/postingStore";
import { isInAppAllowed } from "../lib/urlPolicy";
import { todayKey } from "../lib/streak";
import { hasPin, verifyPin } from "../lib/streakStore";
import {
  baseDomain,
  canFillOn,
  credentialsForHost,
  hostOf,
  normalizeCredential,
  type Credential,
} from "../lib/vault";
import { deleteCredential, loadVault, saveCredential } from "../lib/vaultStore";
import Breathing from "./Breathing";
import VaultSheet, { type VaultOffer } from "./VaultSheet";

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

// Nutzung alle 30 s persistieren (Rebase), damit ein App-Kill max. 30 s verliert.
const CHECKPOINT_MS = 30_000;
// Chrome (Status/Nav) blendet sich nach dieser Zeit aus → fast Vollbild.
const CHROME_IDLE_MS = 5_000;

type Props = { onExit: () => void };

export default function Browser({ onExit }: Props) {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(0);
  const [url, setUrl] = useState("");

  // Zugangs-Ebenen
  const [limits, setLimits] = useState<LimitState>({});
  const [now, setNow] = useState(() => Date.now());
  const [intervention, setIntervention] = useState(false);
  const [unlockMinutes, setUnlockMinutes] = useState(15);
  const [pinStep, setPinStep] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [session, setSession] = useState<SessionSettings>({ cooldownMin: 0, sessionLimitMin: 0 });
  const [quiet, setQuiet] = useState<QuietHours>(() => emptyQuietHours());
  const [posting, setPosting] = useState<PostingQuota>(() => emptyPosting());
  const [postingUsage, setPostingUsage] = useState<PostingUsage>(() => ({
    day: todayKey(),
    used: 0,
    until: 0,
  }));
  const [hardLockedUntil, setHardLockedUntil] = useState(0);
  const [stateLocked, setStateLocked] = useState(false);
  const [manualLocked, setManualLocked] = useState(false);
  const [unlockedAt, setUnlockedAt] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [filterCfg, setFilterCfg] = useState<FilterConfig>(DEFAULT_FILTER_CONFIG);

  // Passwort-Tresor
  const [vault, setVault] = useState<Credential[]>([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [offer, setOffer] = useState<VaultOffer | null>(null);

  const sessionStartRef = useRef(Date.now());
  const sessionBaseRef = useRef(0);
  const pausedRef = useRef(false);
  const platformRef = useRef<Platform>("youtube");
  const webviewRef = useRef<WebView>(null);
  const flushChainRef = useRef<Promise<void>>(Promise.resolve());
  const lockEpochRef = useRef(0);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef("");

  // Key erzwingt Neu-Mount bei Plattform-Wechsel (frische Session, keine Alt-State).
  const key = platform;

  // Reihenfolge: Config+Bridge → frühes CSS (kein Aufblitzen) → Login-Capture.
  const before = useMemo(
    () =>
      [
        buildBeforeContentScript(filterCfg),
        buildEarlyCssScript(platform),
        buildCaptureScript(),
      ].join("\n"),
    [filterCfg, platform],
  );
  const injected = useMemo(() => buildInjectedScript(platform, filterCfg), [platform, filterCfg]);

  // ── abgeleitete Werte ───────────────────────────────────────────────────────
  const entry = limits[platform] || freshEntry(platform, todayKey());
  const elapsed = pausedRef.current
    ? 0
    : Math.max(0, Math.floor((now - sessionStartRef.current) / 1000));
  const usedTotal = sessionBaseRef.current + elapsed;
  const unlockLeft = unlockRemaining(entry, now);
  const cooldownLeft = cooldownRemaining(unlockedAt, session.cooldownMin * MINUTE_MS, now);
  const sessionLimitMs = session.sessionLimitMin * MINUTE_MS;
  // Ohne gestartete Sitzung (startedAt = 0) läuft kein Timer — sonst wäre der
  // Browser direkt nach dem Start gesperrt.
  const sessionLeftMs =
    sessionLimitMs <= 0
      ? 0
      : startedAt > 0
        ? sessionRemaining(startedAt, sessionLimitMs, now)
        : sessionLimitMs;

  const access = accessState({
    now,
    entry: { ...entry, usedSeconds: usedTotal },
    quiet,
    posting,
    postingUsed: postingUsage.used,
    postingUntil: postingUsage.until,
    hardLockedUntil,
    manualLocked,
    cooldownLeftMs: cooldownLeft,
    sessionLeftMs,
    sessionLimitMs,
  });

  // Sperre gilt auch, wenn der Speicher-Status nicht gelesen/geschrieben werden
  // konnte (fail-closed statt frischer Ration).
  const locked = access.locked || stateLocked;

  const baseHost = hostOf(url);
  const storedCreds = useMemo(() => credentialsForHost(vault, baseHost), [vault, baseHost]);
  const existingOffer = offer
    ? storedCreds.some((c) => c.username === offer.username)
    : false;

  const showChrome = useCallback(() => {
    setChrome(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = setTimeout(() => setChrome(false), CHROME_IDLE_MS);
  }, []);

  // Verbrauchte Sekunden persistieren + Session neu basieren.
  // Serialisiert (Chain), damit parallele Checkpoints nicht doppelt zählen;
  // pausiert bei Sperre (kein Phantom-Verbrauch).
  const flushUsage = useCallback((): Promise<void> => {
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
  }, []);

  // Alle Einstellungen/States neu laden (Mount, App-Fokus, Plattformwechsel).
  // WICHTIG: Ein Lese-/Schreibfehler im Storage darf NICHT auf eine frische
  // Ration zurückfallen (usedSeconds=0 = fail-open). Dann bleibt der Zugang
  // gesperrt, bis der Zustand wieder lesbar ist (stateLocked).
  const reloadAll = useCallback(async (p: Platform) => {
    try {
      const [st, s, ua, sa, q, pq, pu, cm, fc, v] = await Promise.all([
        ensureLimit(p),
        loadSessionSettings(),
        getUnlockedAt(),
        getSessionStartedAt(),
        loadQuietHours(),
        loadPosting(),
        loadPostingUsage(),
        loadCommitment(),
        loadFilterConfig(),
        loadVault(),
      ]);
      setLimits(st);
      setSession(s);
      setUnlockedAt(ua);
      setStartedAt(sa);
      setQuiet(q);
      setPosting(pq);
      setPostingUsage(pu);
      setHardLockedUntil(cm.filterLockedUntil[p] || 0);
      setFilterCfg(fc);
      setVault(v);
      sessionStartRef.current = Date.now();
      sessionBaseRef.current = (st[p] || freshEntry(p, todayKey())).usedSeconds;
      setStateLocked(false);
    } catch {
      setStateLocked(true);
    }
  }, []);

  // Initial laden.
  useEffect(() => {
    void reloadAll("youtube").catch(() => {});
    return () => {
      void flushUsage().catch(() => {});
    };
  }, [flushUsage, reloadAll]);

  // 1s-Tick für Countdown + Live-Anzeige.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Checkpoint: alle 30 s persistieren.
  useEffect(() => {
    const t = setInterval(() => void flushUsage().catch(() => {}), CHECKPOINT_MS);
    return () => clearInterval(t);
  }, [flushUsage]);

  // Chrome-Auto-Hide anstoßen.
  useEffect(() => {
    showChrome();
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [showChrome]);

  // Hintergrund/Display aus: Nutzung nicht weiterzählen (sonst Limit ohne Nutzung weg).
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") {
        pausedRef.current = false;
        sessionStartRef.current = Date.now();
        setNow(Date.now());
        void reloadAll(platformRef.current).catch(() => {});
      } else {
        void flushUsage().then(() => {
          pausedRef.current = true;
        });
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [flushUsage, reloadAll]);

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

  // Session-Timer: bei abgelaufener Max-Dauer automatisch wieder sperren.
  useEffect(() => {
    if (!access.sessionOver) return;
    if (session.sessionLimitMin <= 0 || startedAt <= 0) return;
    void doRelock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.sessionOver, session.sessionLimitMin, startedAt]);

  async function selectPlatform(p: Platform) {
    try {
      await flushUsage();
      platformRef.current = p;
      urlRef.current = "";
      await reloadAll(p);
      setPlatform(p);
      setBlocked(0);
      setLoading(true);
      setUrl("");
      setPickerOpen(false);
      showChrome();
    } catch {
      /* ignorieren — Plattform-Wechsel bleibt aus */
    }
  }

  // Freischalten: nur nach Atem-Intervention UND PIN (wenn eine gesetzt ist).
  async function startUnlock() {
    setPinError(null);
    setPinValue("");
    const pinned = await hasPin();
    if (!pinned) {
      await doUnlock(unlockMinutes);
      return;
    }
    setPinStep(true);
  }

  async function submitPin() {
    if (pinValue.length !== 4 || pinBusy) return;
    setPinBusy(true);
    setPinError(null);
    try {
      const ok = await verifyPin(pinValue);
      if (!ok) {
        setPinError("PIN FALSCH");
        setPinValue("");
        return;
      }
      setPinStep(false);
      setPinValue("");
      await doUnlock(unlockMinutes);
    } catch {
      setPinError("PIN-PRÜFUNG FEHLGESCHLAGEN");
    } finally {
      setPinBusy(false);
    }
  }

  async function doUnlock(minutes: number) {
    try {
      lockEpochRef.current++; // ausstehende Pause invalidieren
      setManualLocked(false);
      const st = await unlockFor(platform, minutes);
      setLimits(st);
      pausedRef.current = false;
      sessionStartRef.current = Date.now();
      const t = Date.now();
      setUnlockedAt(t);
      setStartedAt(t);
      void markUnlocked(t);
      void markSessionStarted(t);
      setNow(t);
    } catch {
      setIntervention(false); // zurück ins Lock-Overlay statt hängen zu bleiben
    }
  }

  async function doRelock() {
    try {
      const st = await relock(platform);
      setLimits(st);
      const t = Date.now();
      setUnlockedAt(t);
      setStartedAt(0);
      void markUnlocked(t); // persistieren: sonst hebt AppState-Reload den Cooldown auf
      void markSessionStarted(0);
    } catch {
      /* ignorieren — UI bleibt auf altem Stand */
    }
  }

  // Posting-Fenster (Scheduled Access) öffnen.
  async function openWindow() {
    const next = await openPostingWindow(posting);
    if (!next) return;
    setManualLocked(false);
    setPostingUsage(next);
    const t = Date.now();
    setStartedAt(t);
    void markSessionStarted(t);
  }

  function onMessage(e: { nativeEvent: { data: string } }) {
    let m: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(e.nativeEvent.data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        m = parsed as Record<string, unknown>;
      }
    } catch {
      return;
    }
    if (!m) return;

    // 1) Block-Zähler der aktiven Plattform (Fremdseiten werden ignoriert).
    if (m.platform === platformRef.current && typeof m.count === "number" && Number.isFinite(m.count)) {
      setBlocked(Math.max(0, Math.min(Math.floor(m.count as number), 100000)));
      return;
    }

    // 2) Health-Check von filter.js: CSS/JS nachinjizieren, wenn es verschwunden ist.
    if (typeof m.reason === "string" && m.platform === platformRef.current) {
      try {
        webviewRef.current?.injectJavaScript(injected);
      } catch {
        /* WebView evtl. gerade nicht da */
      }
      return;
    }

    // 3) Login-Angebot aus dem WebView — nur für die tatsächlich geladene Domain.
    if (m.type === "pbVaultOffer") {
      const msgHost = typeof m.host === "string" ? baseDomain(m.host) : "";
      if (!msgHost || !baseHost || msgHost !== baseHost) return;
      const c = normalizeCredential({
        host: msgHost,
        username: typeof m.username === "string" ? m.username : "",
        secret: typeof m.secret === "string" ? m.secret : "",
      });
      if (!c) return;
      // Bereits identisch gespeichert? Dann nicht erneut fragen.
      if (storedCreds.some((x) => x.username === c.username && x.secret === c.secret)) return;
      setOffer({ username: c.username, secret: c.secret });
      setVaultOpen(true);
      return;
    }
  }

  function onNav(nav: WebViewNavigation) {
    if (!nav.url || nav.url === "about:blank") return;
    if (nav.url !== urlRef.current) {
      urlRef.current = nav.url;
      webviewRef.current?.injectJavaScript(
        `window.dispatchEvent(new Event('dull-navigation')); true;`,
      );
    }
    setUrl(nav.url);
    setLoading(nav.loading);
  }

  async function onSaveOffer() {
    if (!offer || !baseHost) return;
    const c = normalizeCredential({
      host: baseHost,
      username: offer.username,
      secret: offer.secret,
      updatedAt: Date.now(),
    });
    if (!c) return;
    const vs = await saveCredential(c);
    setVault(vs);
    setOffer(null);
    setVaultOpen(false);
  }

  async function onDeleteCred(c: Credential) {
    const vs = await deleteCredential(c.host, c.username);
    setVault(vs);
  }

  function onFillCred(c: Credential) {
    // Anti-Leak: nur in die Domain, für die der Eintrag gilt.
    if (!canFillOn(vault, baseHost, c.username)) return;
    // Bei harter/Zeit-Sperre ist die WebView nicht gemountet — nicht hineinfüllen.
    if (locked) {
      setVaultOpen(false);
      return;
    }
    try {
      webviewRef.current?.injectJavaScript(buildFillScript(c.host, c.username, c.secret));
    } catch {
      /* WebView weg → nichts tun */
    }
    setVaultOpen(false);
    showChrome();
  }

  const lockTitle = stateLocked
    ? "SPEICHERFEHLER"
    : manualLocked
      ? "GESPERRT"
      : accessMessage(access, entry);
  const hardLeft = Math.ceil(access.hardLockLeftMs / 1000);
  const postingLeft = access.postingLeftSec;

  return (
    <View style={styles.root}>
      {/* WebView füllt den ganzen Screen (fast Vollbild) */}
      <View style={styles.webview}>
        {!locked && (
          <WebView
            key={key}
            ref={webviewRef}
            source={{ uri: PLATFORM_URLS[platform] }}
            userAgent={MOBILE_UA}
            // Nur http/https und keine Handoff-/Redirect-Ziele: custom schemes
            // (youtube://, instagram:// …) würden die native App oder Safari öffnen.
            // Alle erlaubten http(s)-Origins bleiben in der App (Login-Subdomains).
            onShouldStartLoadWithRequest={(req) => isInAppAllowed(req.url)}
            onOpenWindow={(e) => {
              // window.open / target=_blank: IMMER in derselben WebView laden,
              // nie an Safari oder die native App abgeben.
              const t = e.nativeEvent.targetUrl;
              if (!t || !isInAppAllowed(t)) return;
              webviewRef.current?.injectJavaScript(
                `window.location.href = ${JSON.stringify(t)}; true;`,
              );
            }}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            allowsBackForwardNavigationGestures
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows={false}
            injectedJavaScriptBeforeContentLoaded={before}
            injectedJavaScript={injected}
            onMessage={onMessage}
            onNavigationStateChange={onNav}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => {
              setLoading(false);
              showChrome();
            }}
            onError={() => setLoading(false)}
            style={styles.webviewInner}
          />
        )}
        {loading && !locked && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={C.dot} />
          </View>
        )}

        {/* Kopf-Buttons: Plattform-Auswahl + Verlassen (immer sichtbar, klein) */}
        <SafeAreaView style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.pill}>
              <Text style={styles.pillText}>{pickerOpen ? "SCHLIESSEN" : "APPS"}</Text>
            </Pressable>
            <View style={styles.topRight}>
              <Pressable
                onPress={() => {
                  setVaultOpen(true);
                  showChrome();
                }}
                style={styles.pill}
              >
                <Text style={styles.pillText}>
                  🔑{storedCreds.length > 0 ? ` ${storedCreds.length}` : ""}
                </Text>
              </Pressable>
              <Pressable onPress={onExit} style={styles.pill}>
                <Text style={styles.pillText}>✕</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>

        {/* Plattform-Picker als Overlay (fast Vollbild bleibt erhalten) */}
        {pickerOpen && (
          <View style={styles.pickerOverlay}>
            <ScrollView contentContainerStyle={styles.pickerList}>
              {PLATFORMS.map((p) => {
                const active = p.key === platform;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => void selectPlatform(p.key)}
                    style={[styles.pickCard, active && styles.pickCardActive]}
                  >
                    <Text style={[styles.pickLabel, active && styles.pickLabelActive]}>
                      {p.label}
                    </Text>
                    <Text style={styles.pickSub}>
                      {formatRation(
                        (limits[p.key] || freshEntry(p.key, todayKey())).limitSeconds,
                      )}{" "}
                      / TAG
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Lock-Overlay: harte Sperre / Zeitsperre / Session / Tageslimit */}
        {locked && !intervention && !pinStep && (
          <View style={styles.lockOverlay}>
            <Text style={styles.lockTitle}>{lockTitle}</Text>
            <Text style={styles.lockSub}>
              {stateLocked
                ? "NUTZUNG NICHT LESBAR · ZUGANG GESPERRT, BIS DER STATUS WIEDER DA IST"
                : manualLocked
                ? "MANUELL GESPERRT · ENTSPERREN NUR MIT ATMEN + PIN"
                : access.reason === "hardlock"
                ? `NOCH ${formatCountdown(hardLeft)} · COMMITMENT-SPERRE`
                : access.reason === "quiet"
                  ? "JEDEN TAG · KEIN UMGEHEN"
                  : access.reason === "session"
                    ? `SITZUNG ${session.sessionLimitMin} MIN · LIMIT ${formatRation(entry.limitSeconds)}/TAG`
                    : `${formatRation(entry.limitSeconds)} / TAG · RESETS UM MITTERNACHT`}
            </Text>

            {access.reason === "daily" || access.reason === "session" ? (
              <>
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
                {access.inCooldown ? (
                  <Text style={styles.lockSub}>
                    COOLDOWN · {formatCountdown(Math.ceil(cooldownLeft / 1000))} BIS ZUR NÄCHSTEN
                    ENTSPERRUNG
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => setIntervention(true)}
                  style={[styles.lockGo, !access.canUnlock && styles.lockGoDisabled]}
                  disabled={!access.canUnlock}
                >
                  <Text style={styles.lockGoText}>
                    {access.canUnlock ? "ATMEN, PIN & ENTSPERREN" : "COOLDOWN AKTIV"}
                  </Text>
                </Pressable>
                {access.canOpenWindow && posting.timesPerDay > 0 ? (
                  <Pressable onPress={() => void openWindow()} style={styles.lockSecondary}>
                    <Text style={styles.lockSecondaryText}>
                      ZEITFENSTER ÖFFNEN · {posting.durationMin} MIN · {access.windowsLeft} VON{" "}
                      {posting.timesPerDay} ÜBRIG
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {access.reason === "hardlock" ? (
              <Text style={styles.lockSub}>EINSTELLUNGEN → MEHR → COMMIT</Text>
            ) : null}

            <Pressable onPress={onExit} style={styles.lockExit}>
              <Text style={styles.lockExitText}>VERLASSEN</Text>
            </Pressable>
          </View>
        )}

        {/* Atem-Intervention (one sec-Muster) */}
        {intervention && (
          <Breathing
            onDone={() => {
              setIntervention(false);
              void startUnlock();
            }}
            onSkip={() => setIntervention(false)}
          />
        )}

        {/* PIN-Bestätigung: harte Freischaltung */}
        {pinStep && (
          <View style={styles.lockOverlay}>
            <Text style={styles.lockTitle}>PIN</Text>
            <Text style={styles.lockSub}>4 ZIFFERN ZUM ENTSPERREN</Text>
            <TextInput
              value={pinValue}
              onChangeText={(t) => setPinValue(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              maxLength={4}
              style={styles.pinInput}
              onSubmitEditing={() => void submitPin()}
            />
            {pinError ? <Text style={styles.lockSub}>{pinError}</Text> : null}
            <Pressable
              onPress={() => void submitPin()}
              style={[styles.lockGo, pinValue.length !== 4 && styles.lockGoDisabled]}
              disabled={pinValue.length !== 4 || pinBusy}
            >
              <Text style={styles.lockGoText}>{pinBusy ? "PRÜFE…" : "ENTSPERREN"}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPinStep(false);
                setPinValue("");
                setPinError(null);
              }}
              style={styles.lockExit}
            >
              <Text style={styles.lockExitText}>ABBRECHEN</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Status + Navigation: Auto-Hide für fast Vollbild, Tap am Rand holt sie zurück */}
      {chrome && !locked && !pinStep && !intervention ? (
        <SafeAreaView style={styles.bottomWrap} pointerEvents="box-none">
          <View style={styles.bar}>
            <Text style={styles.status} numberOfLines={1}>
              {baseHost ? `${baseHost} · ` : ""}
              {postingLeft > 0
                ? `FENSTER ${formatCountdown(postingLeft)}`
                : unlockLeft > 0
                  ? `ENTSPERRT ${formatCountdown(unlockLeft)}`
                  : `${formatCountdown(access.remainingSec)} ÜBRIG`}
              {blocked > 0 ? ` · ${blocked}✕` : ""}
            </Text>
            <View style={styles.nav}>
              {unlockLeft > 0 ? (
                <Pressable
                  onPress={() => {
                    setManualLocked(true);
                    void doRelock();
                  }}
                  style={styles.navBtn}
                >
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
                    `window.location.href = ${JSON.stringify(PLATFORM_URLS[platform])}; true;`,
                  );
                }}
                style={styles.navBtn}
              >
                <Text style={styles.navText}>⌂</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Schmaler Tap-Streifen unten: Chrome einblenden ohne die Seite zu blockieren */}
      {!chrome && !locked && !pinStep && !intervention ? (
        <Pressable onPress={showChrome} style={styles.revealStrip}>
          <View style={styles.revealDot} />
        </Pressable>
      ) : null}

      <VaultSheet
        visible={vaultOpen}
        host={baseHost}
        credentials={storedCreds}
        offer={offer}
        existing={existingOffer}
        onClose={() => {
          setVaultOpen(false);
          setOffer(null);
        }}
        onFill={onFillCred}
        onDelete={(c) => void onDeleteCred(c)}
        onSaveOffer={() => void onSaveOffer()}
        onDismissOffer={() => {
          setOffer(null);
          setVaultOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
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
  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  topRight: { flexDirection: "row", gap: 8 },
  pill: {
    backgroundColor: "rgba(0,0,0,0.66)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text, letterSpacing: 2 },
  pickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
  },
  pickerList: { paddingHorizontal: 24, paddingVertical: 40, gap: 12 },
  pickCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: C.surface,
  },
  pickCardActive: { borderColor: C.dot, backgroundColor: C.surface2 },
  pickLabel: {
    fontFamily: "Ndot57",
    fontSize: 22,
    color: C.text2,
    letterSpacing: 3,
  },
  pickLabelActive: { color: C.text },
  pickSub: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 4,
  },
  lockOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: C.bg,
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
  lockChipText: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text2, letterSpacing: 1 },
  lockChipTextActive: { color: C.bg, fontWeight: "700" },
  lockGo: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 18,
    alignItems: "center",
  },
  lockGoDisabled: { backgroundColor: C.border },
  lockGoText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 13,
    color: C.bg,
    letterSpacing: 2,
    fontWeight: "700",
  },
  lockSecondary: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 4,
  },
  lockSecondaryText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 2,
    textAlign: "center",
  },
  lockExit: { marginTop: 22, paddingHorizontal: 16, paddingVertical: 10 },
  lockExitText: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text3, letterSpacing: 2 },
  pinInput: {
    borderBottomWidth: 1,
    borderColor: C.border,
    color: C.text,
    fontFamily: "Ndot57",
    fontSize: 34,
    letterSpacing: 12,
    textAlign: "center",
    minWidth: 190,
    marginTop: 18,
    paddingVertical: 8,
  },
  bottomWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderTopWidth: 1,
    borderColor: C.border,
  },
  status: { fontFamily: "SpaceGrotesk", fontSize: 11, color: C.text2, letterSpacing: 2, flex: 1 },
  nav: { flexDirection: "row", gap: 6, marginLeft: 8 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { color: C.text, fontSize: 18, lineHeight: 22 },
  relockText: { color: C.text2, fontSize: 15 },
  revealStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  revealDot: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
