/**
 * Single source of truth for TrackBack plans and feature gating.
 *
 * Pure module (client + server safe). Every route, component and server
 * helper must go through `planTier` / `hasFeature` / `planLimit` instead of
 * comparing plan strings by hand — hand-written checks are how the annual
 * plans ended up treated like Free in several places.
 */

export type PlanTier = "free" | "starter" | "pro";

/** Plan ids as stored in BillingSubscription.plan (monthly + annual variants). */
export type PlanId = "free" | "starter" | "starter_annual" | "pro" | "pro_annual";

const TIER_LEVEL: Record<PlanTier, number> = { free: 0, starter: 1, pro: 2 };

export const UNLIMITED = 999999;

/** Monthly return-request quota per tier. */
const TIER_LIMITS: Record<PlanTier, number> = {
  free: 10,
  starter: 100,
  pro: UNLIMITED,
};

/** Normalizes any stored/Shopify plan name ("Starter Annual", "pro_annual"…) to its tier. */
export function planTier(plan: string | null | undefined): PlanTier {
  const p = String(plan ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  if (p === "pro" || p === "pro_annual") return "pro";
  if (p === "starter" || p === "starter_annual") return "starter";
  return "free";
}

export function planLevel(plan: string | null | undefined): number {
  return TIER_LEVEL[planTier(plan)];
}

export function planAtLeast(plan: string | null | undefined, required: PlanTier): boolean {
  return planLevel(plan) >= TIER_LEVEL[required];
}

export function planLimit(plan: string | null | undefined): number {
  return TIER_LIMITS[planTier(plan)];
}

export function isUnlimited(plan: string | null | undefined): boolean {
  return planLimit(plan) >= UNLIMITED;
}

export function isAnnualPlan(plan: string | null | undefined): boolean {
  return String(plan ?? "").toLowerCase().includes("annual");
}

// ─── Feature gating ─────────────────────────────────────────────────────────

/** Minimum tier required for each gated feature. Anything not listed is available on every plan. */
export const FEATURE_TIERS = {
  // Starter
  portalEditor: "starter",
  emailTemplates: "starter",
  storeCredit: "starter",
  giftCard: "starter",
  variantExchange: "starter",
  customReasons: "starter",
  returnFees: "starter",
  photos: "starter",
  greenReturns: "starter",
  orderTags: "starter",
  advancedAnalytics: "starter",
  weeklyReport: "starter",
  // Pro
  shopNow: "pro",
  liveChat: "pro",
  whatsapp: "pro",
  whiteLabel: "pro",
  automations: "pro",
  fraud: "pro",
  webhooks: "pro",
  api: "pro",
} as const satisfies Record<string, PlanTier>;

export type Feature = keyof typeof FEATURE_TIERS;

export function hasFeature(plan: string | null | undefined, feature: Feature): boolean {
  return planAtLeast(plan, FEATURE_TIERS[feature]);
}

export function requiredTier(feature: Feature): PlanTier {
  return FEATURE_TIERS[feature];
}

export const TIER_LABEL: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
};

// ─── Catalogue (billing page + Shopify billing config names) ────────────────

export type PlanDefinition = {
  id: PlanTier;
  name: string;
  price: number;
  monthlyLimit: number;
  annualId?: PlanId;
  annualName?: string;
  annualPrice?: number;
  popular?: boolean;
  summary: string;
  features: string[];
};

export const ANNUAL_DISCOUNT_PCT = 20;

export const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    monthlyLimit: TIER_LIMITS.free,
    summary: "10 returns / month",
    features: [
      "Branded return portal (EN / FR)",
      "Eligibility rules & return window",
      "Return methods: ship, label, store drop-off, pickup",
      "Cash-on-delivery & mobile money refunds",
      "Customer return tracking page",
      "EU withdrawal button",
      "Email notifications",
      "Auto-approval",
      "7-day analytics",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: 19,
    monthlyLimit: TIER_LIMITS.starter,
    annualId: "starter_annual",
    annualName: "Starter Annual",
    annualPrice: 182,
    popular: true,
    summary: "100 returns / month",
    features: [
      "Everything in Free",
      "Portal editor: branding, layouts, texts",
      "Email template editor",
      "Store credit + bonus, gift cards",
      "Self-service variant exchanges",
      "Return fees & photo evidence",
      "Green returns (keep the item)",
      "Custom return reasons",
      "Shopify order tags",
      "90-day analytics, return rate & weekly report",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    monthlyLimit: TIER_LIMITS.pro,
    annualId: "pro_annual",
    annualName: "Pro Annual",
    annualPrice: 470,
    summary: "Unlimited returns",
    features: [
      "Everything in Starter",
      "Exchange for any product (Shop Now)",
      "Live chat with customers",
      "WhatsApp notifications & contact",
      "Automation rules (auto-refund…)",
      "Fraud signals & customer blocklist",
      "Webhooks & REST API",
      "White-label portal",
    ],
  },
];

export function findPlanDefinition(plan: string | null | undefined): PlanDefinition {
  const tier = planTier(plan);
  return PLANS.find((p) => p.id === tier) ?? PLANS[0];
}

/** Shopify billing plan name for a plan id ("starter_annual" → "Starter Annual"). */
export function shopifyPlanName(planId: string): string | null {
  for (const p of PLANS) {
    if (p.id === "free") continue;
    if (p.id === planId) return p.name;
    if (p.annualId === planId) return p.annualName ?? null;
  }
  return null;
}
