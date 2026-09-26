import prisma from "../db.server";
import { planAtLeast as planAtLeastTier, planLevel, planLimit, planTier, type PlanTier } from "./plans";

export { PLANS, planLimit, planTier, hasFeature, isUnlimited, UNLIMITED } from "./plans";

/** Kept for backward compatibility with callers that import it from here. */
export function planAtLeast(plan: string, required: string): boolean {
  return planAtLeastTier(plan, planTier(required) as PlanTier);
}

// Normalize a Shopify subscription name ("Starter Annual") into a plan key
// ("starter_annual"). Used everywhere we compare Shopify names to plan IDs.
function normalizePlanName(name: string): string {
  return String(name || "").toLowerCase().trim().replace(/\s+/g, "_");
}

/** How long a Shopify billing sync stays fresh before we ask Shopify again. */
const BILLING_SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * Billing mode — controls whether Shopify charges are real or test.
 *
 *   BILLING_MODE=production  → real charges (live store, real money)
 *   BILLING_MODE=development → test charges (dev stores only, fake money)
 *
 * Defaults to development (test) if the env var is missing — safer fallback.
 */
export function isBillingTestMode(): boolean {
  const mode = (process.env.BILLING_MODE || "").trim().toLowerCase();
  if (mode === "production") return false;
  if (mode === "development") return true;
  // Unset / invalid value → test mode (safe default)
  return true;
}

/**
 * Read the plan from the local DB. Only returns a paid plan if the local
 * record is in 'active' status — otherwise falls back to 'free'.
 *
 * This is a *cache read*. The local DB is kept in sync with Shopify by
 * `syncBillingFromShopify` / `ensureBillingSynced`.
 */
export async function getShopPlan(shop: string): Promise<string> {
  const billing = await prisma.billingSubscription.findUnique({ where: { shop } });
  if (!billing || billing.status !== "active") return "free";
  return billing.plan ?? "free";
}

/**
 * Source of truth for the shop's plan: ask Shopify directly which
 * subscriptions are currently active, then mirror that state into the local
 * BillingSubscription row.
 *
 * Behaviour:
 *   - Active paid subscription found → DB set to that plan (highest tier wins)
 *   - No active paid subscription    → DB reset to free
 *   - Sync fails (network / API)     → keep existing DB row, no destructive change
 */
export async function syncBillingFromShopify(admin: any, shop: string): Promise<string> {
  const now = new Date();
  try {
    const resp = await admin.graphql(`#graphql
      query CurrentAppSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
          }
        }
      }
    `);
    const json = await resp.json();
    const subs: any[] = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];

    // Pick the highest-tier ACTIVE subscription (in case an old one hasn't
    // been cleaned up after an upgrade).
    let best: { name: string; id: string; level: number } | null = null;
    for (const sub of subs) {
      if (sub.status !== "ACTIVE") continue;
      const planName = normalizePlanName(sub.name);
      const level = planLevel(planName);
      if (level > 0 && (!best || level > best.level)) {
        best = { name: planName, id: sub.id, level };
      }
    }

    if (best) {
      const chargeId = best.id.split("/").pop() ?? null;
      await prisma.billingSubscription.upsert({
        where: { shop },
        create: { shop, plan: best.name, status: "active", shopifyChargeId: chargeId, lastSyncedAt: now },
        update: { plan: best.name, status: "active", shopifyChargeId: chargeId, lastSyncedAt: now },
      });
      return best.name;
    }

    // No active paid subscription on Shopify — make sure local DB reflects free.
    await prisma.billingSubscription.upsert({
      where: { shop },
      create: { shop, plan: "free", status: "active", lastSyncedAt: now },
      update: { plan: "free", status: "active", shopifyChargeId: null, lastSyncedAt: now },
    });
    return "free";
  } catch (e) {
    console.error("[billing] syncBillingFromShopify failed:", e);
    // On failure, fall back to whatever is in the local DB (best effort).
    return getShopPlan(shop);
  }
}

/**
 * Same as `syncBillingFromShopify` but skips the Shopify round-trip when the
 * local copy was refreshed recently. Used by the admin layout so every
 * navigation doesn't cost a GraphQL call. Pass `force` on the billing page.
 */
export async function ensureBillingSynced(
  admin: any,
  shop: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  if (!opts.force) {
    const local = await prisma.billingSubscription.findUnique({ where: { shop } });
    const fresh =
      local?.lastSyncedAt && Date.now() - local.lastSyncedAt.getTime() < BILLING_SYNC_TTL_MS;
    if (local && fresh) {
      return local.status === "active" ? local.plan : "free";
    }
  }
  return syncBillingFromShopify(admin, shop);
}

/** Returns created this calendar month (quota accounting). */
export async function countReturnsThisMonth(shop: string): Promise<number> {
  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  firstDayOfMonth.setHours(0, 0, 0, 0);
  return prisma.returnRequest.count({
    where: { shop, createdAt: { gte: firstDayOfMonth } },
  });
}

/** Quota snapshot for UI + enforcement. */
export async function getQuota(shop: string, plan?: string) {
  const resolved = plan ?? (await getShopPlan(shop));
  const used = await countReturnsThisMonth(shop);
  const limit = planLimit(resolved);
  return { plan: resolved, used, limit, reached: used >= limit };
}
