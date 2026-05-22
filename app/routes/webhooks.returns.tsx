// Handles all Shopify native Returns webhooks:
//   returns/request, returns/approve, returns/decline,
//   returns/cancel, returns/close, returns/reopen
//
// Strategy: idempotent upsert into the local ReturnRequest table keyed on
// shopifyReturnId. We use the offline session (via unauthenticated.admin) to
// fetch full return details — webhook payloads only include IDs.

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { upsertReturnFromShopify } from "../lib/returns-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhooks.returns] ${topic} for ${shop}`);

  try {
    const { admin } = await unauthenticated.admin(shop);
    await upsertReturnFromShopify(shop, payload as any, admin);
  } catch (err) {
    console.error(`[webhooks.returns] ${topic} failed for ${shop}:`, err);
    // Return 200 so Shopify doesn't keep retrying on a permanent error.
    // Real recovery happens on the next dashboard load (backfill sync).
  }

  return new Response();
};
