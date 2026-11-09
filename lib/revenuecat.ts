// Pure Monetization-Logik (Dull v1.9.4: settings.lifetime.* / Lifetime-Kauf).
// Kein I/O, kein React, keine nativen Imports — nur reine Funktionen.
export const LIFETIME_ENTITLEMENT = "lifetime";

// Aus einer Liste aktiver Entitlement-IDs ableiten (Dull: settings.lifetime.active).
export function isLifetimeActive(activeIds: readonly string[]): boolean {
  return activeIds.indexOf(LIFETIME_ENTITLEMENT) !== -1;
}

// RevenueCat liefert eine Map { id: { isActive } }; hier aktive IDs extrahieren.
export function normalizeActiveEntitlements(
  active: Record<string, unknown> | null | undefined,
): string[] {
  if (!active || typeof active !== "object") return [];
  return Object.keys(active).filter((k) => {
    const v = active[k];
    return typeof v === "object" && v !== null && (v as { isActive?: unknown }).isActive === true;
  });
}

export type LifetimeOffer = {
  productId: string;
  priceString: string;
  title: string;
};

// Lifetime-Package finden (bevorzugt ID, die auf "lifetime" schließen lässt).
export function findLifetimeOffer(packages: readonly LifetimeOffer[]): LifetimeOffer | null {
  if (packages.length === 0) return null;
  return packages.find((p) => /lifetime/i.test(p.productId)) ?? packages[0];
}

// SDK-Fehler auf kurze, deutsche Meldungen normalisieren (kein roher Text im UI).
export function normalizePurchaseError(e: unknown): string {
  if (!e) return "Unbekannter Fehler";
  const m = e instanceof Error ? e.message : String(e);
  if (/cancel|abbrechen/i.test(m)) return "Kauf abgebrochen";
  if (/already|entitled|own|besitzt/i.test(m)) return "Bereits freigeschaltet";
  if (/network|offline|timeout|verbindung/i.test(m)) return "Keine Verbindung";
  return m.slice(0, 160);
}

