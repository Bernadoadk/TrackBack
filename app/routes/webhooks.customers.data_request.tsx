// GDPR — customers/data_request
//
// Emails the merchant everything TrackBack stores about the customer so they
// can forward it. The work is awaited (not fire-and-forget): on serverless
// hosting, code running after the response may never complete.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { isRealEmail, sendPlainEmail } from "../lib/mailer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);
  try {
    await handleDataRequest(shop, payload);
  } catch (e) {
    console.error("[webhook customers/data_request] handler failed:", e);
  }
  return new Response();
};

async function handleDataRequest(shop: string, payload: any) {
  const email: string | undefined = payload?.customer?.email;
  const customerId: string | undefined = payload?.customer?.id?.toString();
  const phone: string | undefined = payload?.customer?.phone;

  const returnRequests = email
    ? await prisma.returnRequest.findMany({
        where: { shop, customerEmail: { equals: email, mode: "insensitive" } },
        include: { items: true },
      })
    : [];

  const conversation = email
    ? await prisma.conversation.findUnique({
        where: {
          shop_type_customerEmail: { shop, type: "CLIENT", customerEmail: email.toLowerCase() },
        },
        include: { messages: true },
      })
    : null;

  const dataExport = {
    shop,
    requestedAt: new Date().toISOString(),
    customer: { id: customerId, email, phone },
    returnRequests: returnRequests.map((r) => ({
      rma: r.rma,
      type: r.requestType,
      orderName: r.orderName,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      status: r.status,
      refundType: r.refundType,
      refundAmount: r.refundAmount,
      payout: r.payoutMethod ? { method: r.payoutMethod, account: r.payoutAccount, name: r.payoutName } : null,
      createdAt: r.createdAt,
      items: r.items.map((it) => ({
        name: it.name,
        variantName: it.variantName,
        quantity: it.quantity,
        price: it.price,
        reason: it.reason,
        note: it.note,
        photos: it.photos ? JSON.parse(it.photos || "[]") : [],
      })),
    })),
    chatMessages: conversation
      ? conversation.messages.map((m) => ({ senderType: m.senderType, body: m.body, createdAt: m.createdAt }))
      : [],
  };

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const merchantEmail = isRealEmail(settings?.fromEmail) ? settings!.fromEmail : null;
  if (!merchantEmail) {
    console.log("[webhook customers/data_request] No merchant email — logged-only payload:", JSON.stringify(dataExport));
    return;
  }

  await sendPlainEmail({
    to: merchantEmail,
    fromName: "TrackBack GDPR",
    subject: `[GDPR] Customer data request — ${email ?? customerId ?? "unknown"}`,
    text:
      `A customer has requested a copy of their data via Shopify GDPR webhook.\n\n` +
      `Customer: ${email ?? "(no email)"} (id ${customerId ?? "—"})\n` +
      `Shop: ${shop}\n\n` +
      `Below is the data TrackBack holds for this customer. Please forward it to them per your privacy policy.\n\n` +
      `${JSON.stringify(dataExport, null, 2)}\n`,
  });
}
