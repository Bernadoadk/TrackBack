// GDPR — customers/data_request
//
// Triggered when a Shopify customer requests a copy of the data the merchant
// (and apps) hold about them. The app must respond with what it stores.
// We email the merchant the data we have on the customer so they can forward
// it to the customer per their privacy policy.
//
// HMAC verification is handled by authenticate.webhook(request).
// Must return 200 within 5s.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import nodemailer from "nodemailer";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  // Respond immediately, then do work in background (fire-and-forget)
  // — Shopify requires a 200 within 5s.
  void handleDataRequest(shop, payload).catch((e) =>
    console.error("[webhook customers/data_request] handler failed:", e),
  );

  return new Response();
};

async function handleDataRequest(shop: string, payload: any) {
  const email: string | undefined = payload?.customer?.email;
  const customerId: string | undefined = payload?.customer?.id?.toString();
  const phone: string | undefined = payload?.customer?.phone;

  // Pull every record we have on this customer for this shop
  const returnRequests = email
    ? await prisma.returnRequest.findMany({
      where: { shop, customerEmail: { equals: email, mode: "insensitive" } },
      include: { items: true },
    })
    : [];

  const conversation = email
    ? await prisma.conversation.findUnique({
      where: {
        shop_type_customerEmail: {
          shop,
          type: "CLIENT",
          customerEmail: email.toLowerCase(),
        },
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
      orderName: r.orderName,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      status: r.status,
      refundType: r.refundType,
      refundAmount: r.refundAmount,
      createdAt: r.createdAt,
      items: r.items.map((it) => ({
        name: it.name,
        variantName: it.variantName,
        quantity: it.quantity,
        price: it.price,
        reason: it.reason,
        note: it.note,
      })),
    })),
    chatMessages: conversation
      ? conversation.messages.map((m) => ({
        senderType: m.senderType,
        body: m.body,
        createdAt: m.createdAt,
      }))
      : [],
  };

  // Find the merchant email
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const merchantEmail =
    settings?.fromEmail || process.env.SMTP_USER || process.env.SHOPIFY_APP_DEFAULT_EMAIL;

  if (!merchantEmail) {
    console.log(
      "[webhook customers/data_request] No merchant email — logged-only payload:",
      JSON.stringify(dataExport),
    );
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"TrackBack GDPR" <${process.env.SMTP_USER}>`,
      to: merchantEmail,
      subject: `[GDPR] Customer data request — ${email ?? customerId ?? "unknown"}`,
      text:
        `A customer has requested a copy of their data via Shopify GDPR webhook.\n\n` +
        `Customer: ${email ?? "(no email)"} (id ${customerId ?? "—"})\n` +
        `Shop: ${shop}\n\n` +
        `Below is the data TrackBack holds for this customer. Please forward it to them per your privacy policy.\n\n` +
        `${JSON.stringify(dataExport, null, 2)}\n`,
    });
    console.log(
      `[webhook customers/data_request] export emailed to ${merchantEmail}`,
    );
  } catch (e) {
    console.error("[webhook customers/data_request] email failed:", e);
  }
}
