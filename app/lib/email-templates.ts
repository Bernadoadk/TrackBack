/**
 * Built-in customer email templates (EN / FR) + the variables each one can
 * use. Pure module: shared by the mailer and the Email Templates editor.
 *
 * Storage convention for merchant overrides (EmailTemplate table, unique on
 * shop+type): `type` = "Approved" is the legacy override for the shop's
 * default language, "Approved@fr" the override for a specific language.
 */

import type { Locale } from "./i18n";

export const EMAIL_TYPES = [
  "Request Received",
  "Approved",
  "Rejected",
  "Shipped",
  "Received",
  "Refunded",
  "Expired",
  "Withdrawal Received",
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const EMAIL_VARIABLES = [
  "customer_name",
  "store_name",
  "rma_number",
  "order_number",
  "item_count",
  "items_list",
  "refund_amount",
  "refund_method",
  "refund_details",
  "rejection_reason",
  "carrier",
  "tracking_number",
  "return_instructions",
  "return_address",
  "status_url",
  "fee_amount",
  "request_date",
] as const;
export type EmailVariable = (typeof EMAIL_VARIABLES)[number];

export const VARIABLE_LABELS: Record<EmailVariable, string> = {
  customer_name: "Customer name",
  store_name: "Store name",
  rma_number: "RMA number",
  order_number: "Order #",
  item_count: "Item count",
  items_list: "Items list",
  refund_amount: "Refund amount",
  refund_method: "Refund method",
  refund_details: "Refund details",
  rejection_reason: "Rejection reason",
  carrier: "Carrier",
  tracking_number: "Tracking number",
  return_instructions: "Return instructions",
  return_address: "Return address",
  status_url: "Status page link",
  fee_amount: "Fees",
  request_date: "Request date",
};

/** Variables suggested in the editor for each email type. */
export const TYPE_VARIABLES: Record<EmailType, EmailVariable[]> = {
  "Request Received": ["customer_name", "store_name", "rma_number", "order_number", "item_count", "items_list", "status_url"],
  Approved: ["customer_name", "store_name", "rma_number", "order_number", "return_instructions", "return_address", "refund_amount", "refund_method", "status_url"],
  Rejected: ["customer_name", "store_name", "rma_number", "order_number", "rejection_reason"],
  Shipped: ["customer_name", "store_name", "rma_number", "carrier", "tracking_number", "status_url"],
  Received: ["customer_name", "store_name", "rma_number", "refund_amount", "refund_method"],
  Refunded: ["customer_name", "store_name", "rma_number", "order_number", "refund_amount", "refund_method", "refund_details", "fee_amount"],
  Expired: ["customer_name", "store_name", "rma_number", "order_number"],
  "Withdrawal Received": ["customer_name", "store_name", "rma_number", "order_number", "items_list", "request_date", "return_instructions"],
};

export const TYPE_DESCRIPTIONS: Record<EmailType, string> = {
  "Request Received": "Sent to the customer right after they submit a return.",
  Approved: "Sent when you approve a return — includes the return instructions.",
  Rejected: "Sent when you decline a return.",
  Shipped: "Sent when the return parcel is on its way back to you.",
  Received: "Sent when you mark the items as received.",
  Refunded: "Sent when the refund, store credit, gift card or exchange is issued.",
  Expired: "Sent when an approved return expires without being shipped.",
  "Withdrawal Received": "EU withdrawal acknowledgment, sent immediately (legal requirement).",
};

type Template = { subject: string; body: string };

const EN: Record<EmailType, Template> = {
  "Request Received": {
    subject: "We received your return request — {{rma_number}}",
    body: `Hi {{customer_name}},

Thanks for reaching out. We've received your return request for order {{order_number}}.

Return number: {{rma_number}}
Items: {{items_list}}

We usually review requests within 1 business day and will email you the next steps.

— {{store_name}}`,
  },
  Approved: {
    subject: "Your return {{rma_number}} is approved",
    body: `Hi {{customer_name}},

Good news: your return is approved.

{{return_instructions}}

Once we receive your items, we'll process your {{refund_method}} ({{refund_amount}}).

— {{store_name}}`,
  },
  Rejected: {
    subject: "Update on your return request {{rma_number}}",
    body: `Hi {{customer_name}},

After reviewing your return request {{rma_number}}, we're unable to approve it.

Reason: {{rejection_reason}}

If you have any questions, simply reply to this email.

— {{store_name}}`,
  },
  Shipped: {
    subject: "Your return {{rma_number}} is on its way",
    body: `Hi {{customer_name}},

Thank you! Your return {{rma_number}} is on its way back to us.

Carrier: {{carrier}}
Tracking: {{tracking_number}}

We'll let you know as soon as it arrives.

— {{store_name}}`,
  },
  Received: {
    subject: "We received your items — {{rma_number}}",
    body: `Hi {{customer_name}},

Your returned items for {{rma_number}} have arrived and are being checked.

Your {{refund_method}} ({{refund_amount}}) will be processed shortly.

— {{store_name}}`,
  },
  Refunded: {
    subject: "Your return {{rma_number}} is complete",
    body: `Hi {{customer_name}},

Your return {{rma_number}} is complete: {{refund_method}} of {{refund_amount}}.

{{refund_details}}

Thanks for shopping with us.
— {{store_name}}`,
  },
  Expired: {
    subject: "Your return request {{rma_number}} has expired",
    body: `Hi {{customer_name}},

Your return request {{rma_number}} for order {{order_number}} has expired because we didn't receive your parcel in time.

If you still need to return your items, reply to this email and we'll help you.

— {{store_name}}`,
  },
  "Withdrawal Received": {
    subject: "Confirmation of your withdrawal — order {{order_number}}",
    body: `Hi {{customer_name}},

We confirm that we received your withdrawal from order {{order_number}} on {{request_date}}.

Reference: {{rma_number}}
Items: {{items_list}}

{{return_instructions}}

We'll refund you within 14 days of receiving your withdrawal. We may wait until we have received the items back before refunding you.

— {{store_name}}`,
  },
};

const FR: Record<EmailType, Template> = {
  "Request Received": {
    subject: "Nous avons reçu votre demande de retour — {{rma_number}}",
    body: `Bonjour {{customer_name}},

Merci pour votre message. Nous avons bien reçu votre demande de retour pour la commande {{order_number}}.

Numéro de retour : {{rma_number}}
Articles : {{items_list}}

Nous examinons généralement les demandes sous 1 jour ouvré et vous enverrons les prochaines étapes par e-mail.

— {{store_name}}`,
  },
  Approved: {
    subject: "Votre retour {{rma_number}} est accepté",
    body: `Bonjour {{customer_name}},

Bonne nouvelle : votre retour est accepté.

{{return_instructions}}

Dès réception de vos articles, nous traiterons votre {{refund_method}} ({{refund_amount}}).

— {{store_name}}`,
  },
  Rejected: {
    subject: "Suite de votre demande de retour {{rma_number}}",
    body: `Bonjour {{customer_name}},

Après examen de votre demande de retour {{rma_number}}, nous ne pouvons pas l'accepter.

Motif : {{rejection_reason}}

Pour toute question, répondez simplement à cet e-mail.

— {{store_name}}`,
  },
  Shipped: {
    subject: "Votre retour {{rma_number}} est en route",
    body: `Bonjour {{customer_name}},

Merci ! Votre retour {{rma_number}} est en route vers nous.

Transporteur : {{carrier}}
Suivi : {{tracking_number}}

Nous vous préviendrons dès son arrivée.

— {{store_name}}`,
  },
  Received: {
    subject: "Nous avons reçu vos articles — {{rma_number}}",
    body: `Bonjour {{customer_name}},

Les articles de votre retour {{rma_number}} sont arrivés et sont en cours de vérification.

Votre {{refund_method}} ({{refund_amount}}) sera traité très prochainement.

— {{store_name}}`,
  },
  Refunded: {
    subject: "Votre retour {{rma_number}} est finalisé",
    body: `Bonjour {{customer_name}},

Votre retour {{rma_number}} est finalisé : {{refund_method}} de {{refund_amount}}.

{{refund_details}}

Merci pour votre confiance.
— {{store_name}}`,
  },
  Expired: {
    subject: "Votre demande de retour {{rma_number}} a expiré",
    body: `Bonjour {{customer_name}},

Votre demande de retour {{rma_number}} pour la commande {{order_number}} a expiré car nous n'avons pas reçu votre colis à temps.

Si vous souhaitez toujours retourner vos articles, répondez à cet e-mail et nous vous aiderons.

— {{store_name}}`,
  },
  "Withdrawal Received": {
    subject: "Confirmation de votre rétractation — commande {{order_number}}",
    body: `Bonjour {{customer_name}},

Nous confirmons avoir reçu le {{request_date}} votre rétractation concernant la commande {{order_number}}.

Référence : {{rma_number}}
Articles : {{items_list}}

{{return_instructions}}

Nous vous rembourserons dans les 14 jours suivant la réception de votre rétractation. Nous pouvons différer le remboursement jusqu'à la récupération des articles.

— {{store_name}}`,
  },
};

export const BUILT_IN_TEMPLATES: Record<Locale, Record<EmailType, Template>> = { en: EN, fr: FR };

/**
 * The defaults shipped by earlier TrackBack versions. A stored template that
 * still equals one of these was never edited by the merchant, so the (better)
 * new built-in wins over it.
 */
export const LEGACY_DEFAULT_SUBJECTS: Record<string, string> = {
  "Request Received": "We received your return request — {{rma_number}}",
  Approved: "Your return is approved — ship it back",
  Rejected: "Update on your return request",
  Refunded: "Your refund has been issued ✨",
  Shipped: "We got it — your return is on its way",
  Expired: "Your return request has expired — {{rma_number}}",
};

export function isLegacyDefault(type: string, subject: string, body: string): boolean {
  return LEGACY_DEFAULT_SUBJECTS[type] === subject && body.includes("— Acme Store");
}

export function storageType(type: EmailType, locale: Locale | null): string {
  return locale ? `${type}@${locale}` : type;
}

// ─── Localized fragments used to build variables ────────────────────────────

export const EMAIL_STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    returnCenter: "Return Center",
    poweredBy: "Secured by TrackBack",
    ctaStatus: "View return status",
    ctaLabel: "Download shipping label",
    ctaTrack: "Track your return",
    ctaExchange: "Complete your exchange",
    methodRefund: "refund",
    methodStoreCredit: "store credit",
    methodGiftCard: "gift card",
    methodExchange: "exchange",
    methodManual: "refund",
    detailsOriginal: "It may take 3–5 business days to appear on your statement.",
    detailsStoreCredit: "It's been added to your store account and will apply automatically at your next checkout.",
    detailsGiftCard: "Your gift card code: {code}\nEnter it at checkout to use your credit.",
    detailsExchange: "Your replacement order is being prepared.",
    detailsExchangeLink: "Complete your exchange here: {url}",
    detailsManual: "Sent via {method} to {account}.",
    detailsManualRef: "Reference: {ref}",
    instrShip: "Please send the items to:\n{address}\n\nWrite {rma} on the parcel. Once it's shipped, add your tracking number here: {url}",
    instrShipNoAddress: "Please ship the items back to us and write {rma} on the parcel. Reply to this email if you need the return address.",
    instrLabel: "Download your prepaid shipping label: {label}\nPrint it, stick it on the parcel and drop it off within 14 days.",
    instrLabelPending: "We'll email you a prepaid shipping label shortly.",
    instrStore: "Bring the items to our store with your return number {rma}:\n{info}",
    instrPickup: "Our courier will contact you to collect the parcel. Please keep the items packed and write {rma} on the parcel.\n{info}",
    instrKeep: "No need to send the items back: you can keep them.",
    feesLine: "Fees deducted: {amount}",
  },
  fr: {
    returnCenter: "Centre de retours",
    poweredBy: "Sécurisé par TrackBack",
    ctaStatus: "Voir le suivi du retour",
    ctaLabel: "Télécharger l'étiquette",
    ctaTrack: "Suivre votre retour",
    ctaExchange: "Finaliser votre échange",
    methodRefund: "remboursement",
    methodStoreCredit: "avoir",
    methodGiftCard: "carte cadeau",
    methodExchange: "échange",
    methodManual: "remboursement",
    detailsOriginal: "Il peut apparaître sur votre relevé sous 3 à 5 jours ouvrés.",
    detailsStoreCredit: "Il a été ajouté à votre compte client et s'appliquera automatiquement lors de votre prochain achat.",
    detailsGiftCard: "Votre code carte cadeau : {code}\nSaisissez-le au moment du paiement pour utiliser votre crédit.",
    detailsExchange: "Votre commande de remplacement est en préparation.",
    detailsExchangeLink: "Finalisez votre échange ici : {url}",
    detailsManual: "Envoyé via {method} au {account}.",
    detailsManualRef: "Référence : {ref}",
    instrShip: "Merci d'envoyer les articles à :\n{address}\n\nIndiquez {rma} sur le colis. Une fois expédié, ajoutez votre numéro de suivi ici : {url}",
    instrShipNoAddress: "Merci de nous renvoyer les articles en indiquant {rma} sur le colis. Répondez à cet e-mail si vous avez besoin de l'adresse de retour.",
    instrLabel: "Téléchargez votre étiquette prépayée : {label}\nImprimez-la, collez-la sur le colis et déposez-le sous 14 jours.",
    instrLabelPending: "Nous vous envoyons très vite une étiquette prépayée par e-mail.",
    instrStore: "Rapportez les articles en boutique avec votre numéro de retour {rma} :\n{info}",
    instrPickup: "Notre livreur vous contactera pour récupérer le colis. Gardez les articles emballés et indiquez {rma} sur le colis.\n{info}",
    instrKeep: "Inutile de nous renvoyer les articles : vous pouvez les garder.",
    feesLine: "Frais déduits : {amount}",
  },
};

