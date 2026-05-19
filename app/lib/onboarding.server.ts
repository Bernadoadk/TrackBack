import prisma from "../db.server";
import { DEFAULT_REASONS } from "../components/mock-data";
import { evaluateOnboarding, type OnboardingState } from "./onboarding";

export { CRITICAL_FIELDS, fieldIsCustomized, evaluateOnboarding } from "./onboarding";
export type { CriticalFieldKey, OnboardingStatus, OnboardingState } from "./onboarding";

/**
 * Ensure a ShopSettings row exists for this shop. Creates one with defaults
 * (and seed reasons) on first call. Idempotent.
 */
export async function ensureShopSettings(shop: string) {
  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: {
        shop,
        reasons: { create: DEFAULT_REASONS.map((r: any) => ({ label: r.label, enabled: r.enabled })) },
      }
    });
  }
  return settings;
}

export async function getOnboardingState(shop: string): Promise<OnboardingState> {
  const settings = await ensureShopSettings(shop);
  return evaluateOnboarding(settings);
}
