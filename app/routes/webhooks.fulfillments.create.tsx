// Webhook: fulfillments/create
//
// When Shopify creates a fulfillment for an order, we look for any local
// ReturnRequest rows for that order that weren't mirrored to Shopify yet
// (shopifyReturnId is null). We retry createShopifyReturn for them now that
// the items are fulfilled — this is the "automatic sync" behaviour the
// merchant expects after a customer submitted a return on an unfulfilled
// order (or a partially-fulfilled order whose remaining items just shipped).

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { createShopifyReturn } from "../lib/returns-api.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[webhooks.fulfillments.create] ${topic} for ${shop}`);

  // Webhook payload includes the order_id of the fulfillment.
  const orderIdNum = (payload as any)?.order_id;
  if (!orderIdNum) {
    console.warn("[webhooks.fulfillments.create] no order_id in payload");
    return new Response();
  }
  const orderGid = `gid://shopify/Order/${orderIdNum}`;

  try {
    const unsynced = await prisma.returnRequest.findMany({
      where: {
        shop,
        orderId: orderGid,
        shopifyReturnId: null,
      },
      include: { items: true },
    });

    if (unsynced.length === 0) {
      console.log(
        `[webhooks.fulfillments.create] no unsynced returns for order ${orderGid}`,
      );
      return new Response();
    }

    console.log(
      `[webhooks.fulfillments.create] retrying ${unsynced.length} unsynced return(s) for ${orderGid}`,
    );

    const { admin } = await unauthenticated.admin(shop);

    for (const rr of unsynced) {
      const items = rr.items
        .filter((it: any) => it.lineItemId)
        .map((it: any) => ({
          lineItemId: it.lineItemId!,
          quantity: it.quantity,
          reason: it.reason,
          note: it.note ?? "",
        }));
      if (items.length === 0) {
        console.warn(
          `[webhooks.fulfillments.create] rma=${rr.rma} has no items with lineItemId — skipping`,
        );
        continue;
      }
      const result = await createShopifyReturn(admin, rr.orderId, items);
      if (result.shopifyReturnId) {
        await prisma.returnRequest.update({
          where: { id: rr.id },
          data: { shopifyReturnId: result.shopifyReturnId },
        });
        await prisma.returnEvent.create({
          data: {
            returnRequestId: rr.id,
            type: "SHOPIFY_MIRROR_OK",
            source: "system",
            title: "Synced to Shopify Admin after fulfillment",
            detail: result.shopifyReturnId,
          },
        });
        console.log(
          `[webhooks.fulfillments.create] rma=${rr.rma} synced as ${result.shopifyReturnId}`,
        );
      } else {
        console.warn(
          `[webhooks.fulfillments.create] rma=${rr.rma} still failed: ${result.userErrors.map((e: any) => e.message).join("; ")}`,
        );
      }
    }
  } catch (err) {
    console.error("[webhooks.fulfillments.create] handler failed:", err);
  }

  return new Response();
};
