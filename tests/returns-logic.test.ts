import { describe, expect, it } from "vitest";
import {
  assessRisk,
  computeTotals,
  evaluateLine,
  getReturnMethods,
  isBlocked,
  isGreenReturn,
  isValidEmail,
  mapShopifyReturnStatus,
  mergeShopifyStatus,
  normalizeOrderNumber,
  type EligibilitySettings,
  type FeeSettings,
} from "../app/lib/returns-logic";

const settings: EligibilitySettings = {
  returnWindow: 30,
  returnWindowBasis: "fulfillment",
  blockedSkus: "",
  blockedTags: "",
  blockedProductTypes: "",
  blockDiscountedItems: false,
  oneReturnPerOrder: false,
};

const line = {
  productId: "gid://shopify/Product/1234567",
  variantId: "gid://shopify/ProductVariant/42",
  sku: "TEE-M",
  productTags: ["summer"],
  productType: "Shirts",
  returnableQty: 2,
  fulfilledAt: "2026-09-01T10:00:00Z",
};

describe("eligibility", () => {
  it("accepts an item inside the window", () => {
    const r = evaluateLine(line, { settings, orderCreatedAt: "2026-08-28T10:00:00Z", now: new Date("2026-09-20T10:00:00Z") });
    expect(r.eligible).toBe(true);
    expect(r.maxQty).toBe(2);
  });

  it("counts the window from fulfillment by default and from the order when configured", () => {
    const now = new Date("2026-10-02T10:00:00Z"); // 31 days after fulfillment, 35 after order
    expect(evaluateLine(line, { settings, orderCreatedAt: "2026-08-28T10:00:00Z", now }).reason).toBe("WINDOW_EXPIRED");
    const fromOrder = { ...settings, returnWindowBasis: "order", returnWindow: 40 };
    expect(evaluateLine(line, { settings: fromOrder, orderCreatedAt: "2026-08-28T10:00:00Z", now }).eligible).toBe(true);
  });

  it("matches blocklists exactly (no substring over-blocking)", () => {
    expect(isBlocked(line, { ...settings, blockedSkus: "TEE" })).toBe(false);
    expect(isBlocked(line, { ...settings, blockedSkus: "tee-m" })).toBe(true);
    expect(isBlocked(line, { ...settings, blockedSkus: "1234567" })).toBe(true);
    expect(isBlocked(line, { ...settings, blockedSkus: "123" })).toBe(false);
    expect(isBlocked(line, { ...settings, blockedTags: "Summer" })).toBe(true);
    expect(isBlocked(line, { ...settings, blockedProductTypes: "shirts" })).toBe(true);
  });

  it("applies discounted-item and one-return-per-order rules", () => {
    const ctx = { orderCreatedAt: "2026-09-01T10:00:00Z", now: new Date("2026-09-05T10:00:00Z") };
    expect(evaluateLine({ ...line, isDiscounted: true }, { ...ctx, settings: { ...settings, blockDiscountedItems: true } }).reason).toBe("DISCOUNTED");
    expect(evaluateLine(line, { ...ctx, settings: { ...settings, oneReturnPerOrder: true }, hasOpenReturnOnOrder: true }).reason).toBe("ONE_RETURN_PER_ORDER");
  });

  it("subtracts quantities already requested locally", () => {
    const r = evaluateLine({ ...line, lockedQty: 2 }, { settings, orderCreatedAt: "2026-09-01", now: new Date("2026-09-05") });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("ALREADY_RETURNED");
  });

  it("flags unshipped items for returns but allows them for EU withdrawals", () => {
    const unshipped = { ...line, returnableQty: 0, fulfilledAt: null, unfulfilledQty: 1 };
    const ctx = { settings, orderCreatedAt: "2026-09-01", now: new Date("2026-09-02") };
    expect(evaluateLine(unshipped, ctx).reason).toBe("NOT_FULFILLED");
    const w = evaluateLine(unshipped, { ...ctx, mode: "withdrawal" });
    expect(w.eligible).toBe(true);
    expect(w.maxQty).toBe(1);
  });

  it("gives at least 14 days for EU withdrawals even with a shorter window", () => {
    const short = { ...settings, returnWindow: 7 };
    const now = new Date("2026-09-12T10:00:00Z"); // 11 days after fulfillment
    expect(evaluateLine(line, { settings: short, orderCreatedAt: "2026-08-30", now }).eligible).toBe(false);
    expect(evaluateLine(line, { settings: short, orderCreatedAt: "2026-08-30", now, mode: "withdrawal" }).eligible).toBe(true);
  });
});

const fees: FeeSettings = {
  restockingFeePercent: 10,
  returnShippingFee: 5,
  feeWaivedForStoreCredit: true,
  feeWaivedForExchange: true,
  feeExemptReasons: "Defective",
  storeCreditBonusPercent: 10,
  incentivizeStoreCredit: true,
};

