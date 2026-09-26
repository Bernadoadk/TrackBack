// Handles Shopify native Returns webhooks:
//   returns/request, returns/approve, returns/decline, returns/cancel,
//   returns/close, returns/reopen, returns/update, returns/process
// (+ refunds/create for shops whose subscription still points here).
//
// Idempotent: the local status only ever moves forward (see
// mergeShopifyStatus) so our own Shopify calls can't bounce a return back.

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { upsertReturnFromShopify } from "../lib/returns-sync.server";
import { handleRefundCreated } from "../lib/refund-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhooks.returns] ${topic} for ${shop}`);

  try {
    if (String(topic).toUpperCase().startsWith("REFUNDS")) {
      await handleRefundCreated(shop, payload as any);
      return new Response();
    }
    let admin = null;
    try {
      admin = (await unauthenticated.admin(shop)).admin;
    } catch {
      /* uninstalled shop — status-only update still works */
    }
    await upsertReturnFromShopify(shop, payload as any, admin);
  } catch (err) {
    console.error(`[webhooks.returns] ${topic} failed for ${shop}:`, err);
    // 200 anyway: the dashboard backfill reconciles later.
  }

  return new Response();
};
