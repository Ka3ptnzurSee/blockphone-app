// lib/gateSettings.ts — welche "harten Regeln" beim App-Start gelten.
//
// Bisher waren PIN-Gate und Intervention (Atmen/Mathe/Journal) Pflicht: ohne
// PIN kam man gar nicht rein. Build 148 macht daraus Schalter — die App soll
// beim Einrichten helfen, nicht bevormunden. Voreinstellung bleibt an
// (bisheriges Verhalten), abschaltbar im Setup-Tab.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type GateSettings = {
  /** PIN beim Öffnen verlangen (und beim ersten Start einen setzen). */
  pinRequired: boolean;
  /** Intervention (Atmen/Mathe/Journal) vor dem Öffnen. */
  interventionRequired: boolean;
};

export const DEFAULT_GATES: GateSettings = {
  pinRequired: true,
  interventionRequired: true,
};

const PIN_KEY = "pb-pin-required";
const INTERVENTION_KEY = "pb-intervention-required";

export async function loadGateSettings(): Promise<GateSettings> {
  try {
    const [pin, iv] = await Promise.all([
      AsyncStorage.getItem(PIN_KEY),
      AsyncStorage.getItem(INTERVENTION_KEY),
    ]);
    return {
      // Alles außer einem expliziten "0" bleibt an.
      pinRequired: pin !== "0",
      interventionRequired: iv !== "0",
    };
  } catch {
    return DEFAULT_GATES;
  }
}

export async function saveGateSettings(s: GateSettings): Promise<GateSettings> {
  try {
    await AsyncStorage.multiSet([
      [PIN_KEY, s.pinRequired ? "1" : "0"],
      [INTERVENTION_KEY, s.interventionRequired ? "1" : "0"],
    ]);
  } catch {
    /* best effort */
  }
  return s;
}