describe("totals", () => {
  const lines = [{ price: 50, qty: 2, reason: "Wrong size" }];

  it("applies restocking + label fee on original-payment refunds", () => {
    const t = computeTotals({ lines, refundType: "ORIGINAL_PAYMENT", returnMethod: "label", settings: fees, feesEnabled: true, bonusEnabled: true });
    expect(t.itemsTotal).toBe(100);
    expect(t.restockingFee).toBe(10);
    expect(t.shippingFee).toBe(5);
    expect(t.refundTotal).toBe(85);
  });

  it("waives fees and adds the bonus for store credit", () => {
    const t = computeTotals({ lines, refundType: "STORE_CREDIT", returnMethod: "label", settings: fees, feesEnabled: true, bonusEnabled: true });
    expect(t.feeTotal).toBe(0);
    expect(t.feesWaived).toBe(true);
    expect(t.bonus).toBe(10);
    expect(t.refundTotal).toBe(110);
  });

  it("exempts reasons and plans without the feature", () => {
    const defective = computeTotals({ lines: [{ price: 50, qty: 2, reason: "Defective" }], refundType: "ORIGINAL_PAYMENT", returnMethod: "label", settings: fees, feesEnabled: true, bonusEnabled: true });
    expect(defective.feeTotal).toBe(0);
    const free = computeTotals({ lines, refundType: "STORE_CREDIT", returnMethod: "ship", settings: fees, feesEnabled: false, bonusEnabled: false });
    expect(free.bonus).toBe(0);
    expect(free.refundTotal).toBe(100);
  });

  it("never charges shipping when the customer keeps the item", () => {
    const t = computeTotals({ lines, refundType: "ORIGINAL_PAYMENT", returnMethod: "pickup", keepItem: true, settings: fees, feesEnabled: true, bonusEnabled: true });
    expect(t.feeTotal).toBe(0);
  });

  it("detects green returns", () => {
    expect(isGreenReturn({ enabled: true, maxAmount: 20, itemsTotal: 15 })).toBe(true);
    expect(isGreenReturn({ enabled: true, maxAmount: 20, itemsTotal: 25 })).toBe(false);
    expect(isGreenReturn({ enabled: false, maxAmount: 20, itemsTotal: 5 })).toBe(false);
  });
});

describe("Shopify status sync", () => {
  it("maps Shopify statuses", () => {
    expect(mapShopifyReturnStatus("open")).toBe("APPROVED");
    expect(mapShopifyReturnStatus("CLOSED")).toBe("RECEIVED");
    expect(mapShopifyReturnStatus("canceled")).toBe("REJECTED");
  });

  it("never moves a return backwards", () => {
    expect(mergeShopifyStatus("REFUNDED", "RECEIVED")).toBeNull(); // our own returnClose
    expect(mergeShopifyStatus("SHIPPED", "APPROVED")).toBeNull();
    expect(mergeShopifyStatus("APPROVED", "PENDING")).toBeNull(); // late returns/request webhook
    expect(mergeShopifyStatus("PENDING", "APPROVED")).toBe("APPROVED");
    expect(mergeShopifyStatus("APPROVED", "RECEIVED")).toBe("RECEIVED");
    expect(mergeShopifyStatus("PENDING", "REJECTED")).toBe("REJECTED");
    expect(mergeShopifyStatus("SHIPPED", "REJECTED")).toBeNull();
  });
});

describe("misc", () => {
  it("rejects search-syntax injection in emails", () => {
    expect(isValidEmail("jane@doe.com")).toBe(true);
    expect(isValidEmail("* name:1001")).toBe(false);
    expect(isValidEmail("a@b.co OR name:1001")).toBe(false);
    expect(isValidEmail('x"@y.com')).toBe(false);
  });

  it("normalizes order numbers", () => {
    expect(normalizeOrderNumber(" #1089 ")).toBe("1089");
    expect(normalizeOrderNumber("#SHOP-12 OR x")).toBe("SHOP-12ORx");
  });

  it("derives return methods from the legacy setting", () => {
    expect(getReturnMethods({ returnMethods: "", returnShippingMethod: "merchant_provides_label" })).toEqual(["label"]);
    expect(getReturnMethods({ returnMethods: "ship,store,unknown" })).toEqual(["ship", "store"]);
  });

  it("scores risk", () => {
    expect(assessRisk({ returnsLast90Days: 1, threshold: 3 }).level).toBe("low");
    expect(assessRisk({ returnsLast90Days: 3, threshold: 3 }).level).toBe("medium");
    expect(assessRisk({ returnsLast90Days: 6, threshold: 3 }).level).toBe("high");
    expect(assessRisk({ returnsLast90Days: 1, customerOrders: 4, customerReturns: 3, threshold: 3 }).reasons).toContain("high_return_rate");
  });
});
