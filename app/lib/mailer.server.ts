import nodemailer from "nodemailer";
import prisma from "../db.server";
import {
  BUILT_IN_TEMPLATES,
  EMAIL_STRINGS,
  fillTemplate,
  isLegacyDefault,
  storageType,
  type EmailType,
  type EmailVariable,
} from "./email-templates";
import { normalizeLocale, type Locale } from "./i18n";

/**
 * Transport: any SMTP provider (Gmail for tests, Brevo / Postmark / SES SMTP
 * relay in production — just change SMTP_HOST/PORT/USER/PASS). The sender
 * address is always TrackBack's (MAIL_FROM or SMTP_USER) so SPF/DKIM/DMARC
 * align; the merchant's address goes into Reply-To so customer replies reach
 * the merchant.
 */
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Seed placeholder used during onboarding — never a real mailbox.
const PLACEHOLDER_FROM_EMAIL = "returns@acmestore.com";

export const isRealEmail = (v?: string | null) =>
  !!v && v !== PLACEHOLDER_FROM_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function senderAddress(): string | null {
  return process.env.MAIL_FROM || process.env.SMTP_USER || null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeColor = (c: string | null | undefined, fallback: string) =>
  /^#[0-9a-fA-F]{6}$/.test(String(c ?? "")) ? String(c) : fallback;

const safeUrl = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

/** Escapes a text line then turns bare https:// URLs into links. */
function linkify(line: string, color: string): string {
  return escapeHtml(line).replace(
    /(https:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:${color};word-break:break-all;">${url}</a>`,
  );
}

export function buildHtmlEmail(args: {
  brandColor: string;
  logoUrl: string | null;
  storeName: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string | null;
  poweredBy: string;
  headerSubtitle: string;
  lang: string;
}) {
  const brand = safeColor(args.brandColor, "#6C63FF");
  const logo = safeUrl(args.logoUrl);
  const cta = safeUrl(args.ctaUrl);

  const paragraphs = args.bodyText
    .split("\n")
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px;line-height:1.65;font-size:14px;color:#1a1a2e;">${linkify(line, brand)}</p>`
        : `<div style="height:6px;line-height:6px;">&nbsp;</div>`,
    )
    .join("");

  const header = logo
    ? `<img src="${logo}" alt="${escapeHtml(args.storeName)}" style="height:38px;width:auto;display:block;max-width:200px;margin-bottom:8px;" />`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff;margin-bottom:4px;letter-spacing:-0.01em;">${escapeHtml(args.storeName)}</div>`;

  const ctaBlock =
    cta && args.ctaLabel
      ? `<tr><td style="padding:0 32px 24px;">
         <a href="${cta}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:${brand};color:#ffffff;font-weight:600;font-size:13px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(args.ctaLabel)}</a>
       </td></tr>`
      : "";

  const footer = args.poweredBy
    ? `<tr><td style="padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center;color:#9ca3af;font-size:12px;">🔒 ${escapeHtml(args.poweredBy)}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(args.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(args.storeName)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f7f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1117;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6ec;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
        <tr><td style="background:${brand};padding:24px 32px 20px;">
          ${header}
          <div style="font-size:12px;color:rgba(255,255,255,0.72);letter-spacing:0.04em;">${escapeHtml(args.headerSubtitle)}</div>
        </td></tr>
        <tr><td style="padding:28px 32px 12px;">${paragraphs}</td></tr>
        ${ctaBlock}
        ${footer}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Low-level send. Returns false instead of throwing — emails never break a flow. */
export async function sendPlainEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  fromName?: string;
}): Promise<boolean> {
  const from = senderAddress();
  if (!from) {
    console.error("[mailer] SMTP_USER / MAIL_FROM is not configured — cannot send email");
    return false;
  }
  if (!isRealEmail(args.to)) {
    console.warn(`[mailer] skipping email to invalid address "${args.to}"`);
    return false;
  }
  try {
    const name = (args.fromName || process.env.SMTP_FROM_NAME || "TrackBack").replace(/"/g, "'");
    const info = await getTransporter().sendMail({
      from: `"${name}" <${from}>`,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      ...(args.replyTo && isRealEmail(args.replyTo) ? { replyTo: args.replyTo } : {}),
    });
    console.log("[mailer] sent %s → %s", info.messageId, args.to);
    return true;
  } catch (error) {
    console.error("[mailer] send failed:", error);
    return false;
  }
}

/**
 * Resolves the subject/body for a type + locale:
 *   1. merchant override for that locale ("Approved@fr")
 *   2. legacy override (no locale suffix) — only for the shop's default
 *      language, and only if the merchant actually edited it
 *   3. built-in template
 */
export async function resolveTemplate(args: {
  shop: string;
  type: EmailType;
  locale: Locale;
  defaultLocale: Locale;
  storeName: string;
  allowCustom: boolean;
}): Promise<{ subject: string; body: string; custom: boolean }> {
  const builtIn = BUILT_IN_TEMPLATES[args.locale][args.type];
  if (!args.allowCustom) return { ...builtIn, custom: false };

  const localized = await prisma.emailTemplate.findUnique({
    where: { shop_type: { shop: args.shop, type: storageType(args.type, args.locale) } },
  });
  if (localized?.subject && localized?.body) {
    return { subject: localized.subject, body: localized.body, custom: true };
  }
  if (args.locale === args.defaultLocale) {
    const legacy = await prisma.emailTemplate.findUnique({
      where: { shop_type: { shop: args.shop, type: args.type } },
    });
    if (legacy?.subject && legacy?.body && !isLegacyDefault(args.type, legacy.subject, legacy.body)) {
      // Older templates hard-coded the demo store name.
      const fix = (s: string) => s.replace(/Acme Store/g, "{{store_name}}");
      return { subject: fix(legacy.subject), body: fix(legacy.body), custom: true };
    }
  }
  return { ...builtIn, custom: false };
}

export interface TemplatedEmailArgs {
  shop: string;
  type: EmailType;
  to: string;
  locale?: string | null;
  vars: Partial<Record<EmailVariable, string>>;
  cta?: { label: string; url: string } | null;
  /** Merchant branding & policy (pass what you already loaded to save a query). */
  settings?: {
    defaultLocale?: string | null;
    brandColor?: string | null;
    emailBrandColor?: string | null;
    logoUrl?: string | null;
    portalStoreName?: string | null;
    labelPoweredBy?: string | null;
    fromEmail?: string | null;
  } | null;
  allowCustomTemplates: boolean;
  whiteLabel: boolean;
}

export async function sendTemplatedEmail(args: TemplatedEmailArgs): Promise<boolean> {
  try {
    const settings =
      args.settings ?? (await prisma.shopSettings.findUnique({ where: { shop: args.shop } }));
    const defaultLocale = normalizeLocale(settings?.defaultLocale) ?? "en";
    const locale = normalizeLocale(args.locale) ?? defaultLocale;
    const strings = EMAIL_STRINGS[locale];
    const storeName = args.vars.store_name || settings?.portalStoreName || args.shop.split(".")[0];

    const tpl = await resolveTemplate({
      shop: args.shop,
      type: args.type,
      locale,
      defaultLocale,
      storeName,
      allowCustom: args.allowCustomTemplates,
    });
    const vars = { ...args.vars, store_name: storeName };
    const subject = fillTemplate(tpl.subject, vars).replace(/\s+/g, " ").trim();
    const text = fillTemplate(tpl.body, vars).trim();

    const poweredBy = args.whiteLabel ? (settings?.labelPoweredBy ?? strings.poweredBy) : strings.poweredBy;
    const html = buildHtmlEmail({
      brandColor: settings?.emailBrandColor || settings?.brandColor || "#6C63FF",
      logoUrl: settings?.logoUrl ?? null,
      storeName,
      bodyText: text,
      ctaLabel: args.cta?.label,
      ctaUrl: args.cta?.url ?? null,
      poweredBy,
      headerSubtitle: strings.returnCenter,
      lang: locale,
    });

    return sendPlainEmail({
      to: args.to,
      subject,
      text,
      html,
      replyTo: settings?.fromEmail ?? null,
      fromName: storeName,
    });
  } catch (error) {
    console.error(`[mailer] ${args.type} email failed:`, error);
    return false;
  }
}
