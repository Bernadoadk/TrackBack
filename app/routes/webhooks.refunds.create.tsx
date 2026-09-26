import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleRefundCreated } from "../lib/refund-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhooks.refunds.create] ${topic} for ${shop}`);
  try {
    await handleRefundCreated(shop, payload);
  } catch (err) {
    console.error("[webhooks.refunds.create] failed:", err);
  }
  return new Response();
};
