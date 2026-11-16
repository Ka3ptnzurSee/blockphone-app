// components/AppBlocker.tsx — "APPS": beide Blocker unabhängig schaltbar
// (Werbe-/Tracker-DNS-Tunnel UND Screen-Time-App-Sperre) + Pro-App-Limits.
//
// Aufbau:
//   1. BLOCKER   – zwei Schalter: Werbung/Tracker (DNS/VPN) und App-Sperre
//                  (ManagedSettings). Beide einzeln oder gleichzeitig.
//   2. ZUGRIFF   – FamilyControls-Autorisierung.
//   3. AUSWAHL   – System-Picker (vollflächig, Apps/Kategorien/Webseiten).
//   4. LIMITS    – pro App: Tages-/Wochenlimit, Öffnungen/Tag, Pflicht-Pause,
//                  Dauer-Sperre. Änderungen greifen erst nach der Wartezeit.
//   5. WARTEZEIT – 12 h / 1 Tag / 2 Tage.
//
// Durchsetzung: alles über Apples Screen-Time-APIs (ManagedSettingsStore) —
// die Sperre gilt systemweit und auch bei geschlossener App.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyShield,
  clearShield,
  getDenyAppRemoval,
  pickAppsToBlock,
  requestScreenTimeAccess,
  screenTimeAvailable,
  screenTimeStatus,
  screenTimeUnavailableReason,
  selectedAppsCount,
  setDenyAppRemoval,
  shieldApps,
  shieldDiagnostics,
  shieldState,
  type Diagnostics,
  type ShieldState,
} from "../shield/ScreenTimeShield";
import {
  DELAY_PRESETS_H,
  describeRule,
  formatAmount,
  formatRemaining,
  hasRule,
  pendingRemainingMs,
  type AppRule,
  type AppRuleValues,
} from "../lib/appLimits";
import {
  applyDueChanges,
  cancelRulePending,
  loadDelayHours,
  loadRules,
  requestRuleChange,
  saveDelayHours,
} from "../lib/appLimitsStore";
import {
  applyDnsSettings,
  dnsRunning,
  describeDns,
  loadDnsSettings,
  saveDnsSettings,
  stopDns,
  type DnsSettings,
} from "../lib/dnsSettings";
import { AD_DOMAIN_COUNT } from "../lib/adBlocklist";
import { hasPin, verifyPin } from "../lib/streakStore";

/** PIN-Eingabe (iOS) für das Verwerfen eines Antrags. */
function askPin(): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      "PIN",
      "PIN eingeben, um den Antrag zu verwerfen.",
      [
        { text: "Abbrechen", style: "cancel", onPress: () => resolve(null) },
        { text: "Verwerfen", style: "destructive", onPress: (t?: string) => resolve(t ?? null) },
      ],
      "secure-text",
    );
  });
}

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

const MASTER_KEY = "pb-app-shield-master";

type Status = "approved" | "denied" | "notDetermined";

const DAILY = [0, 600, 1200, 1800, 3600, 7200];
const WEEKLY = [0, 3600, 7200, 5 * 3600, 10 * 3600];
const OPENS = [0, 1, 3, 5, 10];
const PAUSE = [0, 60, 300, 900];

