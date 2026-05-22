// Fetch and cache the shop's currency code in ShopSettings.
//
// Bug history: previously, if the ShopSettings row was created by another
// code path (e.g. an upsert in returns-sync) with the default "USD" value,
// this function returned "USD" without ever asking Shopify. That meant
// non-USD shops (FCFA, EUR, etc.) showed "$" everywhere. Now we treat
// "USD" as "possibly unverified" and always call Shopify in that case,
// caching the result. Non-USD cached values are trusted (verified once).

import prisma from "../db.server";

type AdminClient = {
  graphql: (query: string, opts?: any) => Promise<Response>;
};

// In-memory cache to avoid hammering Shopify within a single request chain.
// Keyed by shop. Cleared on process restart. Time-bounded as defense against
// stale state if a merchant changes their shop currency.
const memCache = new Map<string, { code: string; at: number }>();
const MEM_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns the shop's currency code (e.g. "USD", "EUR", "XOF").
 * - Memory cache (5 min) for same-process repeats.
 * - DB cache trusted for non-USD values.
 * - "USD" (the column default) → re-verify with Shopify and update DB.
 * - Network failure → fall back to whatever's in DB, or "USD".
 */
export async function getShopCurrency(
  shop: string,
  admin: AdminClient,
): Promise<string> {
  // 1. Memory cache
  const cached = memCache.get(shop);
  if (cached && Date.now() - cached.at < MEM_TTL_MS) {
    return cached.code;
  }

  // 2. DB cache — trust non-default values
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { currency: true },
  });
  if (settings?.currency && settings.currency !== "USD") {
    memCache.set(shop, { code: settings.currency, at: Date.now() });
    return settings.currency;
  }

  // 3. Either no row yet OR cached as "USD" (might be the unverified default).
  //    Ask Shopify and update the cache.
  try {
    const resp = await admin.graphql(`#graphql
      query ShopCurrency {
        shop { currencyCode }
      }
    `);
    const json: any = await resp.json();
    if (json?.errors) {
      console.error("[shop-currency] GraphQL errors:", json.errors);
      const fallback = settings?.currency ?? "USD";
      memCache.set(shop, { code: fallback, at: Date.now() });
      return fallback;
    }
    const currency: string = json?.data?.shop?.currencyCode ?? "USD";

    await prisma.shopSettings.upsert({
      where: { shop },
      update: { currency },
      create: { shop, currency },
    });

    memCache.set(shop, { code: currency, at: Date.now() });
    return currency;
  } catch (err) {
    console.error("[shop-currency] fetch failed:", err);
    const fallback = settings?.currency ?? "USD";
    return fallback;
  }
}
