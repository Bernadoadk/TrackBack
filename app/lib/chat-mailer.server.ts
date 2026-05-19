import nodemailer from "nodemailer";
import prisma from "../db.server";

// Seed placeholder used during onboarding — must NOT be used as a real
// destination, the domain has no MX records and Gmail bounces every delivery.
const PLACEHOLDER_FROM_EMAIL = "returns@acmestore.com";
const isRealEmail = (v?: string | null) =>
  !!v && v !== PLACEHOLDER_FROM_EMAIL && /.+@.+\..+/.test(v);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendChatEmail(params: {
  shop: string;
  to: string;
  customerName: string;
  customerEmail: string;
  bodyPreview: string;
}) {
  const settings = await prisma.shopSettings.findUnique({
    where: { shop: params.shop },
  });
  const merchantEmail = isRealEmail(settings?.fromEmail)
    ? settings!.fromEmail!
    : process.env.SMTP_USER;
  if (!merchantEmail) {
    console.warn("[chat] no merchant email configured (fromEmail is placeholder and SMTP_USER missing); skipping notification");
    return false;
  }

  const adminUrl = (process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ?? "") +
    "/app/messages";

  try {
    const info = await transporter.sendMail({
      from: `"TrackBack Chat" <${process.env.SMTP_USER}>`,
      to: merchantEmail,
      subject: `💬 New message from ${params.customerName}`,
      text:
        `${params.customerName} (${params.customerEmail}) just sent you a message:\n\n` +
        `"${params.bodyPreview}"\n\n` +
        `Reply in your TrackBack inbox: ${adminUrl}\n`,
    });
    console.log("[chat] notify email sent:", info.messageId);
    return true;
  } catch (e) {
    console.error("[chat] notify email failed:", e);
    return false;
  }
}
