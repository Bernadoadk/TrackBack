import prisma from "../db.server";
import { EMAIL_STRINGS, type EmailType, type EmailVariable } from "./email-templates";
import { formatDateTime, interpolate, maskAccount, normalizeLocale, payoutMethodLabel, type Locale } from "./i18n";
import { isRealEmail, sendPlainEmail, sendTemplatedEmail } from "./mailer.server";
import { formatMoney } from "./money";
import { getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";
import { getReturnMethods } from "./returns-logic";
import { signStatusToken } from "./tokens.server";
import { sendWhatsAppUpdate } from "./whatsapp.server";

const DEFAULT_ADDRESS_MARKER = "Acme Store";

/** Public link to a return's status page (goes through the store's app proxy). */
export function statusUrl(shop: string, rma: string): string {
  return `https://${shop}/apps/returns?t=${encodeURIComponent(signStatusToken({ shop, rma }))}`;
}

/** Embedded-admin link to a return (used in merchant emails). */
export function adminReturnUrl(shop: string, rma: string): string {
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return apiKey
    ? `https://${shop}/admin/apps/${apiKey}/app/returns/${encodeURIComponent(rma)}`
    : `${(process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "")}/app/returns/${encodeURIComponent(rma)}`;
}

export function realReturnAddress(address: string | null | undefined): string {
  const a = String(address ?? "").trim();
  return a && !a.includes(DEFAULT_ADDRESS_MARKER) ? a : "";
}

type ReturnWithContext = NonNullable<Awaited<ReturnType<typeof loadReturn>>>;

async function loadReturn(id: string) {
  return prisma.returnRequest.findUnique({
    where: { id },
    include: { items: true, settings: true },
  });
}

/** Text instructions for the email body, depending on the return method. */
export function buildReturnInstructions(rr: ReturnWithContext, locale: Locale, url: string): string {
  const s = EMAIL_STRINGS[locale];
  const settings = rr.settings;
  if (rr.keepItem) return s.instrKeep;
  const methods = getReturnMethods(settings);
  const method = methods.includes(rr.returnMethod as never) ? rr.returnMethod : methods[0];
  switch (method) {
    case "label":
      return rr.labelUrl ? interpolate(s.instrLabel, { label: rr.labelUrl }) : s.instrLabelPending;
    case "store":
      return interpolate(s.instrStore, { rma: rr.rma, info: settings.storeDropoffInfo || realReturnAddress(settings.returnAddress) });
    case "pickup":
      return interpolate(s.instrPickup, { rma: rr.rma, info: settings.pickupInfo || "" }).trim();
    default: {
      const address = realReturnAddress(settings.returnAddress);
      return address
        ? interpolate(s.instrShip, { address, rma: rr.rma, url })
        : interpolate(s.instrShipNoAddress, { rma: rr.rma });
    }
  }
}

export function refundMethodPhrase(refundType: string, locale: Locale): string {
  const s = EMAIL_STRINGS[locale];
  switch (refundType) {
    case "STORE_CREDIT":
      return s.methodStoreCredit;
    case "GIFT_CARD":
      return s.methodGiftCard;
    case "EXCHANGE":
      return s.methodExchange;
    default:
      return s.methodRefund;
  }
}

function refundDetails(rr: ReturnWithContext, locale: Locale, currency: string, extra: NotifyExtra): string {
  const s = EMAIL_STRINGS[locale];
  const lines: string[] = [];
  switch (rr.refundType) {
    case "STORE_CREDIT":
      lines.push(s.detailsStoreCredit);
      break;
    case "GIFT_CARD":
      lines.push(
        interpolate(s.detailsGiftCard, {
          code: extra.giftCardCode || (rr.giftCardLastChars ? `•••• ${rr.giftCardLastChars}` : ""),
        }),
      );
      break;
    case "EXCHANGE":
      lines.push(
        extra.exchangeUrl || rr.exchangeOrderUrl
          ? interpolate(s.detailsExchangeLink, { url: extra.exchangeUrl || rr.exchangeOrderUrl || "" })
          : s.detailsExchange,
      );
      break;
    case "MANUAL":
      lines.push(
        interpolate(s.detailsManual, {
          method: payoutMethodLabel(rr.payoutMethod, locale),
          account: maskAccount(rr.payoutAccount) || "—",
        }),
      );
      if (rr.payoutReference) lines.push(interpolate(s.detailsManualRef, { ref: rr.payoutReference }));
      break;
    default:
      lines.push(s.detailsOriginal);
  }
  if (rr.feeAmount > 0) lines.push(interpolate(s.feesLine, { amount: formatMoney(rr.feeAmount, currency) }));
  return lines.join("\n");
}

export interface NotifyExtra {
  giftCardCode?: string;
  exchangeUrl?: string;
  trackingUrl?: string | null;
}

/**
 * Sends the customer email (and WhatsApp update when enabled) for a return
 * lifecycle event. Never throws.
 */
export async function notifyCustomer(type: EmailType, returnRequestId: string, extra: NotifyExtra = {}) {
  try {
    const rr = await loadReturn(returnRequestId);
    if (!rr) return false;
    const settings = rr.settings;
    const plan = await getShopPlan(rr.shop);
    const locale: Locale = normalizeLocale(rr.locale) ?? normalizeLocale(settings.defaultLocale) ?? "en";
    const currency = settings.currency || "USD";
    const s = EMAIL_STRINGS[locale];
    const url = statusUrl(rr.shop, rr.rma);

    const itemCount = rr.items.reduce((sum, it) => sum + it.quantity, 0);
    const itemsList = rr.items
      .map((it) => `${it.name}${it.variantName && it.variantName !== "Default Title" ? ` (${it.variantName})` : ""} ×${it.quantity}`)
      .join(", ");

    const vars: Partial<Record<EmailVariable, string>> = {
      customer_name: rr.customerName || rr.customerEmail.split("@")[0],
      store_name: settings.portalStoreName || rr.shop.split(".")[0],
      rma_number: rr.rma,
      order_number: rr.orderName,
      item_count: String(itemCount),
      items_list: itemsList,
      refund_amount: formatMoney(rr.refundAmount || rr.itemsTotal, currency),
      refund_method: refundMethodPhrase(rr.refundType, locale),
      rejection_reason: rr.rejectionReason || "—",
      carrier: rr.carrier || "—",
      tracking_number: rr.trackingNumber || "—",
      return_instructions: buildReturnInstructions(rr, locale, url),
      return_address: realReturnAddress(settings.returnAddress),
      status_url: url,
      fee_amount: formatMoney(rr.feeAmount, currency),
      request_date: formatDateTime(rr.createdAt, locale),
    };
    if (type === "Refunded") vars.refund_details = refundDetails(rr, locale, currency, extra);

    let cta: { label: string; url: string } | null = { label: s.ctaStatus, url };
    if (type === "Approved" && rr.labelUrl && /^https:\/\//.test(rr.labelUrl)) {
      cta = { label: s.ctaLabel, url: rr.labelUrl };
    } else if (type === "Shipped" && (extra.trackingUrl || rr.trackingUrl)) {
      cta = { label: s.ctaTrack, url: (extra.trackingUrl || rr.trackingUrl)! };
    } else if (type === "Refunded" && rr.refundType === "EXCHANGE" && (extra.exchangeUrl || rr.exchangeOrderUrl)) {
      cta = { label: s.ctaExchange, url: (extra.exchangeUrl || rr.exchangeOrderUrl)! };
    }

    const sent = await sendTemplatedEmail({
      shop: rr.shop,
      type,
      to: rr.customerEmail,
      locale,
      vars,
      cta,
      settings,
      allowCustomTemplates: hasFeature(plan, "emailTemplates"),
      whiteLabel: hasFeature(plan, "whiteLabel"),
    });

    if (rr.whatsappOptIn && hasFeature(plan, "whatsapp")) {
      await sendWhatsAppUpdate({ settings, rr, type, locale, statusLink: url });
    }
    return sent;
  } catch (e) {
    console.error(`[notify] ${type} failed for ${returnRequestId}:`, e);
    return false;
  }
}

/** Internal notification to the merchant for a new request. */
export async function notifyMerchantNewReturn(returnRequestId: string) {
  try {
    const rr = await loadReturn(returnRequestId);
    if (!rr) return false;
    const settings = rr.settings;
    if (!settings.notifyMerchant || !isRealEmail(settings.fromEmail)) return false;
    const fr = settings.defaultLocale === "fr";
    const currency = settings.currency || "USD";
    const lines = rr.items.map(
      (it) => `• ${it.name}${it.variantName && it.variantName !== "Default Title" ? ` (${it.variantName})` : ""} ×${it.quantity} — ${it.reason}${it.note ? ` — "${it.note}"` : ""}`,
    );
    const kind = rr.requestType === "WITHDRAWAL" ? (fr ? "Rétractation" : "Withdrawal") : fr ? "Retour" : "Return";
    const risk =
      rr.riskLevel === "high" || rr.riskLevel === "medium"
        ? fr
          ? `\n⚠️ Risque ${rr.riskLevel === "high" ? "élevé" : "modéré"} : client qui retourne souvent.`
          : `\n⚠️ ${rr.riskLevel === "high" ? "High" : "Medium"} risk: frequent returner.`
        : "";
    const text = fr
      ? `${kind} ${rr.rma} — commande ${rr.orderName}\nClient : ${rr.customerName} (${rr.customerEmail})\n\n${lines.join("\n")}\n\nMontant estimé : ${formatMoney(rr.refundAmount || rr.itemsTotal, currency)}${risk}\n\nOuvrir dans TrackBack : ${adminReturnUrl(rr.shop, rr.rma)}\n`
      : `${kind} ${rr.rma} — order ${rr.orderName}\nCustomer: ${rr.customerName} (${rr.customerEmail})\n\n${lines.join("\n")}\n\nEstimated amount: ${formatMoney(rr.refundAmount || rr.itemsTotal, currency)}${risk}\n\nOpen in TrackBack: ${adminReturnUrl(rr.shop, rr.rma)}\n`;
    return sendPlainEmail({
      to: settings.fromEmail,
      subject: fr
        ? `📦 Nouvelle demande ${rr.rma} — ${rr.customerName}`
        : `📦 New return request ${rr.rma} — ${rr.customerName}`,
      text,
      fromName: "TrackBack",
      replyTo: rr.customerEmail,
    });
  } catch (e) {
    console.error("[notify] merchant notification failed:", e);
    return false;
  }
}
