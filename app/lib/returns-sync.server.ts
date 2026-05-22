// Sync Shopify native Returns ⇄ local ReturnRequest table.
// Used by both webhook handlers and the dashboard backfill loader.

import prisma from "../db.server";

type ShopifyReturnStatus =
  | "REQUESTED"
  | "OPEN"
  | "CLOSED"
  | "DECLINED"
  | "CANCELED";

// Maps Shopify Return.status → TrackBack local status.
// Note: CANCELED is mapped to REJECTED (not EXPIRED) — EXPIRED is reserved
// for our own auto-expire flow on un-shipped approved returns.
const STATUS_MAP: Record<string, string> = {
  REQUESTED: "PENDING",
  OPEN: "APPROVED",
  CLOSED: "RECEIVED",
  DECLINED: "REJECTED",
  CANCELED: "REJECTED",
};

function nextRmaPrefix(year: number) {
  return `RMA-${year}-`;
}

async function generateRma(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await prisma.returnRequest.findFirst({
    where: { rma: { startsWith: nextRmaPrefix(year) } },
    orderBy: { rma: "desc" },
    select: { rma: true },
  });
  const lastSeq = last ? parseInt(last.rma.split("-")[2] || "0", 10) : 0;
  const nextSeq = (isNaN(lastSeq) ? 0 : lastSeq) + 1;
  return `${nextRmaPrefix(year)}${String(nextSeq).padStart(6, "0")}`;
}

export interface ShopifyReturnPayload {
  id: string | number;
  admin_graphql_api_id?: string;
  status?: string;
  name?: string | null;
  order_id?: string | number;
  total_quantity?: number;
  return_line_items?: Array<{
    id?: string | number;
    fulfillment_line_item_id?: string | number;
    quantity?: number;
    return_reason?: string;
    return_reason_note?: string;
    customer_note?: string;
  }>;
  [key: string]: any;
}

/**
 * Idempotent upsert: maps a Shopify Return into a local ReturnRequest row.
 * - Looks up by shopifyReturnId first.
 * - Falls back to fetching order details via GraphQL when payload is sparse
 *   (most webhook payloads only include IDs).
 */
export async function upsertReturnFromShopify(
  shop: string,
  payload: ShopifyReturnPayload,
  admin?: { graphql: (query: string, opts?: any) => Promise<Response> },
) {
  const shopifyReturnId = String(
    payload.admin_graphql_api_id ?? `gid://shopify/Return/${payload.id}`,
  );

  const existing = await prisma.returnRequest.findFirst({
    where: { shopifyReturnId },
    select: { id: true, rma: true, status: true },
  });

  const localStatus =
    STATUS_MAP[(payload.status ?? "REQUESTED").toUpperCase()] ?? "PENDING";

  // For new returns, fetch the order context via GraphQL so we can record
  // the customer + line items. Without admin client, store the minimum.
  let orderName = payload.name ?? "";
  let orderId = String(payload.order_id ?? "");
  let orderTotal = 0;
  let customerEmail = "";
  let customerName = "";
  let orderDate: Date = new Date();
  let lineItems: Array<{
    productId: string;
    variantId: string;
    name: string;
    variantName: string;
    quantity: number;
    price: number;
    reason: string;
    note: string;
    imageUrl: string | null;
  }> = [];

  if (admin && !existing) {
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
                customer { firstName lastName email }
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
      const ret = json?.data?.return;
      if (ret) {
        orderName = ret.order?.name ?? orderName;
        orderId = ret.order?.id ?? orderId;
        orderTotal = parseFloat(
          ret.order?.totalPriceSet?.shopMoney?.amount ?? "0",
        );
        customerEmail = ret.order?.customer?.email ?? ret.order?.email ?? "";
        customerName =
          [ret.order?.customer?.firstName, ret.order?.customer?.lastName]
            .filter(Boolean)
            .join(" ") || customerEmail.split("@")[0] || "";
        if (ret.order?.createdAt) orderDate = new Date(ret.order.createdAt);
        lineItems = (ret.returnLineItems?.edges ?? []).map((e: any) => {
          const li = e.node?.fulfillmentLineItem?.lineItem;
          return {
            productId: li?.product?.id ?? "",
            variantId: li?.variant?.id ?? "",
            name: li?.title ?? "Item",
            variantName: li?.variantTitle ?? "",
            quantity: e.node?.quantity ?? 1,
            price: parseFloat(
              li?.originalUnitPriceSet?.shopMoney?.amount ?? "0",
            ),
            reason: e.node?.returnReason ?? "OTHER",
            note: e.node?.returnReasonNote ?? "",
            imageUrl: li?.variant?.image?.url ?? null,
          };
        });
      }
    } catch (err) {
      console.error("[returns-sync] GraphQL fetch failed:", err);
    }
  }

  if (existing) {
    await prisma.returnRequest.update({
      where: { id: existing.id },
      data: { status: localStatus },
    });
    return { id: existing.id, rma: existing.rma, created: false };
  }

  // Don't write garbage rows. If we couldn't enrich the return with order +
  // customer data (no admin client, GraphQL failure, network blip…), skip the
  // insert. The next dashboard load — or the next webhook for the same return
  // — will retry the upsert with full context.
  if (!orderId || !customerEmail) {
    console.warn(
      `[returns-sync] skipping insert for ${shopifyReturnId} — enrichment failed (orderId="${orderId}", customerEmail="${customerEmail}")`,
    );
    return { id: null, rma: null, created: false, skipped: true } as const;
  }

  // ShopSettings.shop is a unique key referenced by ReturnRequest. Make sure
  // it exists before insert (a return webhook can fire before settings are
  // created if the merchant hasn't opened the app yet).
  await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const rma = await generateRma();
  const created = await prisma.returnRequest.create({
    data: {
      shop,
      rma,
      shopifyReturnId,
      orderId,
      orderName: orderName || "—",
      customerEmail,
      customerName: customerName || customerEmail.split("@")[0] || "Customer",
      orderDate,
      orderTotal,
      status: localStatus,
      items:
        lineItems.length > 0
          ? {
              create: lineItems.map((it) => ({
                productId: it.productId,
                variantId: it.variantId,
                name: it.name,
                variantName: it.variantName,
                quantity: it.quantity,
                price: it.price,
                reason: it.reason,
                note: it.note,
                imageUrl: it.imageUrl,
              })),
            }
          : undefined,
    },
  });

  return { id: created.id, rma: created.rma, created: true };
}

