// Sync Shopify native Returns ⇄ local ReturnRequest table.
// Used by webhook handlers and the (throttled) dashboard backfill.

import prisma from "../db.server";
import { mapShopifyReturnStatus, mergeShopifyStatus } from "./returns-logic";
import { createWithUniqueRma, recordEvent } from "./returns-service.server";

type AdminClient = { graphql: (query: string, opts?: any) => Promise<Response> };

/** How often the dashboard may re-run the backfill for a shop. */
const BACKFILL_TTL_MS = 10 * 60 * 1000;

export interface ShopifyReturnPayload {
  id: string | number;
  admin_graphql_api_id?: string;
  status?: string;
  name?: string | null;
  order_id?: string | number;
  order?: { id?: string | number; admin_graphql_api_id?: string };
  [key: string]: any;
}

/** Applies an incoming Shopify status without ever moving a return backwards. */
async function applyIncomingStatus(local: { id: string; status: string }, shopifyStatus: string) {
  const next = mergeShopifyStatus(local.status, mapShopifyReturnStatus(shopifyStatus));
  if (!next) return false;
  const now = new Date();
  await prisma.returnRequest.update({
    where: { id: local.id },
    data: {
      status: next,
      ...(next === "APPROVED" ? { approvedAt: now } : {}),
      ...(next === "RECEIVED" ? { receivedAt: now } : {}),
      ...(next === "REJECTED" ? { rejectedAt: now } : {}),
    },
  });
  await recordEvent(local.id, {
    type: `SHOPIFY_${next}`,
    title: `Updated from Shopify: ${next.toLowerCase()}`,
    source: "system",
  });
  return true;
}

/**
 * Idempotent upsert: maps a Shopify Return into a local ReturnRequest row.
 */
