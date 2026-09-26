// GDPR — customers/redact
//
// Permanently deletes the customer's PII for the shop: return requests
// (cascade: items + photos references, notes, events) and chat conversations.
// Awaited so it completes before the function is frozen.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deleteFromCloudinary } from "../lib/cloudinary.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);
  try {
    await handleCustomerRedact(shop, payload);
  } catch (e) {
    console.error("[webhook customers/redact] handler failed:", e);
  }
  return new Response();
};

async function handleCustomerRedact(shop: string, payload: any) {
  const email: string | undefined = payload?.customer?.email;
  if (!email) {
    console.log("[webhook customers/redact] no customer email in payload — nothing to redact");
    return;
  }
  // Customer-uploaded evidence photos live on Cloudinary: delete them too.
  const items = await prisma.returnItem.findMany({
    where: { returnRequest: { shop, customerEmail: { equals: email, mode: "insensitive" } } },
    select: { photos: true },
  });
  const photoUrls = items.flatMap((it) => {
    try {
      return JSON.parse(it.photos || "[]") as string[];
    } catch {
      return [];
    }
  });
  await Promise.allSettled(photoUrls.slice(0, 100).map((u) => deleteFromCloudinary(u)));

  const deletedReturns = await prisma.returnRequest.deleteMany({
    where: { shop, customerEmail: { equals: email, mode: "insensitive" } },
  });
  const deletedConvs = await prisma.conversation.deleteMany({
    where: { shop, type: "CLIENT", customerEmail: email.toLowerCase() },
  });
  console.log(
    `[webhook customers/redact] redacted ${deletedReturns.count} return(s) and ${deletedConvs.count} conversation(s) on ${shop}`,
  );
}
