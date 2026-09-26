import prisma from "../db.server";
import { isRealEmail, sendPlainEmail } from "./mailer.server";

/** Email the merchant that a customer wrote in the portal chat. */
export async function sendChatEmail(params: {
  shop: string;
  customerName: string;
  customerEmail: string;
  bodyPreview: string;
}) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop: params.shop } });
  const merchantEmail = isRealEmail(settings?.fromEmail) ? settings!.fromEmail : null;
  if (!merchantEmail) {
    console.warn("[chat] no merchant email configured; skipping offline notification");
    return false;
  }

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const inboxUrl = apiKey
    ? `https://${params.shop}/admin/apps/${apiKey}/app/messages`
    : `${(process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "")}/app/messages`;
  const fr = settings?.defaultLocale === "fr";

  return sendPlainEmail({
    to: merchantEmail,
    fromName: "TrackBack",
    replyTo: params.customerEmail,
    subject: fr
      ? `💬 Nouveau message de ${params.customerName}`
      : `💬 New message from ${params.customerName}`,
    text: fr
      ? `${params.customerName} (${params.customerEmail}) vous a écrit :\n\n"${params.bodyPreview}"\n\nRépondre depuis TrackBack : ${inboxUrl}\n`
      : `${params.customerName} (${params.customerEmail}) just sent you a message:\n\n"${params.bodyPreview}"\n\nReply in your TrackBack inbox: ${inboxUrl}\n`,
  });
}