/** Fills {{var}} placeholders. Unknown variables become empty strings. */
export function fillTemplate(text: string, vars: Partial<Record<EmailVariable, string>>): string {
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (vars as Record<string, string>)[k] ?? "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Sample values for the editor preview. */
export const SAMPLE_VARIABLES: Record<Locale, Partial<Record<EmailVariable, string>>> = {
  en: {
    customer_name: "Jane Smith",
    store_name: "Your Store",
    rma_number: "RMA-2026-000042",
    order_number: "#1089",
    item_count: "2",
    items_list: "Classic Tee (M) ×1, Canvas Tote ×1",
    refund_amount: "$42.00",
    refund_method: "refund",
    refund_details: "It may take 3–5 business days to appear on your statement.",
    rejection_reason: "Item shows signs of wear.",
    carrier: "UPS",
    tracking_number: "1Z999AA10123456784",
    return_instructions: "Please send the items to:\n1450 Mission St, San Francisco\n\nWrite RMA-2026-000042 on the parcel.",
    return_address: "1450 Mission St, San Francisco",
    status_url: "https://your-store.myshopify.com/apps/returns",
    fee_amount: "$0.00",
    request_date: "May 12, 2026",
  },
  fr: {
    customer_name: "Awa Diallo",
    store_name: "Votre Boutique",
    rma_number: "RMA-2026-000042",
    order_number: "#1089",
    item_count: "2",
    items_list: "T-shirt classique (M) ×1, Tote bag ×1",
    refund_amount: "25 000 F CFA",
    refund_method: "remboursement",
    refund_details: "Envoyé via Orange Money au ••••1234.",
    rejection_reason: "L'article présente des traces d'usure.",
    carrier: "DHL",
    tracking_number: "1234567890",
    return_instructions: "Merci d'envoyer les articles à :\nRue 10, Plateau, Dakar\n\nIndiquez RMA-2026-000042 sur le colis.",
    return_address: "Rue 10, Plateau, Dakar",
    status_url: "https://votre-boutique.myshopify.com/apps/returns",
    fee_amount: "0 F CFA",
    request_date: "12 mai 2026",
  },
};
