// Native RevenueCat-Anbindung (Lifetime-Entitlement). Nur hier liegen SDK-Imports.
import Purchases, { LOG_LEVEL, PACKAGE_TYPE } from "react-native-purchases";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";
import { LIFETIME_ENTITLEMENT, normalizePurchaseError, type LifetimeOffer } from "./revenuecat";

// API-Key wird zur Buildzeit aus EXPO_PUBLIC_REVENUECAT_KEY eingebrannt (Expo/ENV).
const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_KEY ?? "";

let configured = false;

export function revenueCatKeyPresent(): boolean {
  return API_KEY.length > 0;
}

async function ensureConfigured(): Promise<boolean> {
  if (!revenueCatKeyPresent()) return false;
  if (!configured) {
    try {
      await Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey: API_KEY });
      configured = true;
    } catch {
      return false;
    }
  }
  return configured;
}

export async function checkLifetime(): Promise<boolean> {
  if (!(await ensureConfigured())) return false;
  try {
    const info: CustomerInfo = await Purchases.getCustomerInfo();
    return info.entitlements.active[LIFETIME_ENTITLEMENT]?.isActive === true;
  } catch {
    return false;
  }
}

export async function loadLifetimeOffer(): Promise<LifetimeOffer | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const packages: PurchasesPackage[] = offerings.current?.availablePackages ?? [];
    const lifetime = packages.find((p) => p.packageType === PACKAGE_TYPE.LIFETIME);
    const pick = lifetime ?? packages[0];
    if (!pick) return null;
    return {
      productId: pick.product.identifier,
      priceString: pick.product.priceString,
      title: pick.product.title,
    };
  } catch {
    return null;
  }
}

export async function purchaseLifetime(): Promise<{ success: boolean; error: string | null }> {
  if (!(await ensureConfigured())) {
    return { success: false, error: "RevenueCat nicht konfiguriert (EXPO_PUBLIC_REVENUECAT_KEY fehlt)" };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const lifetime = packages.find((p) => p.packageType === PACKAGE_TYPE.LIFETIME) ?? packages[0];
    if (!lifetime) return { success: false, error: "Kein Kaufangebot verfügbar" };
    await Purchases.purchasePackage(lifetime);
    const info = await Purchases.getCustomerInfo();
    const ok = info.entitlements.active[LIFETIME_ENTITLEMENT]?.isActive === true;
    return { success: ok, error: ok ? null : "Kauf nicht bestätigt" };
  } catch (e) {
    return { success: false, error: normalizePurchaseError(e) };
  }
}

export async function restoreLifetime(): Promise<{ success: boolean; error: string | null }> {
  if (!(await ensureConfigured())) {
    return { success: false, error: "RevenueCat nicht konfiguriert (EXPO_PUBLIC_REVENUECAT_KEY fehlt)" };
  }
  try {
    const info = await Purchases.restorePurchases();
    const ok = info.entitlements.active[LIFETIME_ENTITLEMENT]?.isActive === true;
    return { success: ok, error: ok ? null : "Kein Kauf gefunden" };
  } catch (e) {
    return { success: false, error: normalizePurchaseError(e) };
  }
}

