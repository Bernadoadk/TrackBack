/**
 * WhatsApp helpers shared by the admin (click-to-chat buttons) and the
 * server (automated Cloud API updates). Pure module.
 */
import { interpolate, type Locale } from "./i18n";
import { phoneDigits } from "./returns-logic";

/** https://wa.me link with a prefilled message. Returns null for unusable numbers. */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  const digits = phoneDigits(phone);
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

type Msg = Record<string, string>;

export const WHATSAPP_MESSAGES: Record<Locale, Msg> = {
  en: {
    "Request Received": "Hi {name}, we received your return request {rma}. We'll review it shortly. Follow it here: {url}",
    Approved: "Hi {name}, your return {rma} is approved! {instructions} Follow it here: {url}",
    Rejected: "Hi {name}, we're sorry: your return request {rma} couldn't be approved. Reason: {reason}",
    Shipped: "Hi {name}, thank you! Your return {rma} is on its way back to us.",
    Received: "Hi {name}, we received the items of your return {rma}. Your {method} is being processed.",
    Refunded: "Hi {name}, your return {rma} is complete: {method} of {amount}.",
    Expired: "Hi {name}, your return {rma} has expired because we didn't receive the parcel in time. Reply here if you need help.",
    "Withdrawal Received": "Hi {name}, we confirm receipt of your withdrawal for order {order} (ref. {rma}).",
  },
  fr: {
    "Request Received": "Bonjour {name}, nous avons reçu votre demande de retour {rma}. Nous l'examinons rapidement. Suivi : {url}",
    Approved: "Bonjour {name}, votre retour {rma} est accepté ! {instructions} Suivi : {url}",
    Rejected: "Bonjour {name}, nous sommes désolés : votre demande de retour {rma} n'a pas pu être acceptée. Motif : {reason}",
    Shipped: "Bonjour {name}, merci ! Votre retour {rma} est en route vers nous.",
    Received: "Bonjour {name}, nous avons reçu les articles de votre retour {rma}. Votre {method} est en cours de traitement.",
    Refunded: "Bonjour {name}, votre retour {rma} est finalisé : {method} de {amount}.",
    Expired: "Bonjour {name}, votre retour {rma} a expiré car nous n'avons pas reçu le colis à temps. Répondez ici si besoin.",
    "Withdrawal Received": "Bonjour {name}, nous confirmons la réception de votre rétractation pour la commande {order} (réf. {rma}).",
  },
};

export function whatsappStatusText(
  type: string,
  locale: Locale,
  vars: { name: string; rma: string; order?: string; url?: string; reason?: string; method?: string; amount?: string; instructions?: string },
): string {
  const tpl = WHATSAPP_MESSAGES[locale][type] ?? WHATSAPP_MESSAGES[locale].Approved;
  return interpolate(tpl, {
    name: vars.name,
    rma: vars.rma,
    order: vars.order ?? "",
    url: vars.url ?? "",
    reason: vars.reason ?? "—",
    method: vars.method ?? "",
    amount: vars.amount ?? "",
    instructions: vars.instructions ?? "",
  })
    .replace(/\s+/g, " ")
    .trim();
}