export default function AppBlocker() {
  const [status, setStatus] = useState<Status>("notDetermined");
  const [shield, setShield] = useState<ShieldState | null>(null);
  const [dns, setDns] = useState<DnsSettings | null>(null);
  const [dnsOn, setDnsOn] = useState(false);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [denyRemoval, setDenyRemoval] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [master, setMaster] = useState(false);
  const [rules, setRules] = useState<AppRule[]>([]);
  const [delayHours, setDelayHours] = useState(24);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const reload = useCallback(async () => {
    const [s, st, settings, running, delay, masterRaw] = await Promise.all([
      screenTimeStatus(),
      shieldState(),
      loadDnsSettings(),
      dnsRunning(),
      loadDelayHours(),
      AsyncStorage.getItem(MASTER_KEY),
    ]);
    setStatus(s.status);
    setShield(st);
    setDns(settings);
    setDnsOn(running);
    setDelayHours(delay);
    const [d, deny] = await Promise.all([shieldDiagnostics(), getDenyAppRemoval()]);
    setDiag(d);
    setDenyRemoval(deny);
    const savedMaster = masterRaw === "1";
    setMaster(savedMaster || (savedMaster === false && st.active));
    const nextRules = await applyDueChanges(st.selected.apps);
    setRules(nextRules);
    // Abgelaufene Anträge sofort durchsetzen (sonst würde z. B. eine nach
    // Wartezeit fällige Sperre erst beim nächsten Fingertipp greifen).
    try {
      if (savedMaster) await applyShield();
      else await syncShield(false, nextRules);
    } catch {
      /* Sperre darf das Laden nicht blockieren */
    }
  }, []);

  useEffect(() => {
    void reload();
    // Countdown der Wartezeiten jede Sekunde aktualisieren.
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [reload]);

  // ── Blocker 1: Werbung/Tracker (DNS) ───────────────────────────────────────
  const toggleAds = async () => {
    if (!dns || busy) return;
    setBusy("ads");
    setMsg(null);
    try {
      const next: DnsSettings = { ...dns, ads: !dns.ads };
      setDns(next);
      await saveDnsSettings(next);
      if (next.ads || next.platforms.length > 0) {
        await applyDnsSettings(next);
        // Tunnel braucht einen Moment → kurz nachfassen.
        let running = await dnsRunning();
        for (let i = 0; i < 8 && !running; i++) {
          await new Promise((r) => setTimeout(r, 750));
          running = await dnsRunning();
        }
        setDnsOn(running);
        setMsg(running ? "Werbeblocker aktiv (alle Apps, DNS)." : "VPN bestätigen — Tunnel startet.");
      } else {
        await stopDns();
        setDnsOn(false);
        setMsg("Werbeblocker aus.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // ── Blocker 2: App-Sperre (Screen Time) ────────────────────────────────────
  /**
   * Sperre anwenden und das Ergebnis PRÜFEN. Vorher wurden Fehler verschluckt:
   * die UI schrieb „aktiv", im ManagedSettingsStore stand nichts. Jetzt wird
   * `not_applied` (System hat die Sperre nicht übernommen) sichtbar gemeldet.
   */
  const syncShield = async (wantMaster: boolean, list: AppRule[]): Promise<string | null> => {
    const blocked = list.filter((r) => !r.pending && r.blocked).map((r) => r.index);
    const res = wantMaster
      ? await applyShield()
      : blocked.length > 0
        ? await shieldApps(blocked)
        : await clearShield();
    const st = await shieldState();
    setShield(st);
    setDiag(await shieldDiagnostics());
    if (res.shield === "unavailable") {
      return screenTimeUnavailableReason() ?? "Natives Modul fehlt";
    }
    if (res.shield === "no_selection") {
      return "Keine Apps gewählt — erst WÄHLEN (System-Picker), dann sperren.";
    }
    if (res.shield === "not_applied") {
      return "iOS hat die Sperre NICHT übernommen — Bildschirmzeit-Zugriff erlauben (ERLAUBEN) und Gerät neu starten.";
    }
    return null;
  };

  const toggleMaster = async () => {
    if (busy) return;
    setBusy("master");
    setMsg(null);
    try {
      const next = !master;
      if (next && status !== "approved") {
        const r = await requestScreenTimeAccess();
        setStatus(r.status);
        if (r.status !== "approved") {
          setMsg("Bildschirmzeit-Zugriff nötig (Einstellungen → Bildschirmzeit).");
          setBusy(null);
          return;
        }
      }
      const problem = await syncShield(next, rules);
      setMaster(next);
      await AsyncStorage.setItem(MASTER_KEY, next ? "1" : "0");
      setMsg(problem ?? (next ? "App-Sperre aktiv (Bildschirmzeit)." : "App-Sperre aus."));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const grant = async () => {
    setBusy("grant");
    const r = await requestScreenTimeAccess();
    setStatus(r.status);
    setMsg(r.status === "approved" ? "Bildschirmzeit-Zugriff erlaubt." : "Zugriff nicht erteilt.");
    setBusy(null);
  };

  const pick = async () => {
    setBusy("pick");
    setMsg(null);
    try {
      const r = await pickAppsToBlock();
      if (r.selection === "saved") {
        const apps = await selectedAppsCount();
        const list = await loadRules(apps);
        setRules(list);
        setShield(await shieldState());
        const problem = master ? await syncShield(true, list) : null;
        setMsg(problem ?? `${apps} Apps/Kategorien/Webseiten in der Auswahl.`);
        setDiag(await shieldDiagnostics());
      } else if (r.selection === "cancelled") {
        setMsg(null);
      } else {
        setMsg("Picker nicht verfügbar.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // ── Pro-App-Regeln ────────────────────────────────────────────────────────
  const change = async (index: number, patch: Partial<AppRuleValues>) => {
    setBusy(`rule-${index}`);
    try {
      const apps = shield?.selected.apps ?? 0;
      const next = await requestRuleChange(index, patch, apps);
      setRules(next);
      setMsg(
        delayHours === 0
          ? "Änderung sofort übernommen (Wartezeit aus)."
          : `Änderung beantragt — greift in ${delayHours} h.`,
      );
      const problem = await syncShield(master, next);
      if (problem) setMsg(problem);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dropPending = async (index: number) => {
    if (await hasPin()) {
      const pin = await askPin();
      if (!pin) return;
      if (!(await verifyPin(pin))) {
        setMsg("PIN falsch — Antrag bleibt.");
        return;
      }
    }
    const next = await cancelRulePending(index, shield?.selected.apps ?? 0);
    setRules(next);
    setMsg("Antrag verworfen.");
  };

  const setDelay = async (h: number) => {
    const saved = await saveDelayHours(h);
    setDelayHours(saved);
    setMsg(saved === 0 ? "Wartezeit aus — Änderungen greifen sofort." : `Wartezeit: ${saved} h.`);
  };

  /** Löschschutz schalten — Ergebnis ehrlich zurückmelden. */
  const toggleDenyRemoval = async () => {
    if (busy) return;
    setBusy("deny");
    setLastError(null);
    try {
      const want = !denyRemoval;
      const res = await setDenyAppRemoval(want);
      setDenyRemoval(res.applied);
      if (want && !res.applied) {
        setLastError(
          "iOS hat den Löschschutz verweigert (nur mit Kind-/Family-Autorisierung möglich) — Schalter bleibt aus.",
        );
      } else {
        setMsg(res.applied ? "Löschschutz aktiv." : "Löschschutz aus.");
      }
      setDiag(await shieldDiagnostics());
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Alles entfernen: Sperre + Löschschutz (Notausstieg, z. B. nach Test). */
  const clearAll = async () => {
    setBusy("clear");
    setLastError(null);
    try {
      await clearShield();
      await setDenyAppRemoval(false);
      setDenyRemoval(false);
      setMaster(false);
      await AsyncStorage.setItem(MASTER_KEY, "0");
      setShield(await shieldState());
      setDiag(await shieldDiagnostics());
      setMsg("Sperre und Löschschutz entfernt.");
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const blockedCount = rules.filter((r) => !r.pending && r.blocked).length;
  const activeRules = rules.filter((r) => hasRule(r)).length;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>APPS & SPERREN</Text>
      <Text style={s.sub}>
        Zwei getrennte Systeme: Werbe-/Tracker-Blocker (DNS-Tunnel, gilt für alle Apps) und
        App-Sperre (Apple Bildschirmzeit). Beides einzeln oder gleichzeitig.
      </Text>

      {/* ── 1. Blocker ─────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardLabel}>BLOCKER</Text>

        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>WERBUNG + TRACKER</Text>
            <Text style={s.rowSub}>
              {AD_DOMAIN_COUNT.toLocaleString("de-DE")} Domains per DNS · alle Apps
            </Text>
          </View>
          <Pressable
            onPress={toggleAds}
            disabled={!!busy}
            style={[s.switch, dns?.ads && dnsOn && s.switchOn]}
          >
            <Text style={[s.switchText, dns?.ads && dnsOn && s.switchTextOn]}>
              {dns?.ads ? (dnsOn ? "AN" : "STARTET") : "AUS"}
            </Text>
          </Pressable>
        </View>

        <View style={s.divider} />

        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>APP-SPERRE</Text>
            <Text style={s.rowSub}>
              Bildschirmzeit · {shield?.selected.apps ?? 0} Apps,{" "}
              {shield?.selected.categories ?? 0} Kategorien
              {blockedCount > 0 ? ` · ${blockedCount} einzeln gesperrt` : ""}
            </Text>
          </View>
          <Pressable
            onPress={toggleMaster}
            disabled={!!busy}
            style={[s.switch, master && shield?.active && s.switchOn]}
          >
            <Text style={[s.switchText, master && shield?.active && s.switchTextOn]}>
              {master && shield?.active ? "AN" : "AUS"}
            </Text>
          </Pressable>
        </View>

        <Text style={s.meta}>
          {dns ? describeDns(dns) : "—"} · Tunnel {dnsOn ? "läuft" : "aus"}
        </Text>
      </View>

      {!screenTimeAvailable ? (
        <View style={s.card}>
          <Text style={s.warnTitle}>MODUL FEHLT</Text>
          <Text style={s.cardText}>
            {screenTimeUnavailableReason() ?? "Natives Screen-Time-Modul nicht geladen."}
            {"\n\n"}Ohne dieses Modul kann die App keine echte App sperren (nur der
            DNS-Werbeblocker arbeitet weiter).
          </Text>
        </View>
      ) : diag?.shieldFailed ? (
        <View style={s.card}>
          <Text style={s.warnTitle}>SPERRE WIRD NICHT ÜBERNOMMEN</Text>
          <Text style={s.cardText}>
            iOS hat die Sperre nicht in den ManagedSettingsStore geschrieben. Häufigste Ursachen:
            Bildschirmzeit-Zugriff nicht erlaubt, Gerät nach dem Erlauben nicht neu gestartet, oder
            die Auswahl ist leer. Siehe DIAGNOSE unten.
          </Text>
        </View>
      ) : null}

      {/* ── 2. Zugriff ─────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>BILDSCHIRMZEIT-ZUGRIFF</Text>
            <Text style={s.rowSub}>
              {status === "approved" ? "erlaubt" : status === "denied" ? "verweigert" : "nicht erteilt"}
            </Text>
          </View>
          {status !== "approved" ? (
            <Pressable onPress={grant} disabled={!!busy} style={s.btnSmall}>
              <Text style={s.btnSmallText}>ERLAUBEN</Text>
            </Pressable>
          ) : (
            <Text style={s.ok}>OK</Text>
          )}
        </View>
      </View>

      {/* ── 3. Auswahl ─────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>AUSWAHL</Text>
            <Text style={s.rowSub}>
              {shield?.selected.apps ?? 0} Apps · {shield?.selected.categories ?? 0} Kategorien ·{" "}
              {shield?.selected.webDomains ?? 0} Webseiten
            </Text>
          </View>
          <Pressable onPress={pick} disabled={!!busy} style={s.btnSmall}>
            <Text style={s.btnSmallText}>WÄHLEN</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>
          Der System-Picker zeigt alle installierten Apps (vollflächig, scrollbar). Kategorien
          sperren alle Apps der Kategorie.
        </Text>
      </View>

      {/* ── 4. Limits pro App ──────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardLabel}>LIMITS PRO APP</Text>
        {rules.length === 0 ? (
          <Text style={s.cardText}>
            Noch keine Apps in der Auswahl — oben „WÄHLEN“. Jede gewählte App bekommt hier eine
            eigene Regel-Zeile.
          </Text>
        ) : (
          <Text style={s.cardText}>
            {activeRules} von {rules.length} Apps haben eine Regel. Änderungen greifen erst nach der
            Wartezeit — das ist der Schutz gegen Kurzschluss-Entscheidungen.
          </Text>
        )}

        {rules.map((r) => {
          const pendMs = pendingRemainingMs(r, Date.now());
          const isOpen = open === r.index;
          return (
            <View key={r.index} style={s.ruleRow}>
              <Pressable onPress={() => setOpen(isOpen ? null : r.index)} style={s.ruleHead}>
                <View style={s.rowText}>
                  <Text style={s.ruleTitle}>{r.label}</Text>
                  <Text style={s.ruleSub}>{describeRule(r)}</Text>
                </View>
                <Text style={s.ruleChevron}>{isOpen ? "−" : "+"}</Text>
              </Pressable>

              {pendMs > 0 ? (
                <View style={s.pending}>
                  <Text style={s.pendingTitle}>
                    WARTEZEIT · greift in {formatRemaining(pendMs)}
                  </Text>
                  <Pressable onPress={() => void dropPending(r.index)} style={s.pendingCancel}>
                    <Text style={s.pendingCancelText}>MIT PIN VERWERFEN</Text>
                  </Pressable>
                </View>
              ) : null}

              {isOpen ? (
                <View style={s.ruleBody}>
                  <Chips
                    label="TÄGLICH"
                    values={DAILY}
                    current={r.dailySeconds}
                    format={(v) => (v === 0 ? "AUS" : formatAmount(v))}
                    disabled={!!r.pending || busy === `rule-${r.index}`}
                    onPick={(v) => void change(r.index, { dailySeconds: v })}
                  />
                  <Chips
                    label="WOCHE"
                    values={WEEKLY}
                    current={r.weeklySeconds}
                    format={(v) => (v === 0 ? "AUS" : formatAmount(v))}
                    disabled={!!r.pending || busy === `rule-${r.index}`}
                    onPick={(v) => void change(r.index, { weeklySeconds: v })}
                  />
                  <Chips
                    label="ÖFFNUNGEN/TAG"
                    values={OPENS}
                    current={r.opensPerDay}
                    format={(v) => (v === 0 ? "∞" : `${v}×`)}
                    disabled={!!r.pending || busy === `rule-${r.index}`}
                    onPick={(v) => void change(r.index, { opensPerDay: v })}
                  />
                  <Chips
                    label="PFLICHT-PAUSE"
                    values={PAUSE}
                    current={r.pauseSeconds}
                    format={(v) => (v === 0 ? "—" : formatAmount(v))}
                    disabled={!!r.pending || busy === `rule-${r.index}`}
                    onPick={(v) => void change(r.index, { pauseSeconds: v })}
                  />
                  <View style={s.chipRow}>
                    <Text style={s.chipLabel}>SPERRE</Text>
                    <Pressable
                      onPress={() => void change(r.index, { blocked: !r.blocked })}
                      disabled={!!r.pending || busy === `rule-${r.index}`}
                      style={[s.chip, r.blocked && s.chipOn]}
                    >
                      <Text style={[s.chipText, r.blocked && s.chipTextOn]}>
                        {r.blocked ? "GESPERRT" : "FREI"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* ── 5. Wartezeit ───────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardLabel}>WARTEZEIT FÜR ÄNDERUNGEN · OPTIONAL</Text>
        <Text style={s.cardText}>
          {delayHours === 0
            ? "AUS — Änderungen greifen sofort. Kein Antrag, kein Countdown."
            : `Änderungen werden erst nach ${delayHours} h wirksam (Schutz gegen Kurzschluss-Entscheidungen). Abschaltbar: SOFORT.`}
        </Text>
        <View style={s.chipRow}>
          <Text style={s.chipLabel}>DELAY</Text>
          {DELAY_PRESETS_H.map((h) => (
            <Pressable
              key={h}
              onPress={() => void setDelay(h)}
              style={[s.chip, delayHours === h && s.chipOn]}
            >
              <Text style={[s.chipText, delayHours === h && s.chipTextOn]}>
                {h === 0 ? "SOFORT" : h === 24 ? "1 TAG" : `${h} H`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── 6. Löschschutz ─────────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>LÖSCHSCHUTZ</Text>
            <Text style={s.rowSub}>
              {denyRemoval ? "aktiv — Apps können nicht gelöscht werden" : "aus"}
            </Text>
          </View>
          <Pressable
            onPress={() => void toggleDenyRemoval()}
            disabled={!!busy}
            style={[s.chip, denyRemoval && s.chipOn]}
          >
            <Text style={[s.chipText, denyRemoval && s.chipTextOn]}>
              {denyRemoval ? "AN" : "AUS"}
            </Text>
          </Pressable>
        </View>
        <Text style={s.hint}>
          Sperrt das Löschen von Apps über Apples ManagedSettings. Das greift nur, wenn das Gerät
          über Family/Family-Sharing als Kind-Gerät autorisiert ist — sonst verweigert iOS die
          Einstellung (der Schalter springt dann zurück). Auf dem eigenen Gerät ist die
          zuverlässige Variante: Einstellungen → Bildschirmzeit → Beschränkungen → „Apps löschen"
          aus (Code kennt nur die andere Person).
        </Text>
      </View>

      {/* ── 7. Diagnose ────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.rowText}>
            <Text style={s.cardLabel}>DIAGNOSE</Text>
            <Text style={s.rowSub}>
              {diag
                ? `Modul ${diag.module === "expo" ? "OK" : diag.module} · ${diag.authorization} · Speicher ${diag.storage}`
                : "lädt …"}
            </Text>
          </View>
          <Pressable onPress={() => void reload()} disabled={!!busy} style={s.btnSmall}>
            <Text style={s.btnSmallText}>NEU</Text>
          </Pressable>
        </View>
        {diag ? (
          <>
            <Text style={s.meta}>
              AUSWAHL: {diag.selected.apps} Apps · {diag.selected.categories} Kategorien ·{" "}
              {diag.selected.webDomains} Webseiten
            </Text>
            <Text style={s.meta}>
              STORE: {diag.store.apps} Apps gesperrt · {diag.store.webDomains} Webseiten ·{" "}
              Kategorien {diag.store.categoriesSet ? "gesetzt" : "—"} · Löschschutz{" "}
              {diag.store.denyAppRemoval ? "an" : "aus"}
            </Text>
            <Text style={s.meta}>
              SPEICHER: {diag.storage === "app_group" ? "App Group (teilt mit Extension)" : "Standard (nur App — keine App Group im Profil)"}
            </Text>
            {diag.shieldFailed ? (
              <Text style={s.warnTitle}>LETZTER SCHREIBVERSUCH: vom System nicht übernommen</Text>
            ) : null}
            {lastError ? <Text style={s.warnTitle}>FEHLER: {lastError}</Text> : null}
          </>
        ) : null}
        <Pressable onPress={() => void clearAll()} disabled={!!busy} style={s.btnSmall}>
          <Text style={s.btnSmallText}>ALLES ENTFERNEN</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator color={C.text} style={{ marginTop: 10 }} /> : null}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}
      <Text style={s.foot}>
        Werbeblocker = DNS-Tunnel (SPERREN → DOMAINS für Plattformen/Internet-aus). App-Sperre =
        Apple Bildschirmzeit, gilt systemweit auch bei geschlossener App.
      </Text>
    </ScrollView>
  );
}

function Chips({
  label,
  values,
  current,
  format,
  disabled,
  onPick,
}: {
  label: string;
  values: number[];
  current: number;
  format: (v: number) => string;
  disabled: boolean;
  onPick: (v: number) => void;
}) {
  return (
    <View style={s.chipRow}>
      <Text style={s.chipLabel}>{label}</Text>
      {values.map((v) => (
        <Pressable
          key={v}
          onPress={() => onPick(v)}
          disabled={disabled}
          style={[s.chip, current === v && s.chipOn, disabled && s.chipDisabled]}
        >
          <Text style={[s.chipText, current === v && s.chipTextOn]}>{format(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 120 },
  title: { color: C.text, fontSize: 22, fontWeight: "700", letterSpacing: 2 },
  sub: { color: C.text2, fontSize: 12, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardLabel: { color: C.text3, fontSize: 11, letterSpacing: 1.6, marginBottom: 10 },
  cardText: { color: C.text2, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  warnTitle: { color: C.warn, fontSize: 12, fontWeight: "700", letterSpacing: 1.4, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowText: { flex: 1, paddingRight: 10 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600", letterSpacing: 0.6 },
  rowSub: { color: C.text3, fontSize: 11, marginTop: 3, lineHeight: 15 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  switch: {
    minWidth: 68,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
    alignItems: "center",
  },
  switchOn: { backgroundColor: C.text, borderColor: C.text },
  switchText: { color: C.text2, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  switchTextOn: { color: C.bg },
  btnSmall: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
  },
  btnSmallText: { color: C.text, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  ok: { color: C.text2, fontSize: 12, letterSpacing: 1.2 },
  hint: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 10 },
  meta: { color: C.text3, fontSize: 10, letterSpacing: 1, marginTop: 12 },
  ruleRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 10 },
  ruleHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ruleTitle: { color: C.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.8 },
  ruleSub: { color: C.text3, fontSize: 11, marginTop: 2 },
  ruleChevron: { color: C.text2, fontSize: 18, width: 22, textAlign: "center" },
  ruleBody: { marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 8, gap: 6 },
  chipLabel: { color: C.text3, fontSize: 10, letterSpacing: 1.2, width: 96 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
  },
  chipOn: { backgroundColor: C.text, borderColor: C.text },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: C.text2, fontSize: 11 },
  chipTextOn: { color: C.bg, fontWeight: "700" },
  pending: { marginTop: 8, padding: 8, borderWidth: 1, borderColor: C.border, borderRadius: 8 },
  pendingTitle: { color: C.warn, fontSize: 10, letterSpacing: 1, fontWeight: "700" },
  pendingCancel: { marginTop: 6 },
  pendingCancelText: { color: C.text2, fontSize: 10, letterSpacing: 1 },
  msg: { color: C.text2, fontSize: 12, marginTop: 10 },
  foot: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 18 },
});
