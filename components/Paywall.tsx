import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { LifetimeOffer } from "../lib/revenuecat";
import {
  checkLifetime,
  loadLifetimeOffer,
  purchaseLifetime,
  restoreLifetime,
  revenueCatKeyPresent,
} from "../lib/revenuecatClient";

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

/**
 * LIFETIME-Kauf (Dull v1.9.4: settings.lifetime.* / Lifetime-Kauf).
 * Einmal kaufen, dauerhaft alle Funktionen — kein Abo.
 * API-Key über EXPO_PUBLIC_REVENUECAT_KEY (wird zur Buildzeit eingebrannt).
 */
export default function Paywall() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [offer, setOffer] = useState<LifetimeOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const keyPresent = revenueCatKeyPresent();
    setReady(keyPresent);
    if (!keyPresent) return;
    (async () => {
      setActive(await checkLifetime());
      setOffer(await loadLifetimeOffer());
    })();
  }, []);

  async function buy() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const r = await purchaseLifetime();
    setBusy(false);
    if (r.success) {
      setActive(true);
      setMsg("LIFETIME AKTIVIERT");
    } else {
      setError(r.error);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const r = await restoreLifetime();
    setBusy(false);
    if (r.success) {
      setActive(true);
      setMsg("KAUF WIEDERHERGESTELLT");
    } else {
      setError(r.error);
    }
  }

  if (ready === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.dot} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>LIFETIME</Text>
      {!ready ? (
        <Text style={styles.cardBody}>Nicht konfiguriert — EXPO_PUBLIC_REVENUECAT_KEY fehlt.</Text>
      ) : active ? (
        <Text style={styles.cardBody}>✓ LIFETIME AKTIV — alle Funktionen dauerhaft frei.</Text>
      ) : (
        <>
          <Text style={styles.cardBody}>Einmal kaufen, dauerhaft alle Funktionen — kein Abo.</Text>
          {error ? <Text style={styles.error}>⚠ {error}</Text> : null}
          {msg ? <Text style={styles.ok}>✓ {msg}</Text> : null}
          <Pressable
            onPress={() => void buy()}
            disabled={busy || !offer}
            style={[styles.btn, (busy || !offer) && styles.btnOff]}
          >
            <Text style={styles.btnText}>
              {busy ? "…" : offer ? `LIFETIME KAUFEN · ${offer.priceString}` : "ANGEBOT LADEN …"}
            </Text>
          </Pressable>
          <Pressable onPress={() => void restore()} disabled={busy} style={styles.btnGhost}>
            <Text style={styles.btnGhostText}>KAUF WIEDERHERSTELLEN</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  cardBody: { color: C.text2, fontSize: 13, lineHeight: 19 },
  error: { color: "#ff6b6b", fontSize: 12, lineHeight: 17 },
  ok: { color: "#4ade80", fontSize: 12, fontWeight: "600" },
  btn: {
    backgroundColor: C.dot,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    marginTop: 4,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: C.bg, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  btnGhost: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  btnGhostText: { color: C.text2, fontSize: 13, fontWeight: "600", letterSpacing: 1 },
});

