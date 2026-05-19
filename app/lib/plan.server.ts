import prisma from "../db.server";

export const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  starter: 100,
  starter_annual: 100,
  pro: 999999,
  pro_annual: 999999,
};

// Ordered plan levels for comparison
const PLAN_LEVEL: Record<string, number> = {
  free: 0,
  starter: 1,
  starter_annual: 1,
  pro: 2,
  pro_annual: 2,
};

// Normalize a Shopify subscription name ("Starter Annual") into a plan key
// ("starter_annual"). Used everywhere we compare Shopify names to plan IDs.
function normalizePlanName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, '_');
}

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
 * `syncBillingFromShopify`, which should be called from the top-level admin
 * loader so every admin page load refreshes the cache.
 */
export async function getShopPlan(shop: string): Promise<string> {
  const billing = await prisma.billingSubscription.findUnique({ where: { shop } });
  if (!billing || billing.status !== 'active') return 'free';
  return billing.plan ?? 'free';
}

export function planAtLeast(plan: string, required: string): boolean {
  return (PLAN_LEVEL[plan] ?? 0) >= (PLAN_LEVEL[required] ?? 0);
}

/**
 * Source of truth for the shop's plan: ask Shopify directly which
 * subscriptions are currently active, then mirror that state into the local
 * BillingSubscription row.
 *
 * Why this exists: the local DB cannot reliably track every transition
 * (user cancels approval, charge expires, merchant cancels from Shopify
 * admin, upgrade replaces an existing subscription, etc.). Re-syncing from
 * Shopify on every admin page load makes the system self-healing — any
 * stale state corrects itself on the next page load.
 *
 * Behaviour:
 *   - Active paid subscription found → DB set to that plan (highest tier wins)
 *   - No active paid subscription    → DB reset to free
 *   - Sync fails (network / API)     → keep existing DB row, no destructive change
 *
 * Returns the resolved plan ('free' | 'starter' | 'pro').
 */
export async function syncBillingFromShopify(admin: any, shop: string): Promise<string> {
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
      if (sub.status !== 'ACTIVE') continue;
      const planName = normalizePlanName(sub.name);
      const level = PLAN_LEVEL[planName] ?? 0;
      if (level > 0 && (!best || level > best.level)) {
        best = { name: planName, id: sub.id, level };
      }
    }

    if (best) {
      const chargeId = best.id.split('/').pop() ?? null;
      await prisma.billingSubscription.upsert({
        where: { shop },
        create: { shop, plan: best.name, status: 'active', shopifyChargeId: chargeId },
        update: { plan: best.name, status: 'active', shopifyChargeId: chargeId },
      });
      return best.name;
    }

    // No active paid subscription on Shopify — make sure local DB reflects free.
    const local = await prisma.billingSubscription.findUnique({ where: { shop } });
    if (!local) {
      await prisma.billingSubscription.create({
        data: { shop, plan: 'free', status: 'active' },
      });
    } else if (local.plan !== 'free' || local.status !== 'active' || local.shopifyChargeId !== null) {
      await prisma.billingSubscription.update({
        where: { shop },
        data: { plan: 'free', status: 'active', shopifyChargeId: null },
      });
    }
    return 'free';
  } catch (e) {
    console.error('[billing] syncBillingFromShopify failed:', e);
    // On failure, fall back to whatever is in the local DB (best effort).
    return getShopPlan(shop);
  }
}
