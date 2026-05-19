import nodemailer from "nodemailer";
import { EMAIL_TEMPLATES } from "../components/mock-data";
import prisma from "../db.server";

// Seed placeholder used during onboarding — must NOT be used as a real sender,
// the domain has no MX records and any reply / SPF check will bounce.
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

// Minimal HTML escaper for body text → tags (we control the wrapper).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Wrap the plain-text body in the same branded card the merchant sees in the
 * Email Templates preview: brand-color header (logo or store name), paragraphs
 * built from line breaks, optional CTA, and the secured-by footer.
 */
function buildHtmlEmail(args: {
  brandColor: string;
  logoUrl: string | null;
  storeName: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string | null;
  poweredBy: string;
}) {
  const { brandColor, logoUrl, storeName, bodyText, ctaLabel, ctaUrl, poweredBy } = args;

  const paragraphs = bodyText
    .split("\n")
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 14px;line-height:1.65;font-size:14px;color:#1a1a2e;">${escapeHtml(line)}</p>`
        : `<div style="height:6px;line-height:6px;">&nbsp;</div>`
    )
    .join("");

  const header = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(storeName)}" style="height:38px;width:auto;display:block;max-width:200px;margin-bottom:8px;" />`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff;margin-bottom:4px;letter-spacing:-0.01em;">${escapeHtml(storeName)}</div>`;

  const ctaBlock = ctaUrl && ctaLabel
    ? `<tr><td style="padding:0 32px 24px;">
         <a href="${ctaUrl}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:${brandColor};color:#ffffff;font-weight:600;font-size:13px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(ctaLabel)}</a>
       </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(storeName)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f7f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1117;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6ec;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
        <tr><td style="background:${brandColor};padding:24px 32px 20px;">
          ${header}
          <div style="font-size:12px;color:rgba(255,255,255,0.72);letter-spacing:0.04em;">Return Center</div>
        </td></tr>
        <tr><td style="padding:28px 32px 12px;">${paragraphs}</td></tr>
        ${ctaBlock}
        <tr><td style="padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center;color:#9ca3af;font-size:12px;">🔒 ${escapeHtml(poweredBy)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendReturnEmail(
  type: "Request Received" | "Approved" | "Rejected" | "Refunded" | "Shipped" | "Expired",
  data: {
    to: string;
    shop?: string;
    fromEmail?: string;
    customer_name: string;
    rma_number: string;
    order_number: string;
    item_count?: string;
    refund_amount?: string;
    rejection_reason?: string;
    carrier?: string;
    tracking_number?: string;
    tracking_url?: string;
    store_credit_code?: string;
    label_url?: string;
    exchange_url?: string;
    refund_method?: string;
  }
) {
  try {
    // ── Resolve template (custom in DB, fallback to built-in) ────────────────
    let subject = "";
    let body = "";
    let brandColor = "#6C63FF";
    let logoUrl: string | null = null;
    let storeName = data.shop?.split(".")[0] ?? "Store";
    let poweredBy = "Secured by TrackBack";

    if (data.shop) {
      const [dbTemplate, settings] = await Promise.all([
        prisma.emailTemplate.findUnique({
          where: { shop_type: { shop: data.shop, type } },
        }),
        prisma.shopSettings.findUnique({ where: { shop: data.shop } }),
      ]);

      if (dbTemplate) {
        subject = dbTemplate.subject;
        body = dbTemplate.body;
      }
      if (settings) {
        brandColor = settings.brandColor || brandColor;
        logoUrl = settings.logoUrl || null;
        storeName = settings.portalStoreName || storeName;
        if (settings.labelPoweredBy) poweredBy = settings.labelPoweredBy;
      }
    }

    if (!subject || !body) {
      const template = EMAIL_TEMPLATES[type];
      if (!template) throw new Error("Template not found for type: " + type);
      subject = template.subject;
      body = template.body;
    }

    // ── Append dynamic contextual blocks (store credit, label, tracking…) ───
    const storeCreditBlock = data.store_credit_code
      ? `\n\nYour store credit: ${data.store_credit_code}\nIt's been added to your account and will be applied automatically at your next checkout.`
      : "";
    const labelBlock = data.label_url
      ? `\n\nDownload your prepaid shipping label: ${data.label_url}`
      : "";
    const trackingBlock = data.tracking_url
      ? `\n\nTrack your return live: ${data.tracking_url}`
      : "";
    const exchangeBlock = data.exchange_url
      ? `\n\nComplete your exchange here: ${data.exchange_url}\nThe credit from your return has already been applied.`
      : "";

    const fill = (s: string) =>
      s
        .replace(/\{\{customer_name\}\}/g, data.customer_name)
        .replace(/\{\{rma_number\}\}/g, data.rma_number)
        .replace(/\{\{order_number\}\}/g, data.order_number)
        .replace(/\{\{item_count\}\}/g, data.item_count || "")
        .replace(/\{\{refund_amount\}\}/g, data.refund_amount || "")
        .replace(/\{\{rejection_reason\}\}/g, data.rejection_reason || "")
        .replace(/\{\{carrier\}\}/g, data.carrier || "N/A")
        .replace(/\{\{tracking_number\}\}/g, data.tracking_number || "N/A")
        .replace(/\{\{tracking_url\}\}/g, data.tracking_url || "")
        .replace(/\{\{store_credit_code\}\}/g, data.store_credit_code || "")
        .replace(/\{\{label_url\}\}/g, data.label_url || "")
        .replace(/\{\{exchange_url\}\}/g, data.exchange_url || "") +
      (type === "Approved" && data.label_url ? labelBlock : "") +
      (type === "Shipped" && data.tracking_url ? trackingBlock : "") +
      (type === "Refunded" && data.store_credit_code ? storeCreditBlock : "") +
      (type === "Refunded" && data.exchange_url ? exchangeBlock : "");

    const filledSubject = fill(subject);
    const filledBody = fill(body);

    // ── Pick a CTA appropriate to the email type ────────────────────────────
    let ctaLabel: string | undefined;
    let ctaUrl: string | null = null;
    if (data.exchange_url) {
      ctaLabel = "Complete your exchange";
      ctaUrl = data.exchange_url;
    } else if (data.tracking_url) {
      ctaLabel = "Track your return";
      ctaUrl = data.tracking_url;
    } else if (data.label_url) {
      ctaLabel = "Download shipping label";
      ctaUrl = data.label_url;
    } else if (data.shop) {
      ctaLabel = "View return status";
      ctaUrl = `https://${data.shop}/apps/returns`;
    }

    // ── Build HTML body wrapped in the brand card ───────────────────────────
    const html = buildHtmlEmail({
      brandColor,
      logoUrl,
      storeName,
      bodyText: filledBody,
      ctaLabel,
      ctaUrl,
      poweredBy,
    });

    // ── Resolve From address — never use the onboarding placeholder ─────────
    const fromAddr = isRealEmail(data.fromEmail)
      ? data.fromEmail!
      : process.env.SMTP_USER;
    if (!fromAddr) {
      console.error("[mailer] SMTP_USER is not configured — cannot send email");
      return false;
    }
    const fromName = process.env.SMTP_FROM_NAME || storeName;
    const from = `"${fromName}" <${fromAddr}>`;

    const info = await transporter.sendMail({
      from,
      to: data.to,
      subject: filledSubject,
      text: filledBody, // plain-text fallback for clients without HTML
      html,
    });

    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}
