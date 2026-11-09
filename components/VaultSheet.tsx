import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { maskSecret, type Credential } from "../lib/vault";

const C = {
  bg: "#000000",
  surface: "#141414",
  surface2: "#1f1f1f",
  border: "#2a2a2a",
  text: "#ffffff",
  text2: "#8a8a8a",
  text3: "#5a5a5a",
  dot: "#ffffff",
};

export type VaultOffer = { username: string; secret: string };

type Props = {
  visible: boolean;
  host: string;
  credentials: Credential[];
  offer: VaultOffer | null;
  existing: boolean; // für diesen Benutzer liegt schon ein Eintrag vor
  onClose: () => void;
  onFill: (c: Credential) => void;
  onDelete: (c: Credential) => void;
  onSaveOffer: () => void;
  onDismissOffer: () => void;
};

// Sheet für gespeicherte Passwörter + Bestätigung eines neuen Logins.
// Bewusst nativ (nicht im WebView): Secrets verlassen die Keychain nur auf
// expliziten Tap und nur in die passende Domain.
export default function VaultSheet({
  visible,
  host,
  credentials,
  offer,
  existing,
  onClose,
  onFill,
  onDelete,
  onSaveOffer,
  onDismissOffer,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{offer ? "LOGIN SPEICHERN?" : "PASSWÖRTER"}</Text>
            <Pressable onPress={offer ? onDismissOffer : onClose} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.host}>{host || "—"}</Text>

          {offer ? (
            <View style={styles.offerCard}>
              <Text style={styles.offerUser}>{offer.username}</Text>
              <Text style={styles.offerSecret}>{maskSecret(offer.secret)}</Text>
              <Text style={styles.hint}>
                {existing
                  ? "Vorhandenes Passwort für diesen Benutzer ersetzen?"
                  : "Im Keychain dieses Geräts speichern?"}
              </Text>
              <View style={styles.actions}>
                <Pressable onPress={onSaveOffer} style={[styles.btn, styles.btnPrimary]}>
                  <Text style={[styles.btnText, styles.btnTextPrimary]}>
                    {existing ? "ERSETZEN" : "SPEICHERN"}
                  </Text>
                </Pressable>
                <Pressable onPress={onDismissOffer} style={styles.btn}>
                  <Text style={styles.btnText}>NICHT JETZT</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {credentials.length === 0 && !offer ? (
            <Text style={styles.hint}>
              Noch keine Passwörter für diese Seite. Nach dem ersten Login fragt Blockphone beim
              Absenden, ob es die Zugangsdaten speichern soll.
            </Text>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {credentials.map((c) => (
                <View key={`${c.host}:${c.username}`} style={styles.row}>
                  <Pressable onPress={() => onFill(c)} style={styles.rowMain}>
                    <Text style={styles.rowUser} numberOfLines={1}>
                      {c.username}
                    </Text>
                    <Text style={styles.rowSecret}>{maskSecret(c.secret)}</Text>
                  </Pressable>
                  <Pressable onPress={() => onDelete(c)} style={styles.del}>
                    <Text style={styles.delText}>LÖSCHEN</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={styles.foot}>
            Nur auf diesem Gerät (iOS-Keychain) · kein Cloud-Sync · Füllen nur nach Tap
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: "78%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: "Ndot57", fontSize: 20, color: C.text, letterSpacing: 3 },
  close: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: C.text2, fontSize: 18 },
  host: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 6,
  },
  offerCard: {
    borderWidth: 1,
    borderColor: C.dot,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    gap: 4,
  },
  offerUser: { fontFamily: "SpaceGrotesk", fontSize: 14, color: C.text },
  offerSecret: { fontFamily: "SpaceGrotesk", fontSize: 13, color: C.text2, letterSpacing: 2 },
  hint: {
    fontFamily: "SpaceGrotesk",
    fontSize: 12,
    color: C.text3,
    lineHeight: 18,
    marginTop: 8,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  btn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  btnPrimary: { backgroundColor: C.dot, borderColor: C.dot },
  btnText: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text2,
    letterSpacing: 2,
  },
  btnTextPrimary: { color: C.bg, fontWeight: "700" },
  list: { marginTop: 16 },
  listContent: { gap: 8, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingLeft: 14,
  },
  rowMain: { flex: 1, paddingVertical: 12, paddingRight: 12 },
  rowUser: { fontFamily: "SpaceGrotesk", fontSize: 14, color: C.text },
  rowSecret: {
    fontFamily: "SpaceGrotesk",
    fontSize: 11,
    color: C.text3,
    letterSpacing: 2,
    marginTop: 2,
  },
  del: { paddingHorizontal: 12, paddingVertical: 14 },
  delText: { fontFamily: "SpaceGrotesk", fontSize: 10, color: C.text3, letterSpacing: 1 },
  foot: {
    fontFamily: "SpaceGrotesk",
    fontSize: 10,
    color: C.text3,
    letterSpacing: 1,
    marginTop: 14,
  },
});
