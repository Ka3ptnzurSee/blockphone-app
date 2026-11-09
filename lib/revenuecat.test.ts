import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIFETIME_ENTITLEMENT,
  isLifetimeActive,
  normalizeActiveEntitlements,
  findLifetimeOffer,
  normalizePurchaseError,
} from "./revenuecat";

test("isLifetimeActive", () => {
  assert.equal(isLifetimeActive(["lifetime"]), true);
  assert.equal(isLifetimeActive(["monthly", "lifetime"]), true);
  assert.equal(isLifetimeActive(["monthly"]), false);
  assert.equal(isLifetimeActive([]), false);
  assert.equal(LIFETIME_ENTITLEMENT, "lifetime");
});

test("normalizeActiveEntitlements extrahiert nur aktive", () => {
  const m = {
    lifetime: { isActive: true },
    monthly: { isActive: false },
    annual: { isActive: true },
  };
  const ids = normalizeActiveEntitlements(m);
  assert.deepEqual(ids.sort(), ["annual", "lifetime"]);
  assert.deepEqual(normalizeActiveEntitlements(null), []);
  assert.deepEqual(normalizeActiveEntitlements({}), []);
});

test("findLifetimeOffer bevorzugt lifetime-Package", () => {
  const list = [
    { productId: "bp_monthly", priceString: "3,99 €", title: "Monthly" },
    { productId: "bp_lifetime", priceString: "49,99 €", title: "Lifetime" },
  ];
  assert.equal(findLifetimeOffer(list)!.productId, "bp_lifetime");
  assert.equal(findLifetimeOffer([list[0]])!.productId, "bp_monthly");
  assert.equal(findLifetimeOffer([]), null);
});

test("normalizePurchaseError", () => {
  assert.equal(normalizePurchaseError(new Error("user cancelled")), "Kauf abgebrochen");
  assert.equal(normalizePurchaseError(new Error("already entitled")), "Bereits freigeschaltet");
  assert.equal(normalizePurchaseError(new Error("network offline")), "Keine Verbindung");
  assert.equal(normalizePurchaseError(null), "Unbekannter Fehler");
  assert.equal(normalizePurchaseError(new Error("irgendwas anderes")), "irgendwas anderes");
});

