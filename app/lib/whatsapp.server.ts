/**
 * Automated WhatsApp updates through the Meta WhatsApp Cloud API (Pro).
 *
 * The merchant brings their own WhatsApp Business credentials (Settings →
 * Notifications): phone number ID, a permanent access token and the name of
 * an approved *utility* message template with three body variables:
 *   {{1}} customer name · {{2}} return number · {{3}} update text
 * Everything is optional: when not configured this is a no-op.
 */
import type { EmailType } from "./email-templates";
import { EMAIL_STRINGS } from "./email-templates";
import type { Locale } from "./i18n";
import { formatMoney } from "./money";
import { phoneDigits } from "./returns-logic";
import { whatsappStatusText } from "./whatsapp";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

type Settings = {
  whatsappNotifyEnabled: boolean;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  whatsappTemplateName: string;
  whatsappTemplateLang: string;
  currency: string;
};

type Rr = {
  rma: string;
  orderName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  refundType: string;
  refundAmount: number;
  itemsTotal: number;
  rejectionReason: string | null;
};

export function whatsappApiConfigured(s: Partial<Settings> | null | undefined): boolean {
  return !!(s?.whatsappNotifyEnabled && s.whatsappPhoneNumberId && s.whatsappAccessToken && s.whatsappTemplateName);
}

export async function sendWhatsAppUpdate(args: {
  settings: Settings;
  rr: Rr;
  type: EmailType;
  locale: Locale;
  statusLink: string;
}): Promise<boolean> {
  const { settings, rr } = args;
  if (!whatsappApiConfigured(settings)) return false;
  const to = phoneDigits(rr.customerPhone);
  if (to.length < 8) return false;

  const s = EMAIL_STRINGS[args.locale];
  const method =
    rr.refundType === "STORE_CREDIT"
      ? s.methodStoreCredit
      : rr.refundType === "GIFT_CARD"
        ? s.methodGiftCard
        : rr.refundType === "EXCHANGE"
          ? s.methodExchange
          : s.methodRefund;
  const update = whatsappStatusText(args.type, args.locale, {
    name: rr.customerName || rr.customerEmail.split("@")[0],
    rma: rr.rma,
    order: rr.orderName,
    url: args.statusLink,
    reason: rr.rejectionReason ?? undefined,
    method,
    amount: formatMoney(rr.refundAmount || rr.itemsTotal, settings.currency || "USD"),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(settings.whatsappPhoneNumberId)}/messages`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${settings.whatsappAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: settings.whatsappTemplateName,
            language: { code: settings.whatsappTemplateLang || args.locale },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: rr.customerName || "—" },
                  { type: "text", text: rr.rma },
                  { type: "text", text: update.slice(0, 1000) },
                ],
              },
            ],
          },
        }),
      },
    );
    if (!res.ok) {
      console.error(`[whatsapp] send failed (${res.status}):`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp] send threw:", e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
