import { describe, expect, it } from "vitest";
import { PLANS, UNLIMITED, hasFeature, isAnnualPlan, planAtLeast, planLimit, planTier, shopifyPlanName } from "../app/lib/plans";

describe("plans", () => {
  it("treats annual plans exactly like their monthly tier", () => {
    expect(planTier("starter_annual")).toBe("starter");
    expect(planTier("Pro Annual")).toBe("pro");
    expect(planLimit("starter_annual")).toBe(100);
    expect(planLimit("pro_annual")).toBe(UNLIMITED);
    expect(hasFeature("pro_annual", "liveChat")).toBe(true);
    expect(hasFeature("starter_annual", "portalEditor")).toBe(true);
    expect(isAnnualPlan("pro_annual")).toBe(true);
  });

  it("defaults unknown plans to free", () => {
    expect(planTier(undefined)).toBe("free");
    expect(planTier("enterprise")).toBe("free");
    expect(planLimit(null)).toBe(10);
  });

  it("gates features by tier", () => {
    expect(hasFeature("free", "storeCredit")).toBe(false);
    expect(hasFeature("starter", "storeCredit")).toBe(true);
    expect(hasFeature("starter", "variantExchange")).toBe(true);
    expect(hasFeature("starter", "shopNow")).toBe(false);
    expect(hasFeature("pro", "webhooks")).toBe(true);
    expect(planAtLeast("pro", "starter")).toBe(true);
    expect(planAtLeast("starter", "pro")).toBe(false);
  });

  it("keeps the published prices", () => {
    expect(PLANS.map((p) => p.price)).toEqual([0, 19, 49]);
    expect(shopifyPlanName("starter_annual")).toBe("Starter Annual");
    expect(shopifyPlanName("pro")).toBe("Pro");
  });
});
