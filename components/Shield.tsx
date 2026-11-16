import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ALL_PLATFORMS, PLATFORM_DOMAINS, normalizeCustomDomain } from "../lib/dnsBlocklist";
import type { Platform } from "../lib/browser";
import { dnsBlockingAvailable, dnsBlockingStatus, type DnsMode } from "../lib/vpn";
import { applyDnsSettings, loadDnsSettings, saveDnsSettings, stopDns } from "../lib/dnsSettings";
import { AD_DOMAIN_COUNT } from "../lib/adBlocklist";

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
// Blockt Plattform-Domains UND (optional) die Werbe-/Tracker-Liste über DNS —
// gilt app-übergreifend (auch native Apps), nicht nur im eingebauten Browser.
// Die Einstellungen liegen in lib/dnsSettings.ts, damit der APPS-Tab denselben
// Zustand schalten kann.

export default function Shield() {
  const available = dnsBlockingAvailable();
  const busyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Welche Plattformen sollen systemweit gesperrt werden (persistiert).
  const [selected, setSelected] = useState<Platform[]>(ALL_PLATFORMS);
  // "blocklist" = nur die Plattformen sperren, "allowlist" = Internet aus.
  const [mode, setMode] = useState<DnsMode>("blocklist");
  // Werbe-/Tracker-Domains zusätzlich blocken (unabhängig von den Plattformen).
  const [ads, setAds] = useState(true);
  // Eigene Domains ("add block") — zusätzlich zu den Plattform-Domains.
  const [custom, setCustom] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");

  async function refresh() {
    try {
      const s = await dnsBlockingStatus();
      setConnected(s.connected);
      setStatus(s.status ?? "");
    } catch {
      setConnected(false);
      setStatus("unavailable");
    }
  }

  // Auswahl laden (kaputte/leere Werte → Defaults).
  useEffect(() => {
    (async () => {
      const settings = await loadDnsSettings();
      setSelected(settings.platforms);
      setMode(settings.mode);
      setAds(settings.ads);
      setCustom(settings.custom);
    })();
  }, []);

  async function changeMode(next: DnsMode) {
    if (busy || next === mode) return;
    setMode(next);
    try {
      await saveDnsSettings({ platforms: selected, mode: next, ads, custom });
    } catch {
      /* best effort */
    }
    // Laufenden Tunnel sofort umstellen.
    if (connected) {
      try {
        await applyDnsSettings({ platforms: selected, mode: next, ads, custom });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** Werbe-/Tracker-Liste schalten (gilt für alle Apps). */
  async function toggleAds() {
    if (busy) return;
    const next = !ads;
    setAds(next);
    try {
      await saveDnsSettings({ platforms: selected, mode, ads: next, custom });
    } catch {
      /* best effort */
    }
    if (connected) {
      try {
        if (mode === "blocklist" && selected.length === 0 && !next && custom.length === 0) await stopDns();
        else await applyDnsSettings({ platforms: selected, mode, ads: next, custom });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function togglePlatform(p: Platform) {
    if (busy) return;
    const next = selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p];
    setSelected(next);
    try {
      await saveDnsSettings({ platforms: next, mode, ads, custom });
    } catch {
      /* best effort */
    }
    // Laufenden Tunnel sofort mit der neuen Liste versorgen.
    if (connected && (next.length > 0 || ads || custom.length > 0)) {
      try {
        await applyDnsSettings({ platforms: next, mode, ads, custom });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** Eigene Domain hinzufügen ("add block"). */
  async function addDomain() {
    const clean = normalizeCustomDomain(domainInput);
    if (!clean) {
      setError(`"${domainInput}" ist keine Domain — z. B. tiktok.com`);
      return;
    }
    if (custom.includes(clean)) {
      setError(`${clean} ist schon in der Liste.`);
      setDomainInput("");
      return;
    }
    const next = [...custom, clean];
    setCustom(next);
    setDomainInput("");
    setError(null);
    try {
      await saveDnsSettings({ platforms: selected, mode, ads, custom: next });
    } catch {
      /* best effort */
    }
    if (connected) {
      try {
        await applyDnsSettings({ platforms: selected, mode, ads, custom: next });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function removeDomain(d: string) {
    const next = custom.filter((x) => x !== d);
    setCustom(next);
    try {
      await saveDnsSettings({ platforms: selected, mode, ads, custom: next });
    } catch {
      /* best effort */
    }
    if (connected) {
      try {
        await applyDnsSettings({ platforms: selected, mode, ads, custom: next });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  const domainCount = selected.reduce((n, p) => n + PLATFORM_DOMAINS[p].length, 0) + custom.length;

  // Poll-Schleife darf nach dem Unmount nichts mehr setzen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function toggle() {
    if (busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    setError(null);
    try {
      if (connected) {
        await stopDns();
      } else {
        if (selected.length === 0 && !ads && custom.length === 0 && mode === "blocklist") {
          setError("Nichts ausgewählt — Plattformen, eigene Domains oder Werbeblocker einschalten.");
          return;
        }
        await applyDnsSettings({ platforms: selected, mode, ads, custom });
      }
      // Der Tunnel braucht einen Moment (iOS-Dialog + Verbindungsaufbau) →
      // ein paar Mal nachfassen, statt sofort "INAKTIV" anzuzeigen.
      let s = await dnsBlockingStatus();
      for (let i = 0; i < 8 && !s.connected && mountedRef.current; i++) {
        await new Promise((r) => setTimeout(r, 750));
        if (!mountedRef.current) return;
        s = await dnsBlockingStatus();
      }
      if (mountedRef.current) {
        setConnected(s.connected);
        setStatus(s.status ?? "");
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
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
          {(
            [
              ["blocklist", "NUR PLATTFORMEN"],
              ["allowlist", "INTERNET AUS"],
            ] as const
          ).map(([m, label]) => (
            <Pressable
              key={m}
              onPress={() => void changeMode(m)}
              disabled={busy}
              style={[styles.chip, mode === m && styles.chipOn]}
            >
              <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.chips}>
          <Pressable onPress={() => void toggleAds()} disabled={busy} style={[styles.chip, ads && styles.chipOn]}>
            <Text style={[styles.chipText, ads && styles.chipTextOn]}>WERBUNG + TRACKER</Text>
          </Pressable>
        </View>

        <View style={styles.chips}>
          {ALL_PLATFORMS.map((p) => {
            const on = selected.includes(p);
            return (
              <Pressable
                key={p}
                onPress={() => void togglePlatform(p)}
                disabled={busy}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {LABELS[p] ?? p.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.meta}>
          {mode === "allowlist"
            ? "ALLES GESPERRT (kein DNS) — nur Ausnahmen kommen durch"
            : `${selected.length} PLATTFORMEN · ${domainCount} + ${ads ? AD_DOMAIN_COUNT.toLocaleString("de-DE") : 0} WERBE-DOMAINS`}
          {status ? ` · ${status.toUpperCase()}` : ""}
        </Text>

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

      {/* Eigene Domains — "add block" */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>EIGENE DOMAINS</Text>
        <Text style={styles.cardBody}>
          Zusätzlich sperren, was nicht in den Plattform-Listen steht (z. B. tiktok.com,
          twitch.tv, ein Spiele-Server). Gilt systemweit per DNS.
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            value={domainInput}
            onChangeText={setDomainInput}
            onSubmitEditing={() => void addDomain()}
            placeholder="z. B. tiktok.com"
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            style={styles.input}
          />
          <Pressable onPress={() => void addDomain()} disabled={!available || busy} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ BLOCK</Text>
          </Pressable>
        </View>
        {custom.length === 0 ? (
          <Text style={styles.meta}>Noch keine eigene Domain.</Text>
        ) : (
          <View style={styles.chips}>
            {custom.map((d) => (
              <Pressable key={d} onPress={() => void removeDomain(d)} style={[styles.chip, styles.chipOn]}>
                <Text style={[styles.chipText, styles.chipTextOn]}>{d} ✕</Text>
              </Pressable>
            ))}
          </View>
        )}
        {custom.length > 0 ? (
          <Text style={styles.meta}>{custom.length} eigene Domains — Tippen entfernt.</Text>
        ) : null}
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
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontFamily: "SpaceGrotesk",
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  addBtnText: {
    fontFamily: "Ndot57",
    fontSize: 12,
    color: C.text,
    letterSpacing: 2,
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
  chipOn: { borderColor: C.dot, backgroundColor: C.dot },
  chipText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 1,
  },
  chipTextOn: { color: C.bg, fontWeight: "700" },
  meta: {
    fontFamily: "SpaceGrotesk",
    fontSize: 10,
    color: C.text3,
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
