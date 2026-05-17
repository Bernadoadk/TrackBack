// GDPR — customers/redact
//
// Triggered when a Shopify customer requests deletion of their personal data.
// The app must permanently delete all PII tied to that customer for the shop.
//
// HMAC verification is handled by authenticate.webhook(request).
// Must return 200 within 5s.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  void handleCustomerRedact(shop, payload).catch((e) =>
    console.error("[webhook customers/redact] handler failed:", e),
  );

  return new Response();
};

async function handleCustomerRedact(shop: string, payload: any) {
  const email: string | undefined = payload?.customer?.email;
  if (!email) {
    console.log("[webhook customers/redact] no customer email in payload — nothing to redact");
    return;
  }
  const lowered = email.toLowerCase();

  // Delete return requests and their cascade (items, internal notes)
  const deletedReturns = await prisma.returnRequest.deleteMany({
    where: { shop, customerEmail: { equals: email, mode: "insensitive" } },
  });

  // Delete chat conversation (cascade deletes messages)
  const deletedConvs = await prisma.conversation.deleteMany({
    where: { shop, type: "CLIENT", customerEmail: lowered },
  });

  console.log(
    `[webhook customers/redact] redacted ${deletedReturns.count} return(s) and ${deletedConvs.count} conversation(s) for ${email} on ${shop}`,
  );
}