export async function upsertReturnFromShopify(
  shop: string,
  payload: ShopifyReturnPayload,
  admin?: AdminClient | null,
) {
  const shopifyReturnId = String(payload.admin_graphql_api_id ?? `gid://shopify/Return/${payload.id}`);
  if (!shopifyReturnId.startsWith("gid://shopify/Return/")) {
    return { id: null, rma: null, created: false, skipped: true } as const;
  }

  const existing = await prisma.returnRequest.findFirst({
    where: { shopifyReturnId },
    select: { id: true, rma: true, status: true },
  });
  if (existing) {
    if (payload.status) await applyIncomingStatus(existing, payload.status);
    return { id: existing.id, rma: existing.rma, created: false };
  }

  if (!admin) return { id: null, rma: null, created: false, skipped: true } as const;

  // Fetch full context (webhook payloads are sparse).
  let ret: any = null;
  try {
    const resp = await admin.graphql(
      `#graphql
        query ReturnDetails($id: ID!) {
          return(id: $id) {
            id
            name
            status
            order {
              id
              name
              email
              createdAt
              totalPriceSet { shopMoney { amount } }
              customer { firstName lastName defaultEmailAddress { emailAddress } }
            }
            returnLineItems(first: 50) {
              edges {
                node {
                  id
                  quantity
                  ... on ReturnLineItem {
                    returnReason
                    returnReasonNote
                    fulfillmentLineItem {
                      lineItem {
                        id
                        title
                        variantTitle
                        sku
                        originalUnitPriceSet { shopMoney { amount } }
                        product { id }
                        variant { id image { url } }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
      { variables: { id: shopifyReturnId } },
    );
    const json: any = await resp.json();
    ret = json?.data?.return ?? null;
  } catch (err) {
    console.error("[returns-sync] GraphQL fetch failed:", err);
  }
  if (!ret?.order?.id) {
    console.warn(`[returns-sync] skipping ${shopifyReturnId} — enrichment failed`);
    return { id: null, rma: null, created: false, skipped: true } as const;
  }

  const orderId: string = ret.order.id;
  const customerEmail: string = String(ret.order.customer?.defaultEmailAddress?.emailAddress ?? ret.order.email ?? "").toLowerCase();
  if (!customerEmail) {
    return { id: null, rma: null, created: false, skipped: true } as const;
  }

  // A portal submission may still be linking its own mirror: attach to it
  // instead of creating a duplicate row.
  const recentLocal = await prisma.returnRequest.findFirst({
    where: { shop, orderId, shopifyReturnId: null, createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, rma: true, status: true },
  });
  if (recentLocal) {
    try {
      await prisma.returnRequest.update({ where: { id: recentLocal.id }, data: { shopifyReturnId } });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
    return { id: recentLocal.id, rma: recentLocal.rma, created: false };
  }

  const customerName =
    [ret.order.customer?.firstName, ret.order.customer?.lastName].filter(Boolean).join(" ") ||
    customerEmail.split("@")[0];
  const lineItems = (ret.returnLineItems?.edges ?? []).map((e: any) => {
    const li = e.node?.fulfillmentLineItem?.lineItem;
    return {
      lineItemId: li?.id ?? null,
      productId: li?.product?.id ?? "",
      variantId: li?.variant?.id ?? "",
      sku: li?.sku ?? null,
      name: li?.title ?? "Item",
      variantName: li?.variantTitle ?? "",
      quantity: e.node?.quantity ?? 1,
      price: parseFloat(li?.originalUnitPriceSet?.shopMoney?.amount ?? "0"),
      reason: e.node?.returnReason ?? "OTHER",
      note: e.node?.returnReasonNote ?? "",
      imageUrl: li?.variant?.image?.url ?? null,
    };
  });
  const itemsTotal = lineItems.reduce((s: number, l: any) => s + l.price * l.quantity, 0);

  // ShopSettings.shop is referenced by ReturnRequest — make sure it exists.
  await prisma.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });

  try {
    const created = await createWithUniqueRma((rma) =>
      prisma.returnRequest.create({
        data: {
          shop,
          rma,
          shopifyReturnId,
          orderId,
          orderName: ret.order.name || "—",
          customerEmail,
          customerName,
          orderDate: new Date(ret.order.createdAt),
          orderTotal: parseFloat(ret.order.totalPriceSet?.shopMoney?.amount ?? "0"),
          status: mapShopifyReturnStatus(ret.status ?? payload.status),
          itemsTotal,
          refundAmount: itemsTotal,
          items: lineItems.length ? { create: lineItems } : undefined,
        },
      }),
    );
    await recordEvent(created.id, { type: "SHOPIFY_IMPORTED", title: "Imported from Shopify Admin", source: "system" });
    return { id: created.id, rma: created.rma, created: true };
  } catch (e: any) {
    if (e?.code === "P2002") return { id: null, rma: null, created: false, skipped: true } as const;
    throw e;
  }
}

/**
 * Backfill: pulls recent Returns from Shopify Admin and upserts them locally.
 * Throttled per shop (dashboard + returns list call it on load).
 */
export async function syncReturnsForShop(shop: string, admin: AdminClient, opts: { force?: boolean } = {}) {
  try {
    if (!opts.force) {
      const claim = await prisma.shopSettings.updateMany({
        where: {
          shop,
          OR: [{ lastReturnsSyncAt: null }, { lastReturnsSyncAt: { lt: new Date(Date.now() - BACKFILL_TTL_MS) } }],
        },
        data: { lastReturnsSyncAt: new Date() },
      });
      if (claim.count === 0) return;
    }

    const resp = await admin.graphql(`#graphql
      query ListReturnsLightweight {
        orders(
          first: 25,
          sortKey: UPDATED_AT,
          reverse: true,
          query: "return_status:return_requested OR return_status:in_progress OR return_status:inspection_complete OR return_status:returned"
        ) {
          nodes {
            id
            returns(first: 5) { nodes { id status } }
          }
        }
      }
    `);
    const json: any = await resp.json();
    if (json?.errors) {
      console.error("[returns-sync] listing query errors:", json.errors);
      return;
    }

    const pairs: Array<{ id: string; status: string }> = [];
    for (const o of json?.data?.orders?.nodes ?? []) {
      for (const r of o?.returns?.nodes ?? []) {
        if (r?.id) pairs.push({ id: r.id, status: r.status ?? "REQUESTED" });
      }
    }
    if (pairs.length === 0) return;

    const existing = await prisma.returnRequest.findMany({
      where: { shop, shopifyReturnId: { in: pairs.map((p) => p.id) } },
      select: { id: true, shopifyReturnId: true, status: true },
    });
    const existingMap = new Map(existing.map((r) => [r.shopifyReturnId!, r] as const));

    for (const pair of pairs) {
      const local = existingMap.get(pair.id);
      if (local) {
        await applyIncomingStatus(local, pair.status);
        continue;
      }
      await upsertReturnFromShopify(
        shop,
        { id: pair.id.split("/").pop() ?? pair.id, admin_graphql_api_id: pair.id, status: pair.status },
        admin,
      );
    }
  } catch (err) {
    console.error("[returns-sync] syncReturnsForShop failed:", err);
  }
}