/**
 * Backfill: pulls recent Returns from Shopify Admin and upserts them locally.
 *
 * Strategy (two-phase to stay under the 1000-cost query limit):
 *   1. Lightweight listing — IDs + status only, ~125 cost for 25 orders × 5 returns.
 *   2. For each return missing from the local DB, fetch full details one by
 *      one via `upsertReturnFromShopify` (~50 cost per return).
 *
 * Returns already in the DB get a status refresh from the listing — no
 * detail fetch needed since the local copy already has the order context.
 *
 * Idempotent — safe to call on every dashboard load.
 */
export async function syncReturnsForShop(
  shop: string,
  admin: { graphql: (query: string, opts?: any) => Promise<Response> },
) {
  try {
    const resp = await admin.graphql(`#graphql
      query ListReturnsLightweight {
        orders(
          first: 25,
          sortKey: UPDATED_AT,
          reverse: true,
          query: "return_status:RETURN_REQUESTED OR return_status:RETURN_IN_PROGRESS OR return_status:RETURNED"
        ) {
          edges {
            node {
              id
              returns(first: 5) {
                edges { node { id status } }
              }
            }
          }
        }
      }
    `);
    const json: any = await resp.json();
    if (json?.errors) {
      console.error("[returns-sync] listing query errors:", json.errors);
      return;
    }
    const orderEdges: any[] = json?.data?.orders?.edges ?? [];

    // Flatten to (returnId, status) pairs.
    const pairs: Array<{ id: string; status: string }> = [];
    for (const oe of orderEdges) {
      const returnEdges = oe?.node?.returns?.edges ?? [];
      for (const re of returnEdges) {
        if (re?.node?.id) {
          pairs.push({ id: re.node.id, status: re.node.status ?? "REQUESTED" });
        }
      }
    }

    if (pairs.length === 0) return;

    // Look up what's already in the DB — single batched query.
    const existing = await prisma.returnRequest.findMany({
      where: { shop, shopifyReturnId: { in: pairs.map((p) => p.id) } },
      select: { id: true, shopifyReturnId: true, status: true },
    });
    const existingMap = new Map(
      existing.map((r) => [r.shopifyReturnId!, r] as const),
    );

    for (const pair of pairs) {
      const local = existingMap.get(pair.id);
      const newStatus =
        STATUS_MAP[(pair.status ?? "REQUESTED").toUpperCase()] ?? "PENDING";

      if (local) {
        // Already synced — just refresh status if it changed.
        if (local.status !== newStatus) {
          await prisma.returnRequest.update({
            where: { id: local.id },
            data: { status: newStatus },
          });
        }
        continue;
      }

      // New return — fetch details + insert via the shared upsert path.
      await upsertReturnFromShopify(
        shop,
        {
          id: pair.id.split("/").pop() ?? pair.id,
          admin_graphql_api_id: pair.id,
          status: pair.status,
        },
        admin,
      );
    }
  } catch (err) {
    console.error("[returns-sync] syncReturnsForShop failed:", err);
  }
}
