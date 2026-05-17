// GDPR — shop/redact
//
// Triggered 48h after a merchant uninstalls the app. The app must permanently
// delete ALL data tied to that shop.
//
// HMAC verification is handled by authenticate.webhook(request).
// Must return 200 within 5s.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  void handleShopRedact(shop).catch((e) =>
    console.error("[webhook shop/redact] handler failed:", e),
  );

  return new Response();
};

async function handleShopRedact(shop: string) {
  // Delete everything we hold for this shop. Cascading relations clean up
  // children (return items, internal notes, chat messages) automatically.
  await prisma.$transaction([
    prisma.chatMessage.deleteMany({
      where: { conversation: { shop } },
    }),
    prisma.conversation.deleteMany({ where: { shop } }),
    prisma.returnRequest.deleteMany({ where: { shop } }),
    prisma.returnReason.deleteMany({ where: { shop } }),
    prisma.emailTemplate.deleteMany({ where: { shop } }),
    prisma.billingSubscription.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  console.log(`[webhook shop/redact] all data redacted for ${shop}`);
}
