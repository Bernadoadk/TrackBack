/**
 * Customer-facing translations (return portal, status page, chat widget).
 *
 * Pure module — safe on client and server. The English dictionary is the
 * reference: the French one is typed against it, so a missing key is a
 * compile error. Merchant overrides (Portal Editor → Texts) are applied on
 * top of these defaults by `resolvePortalTexts`.
 */

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

/** "fr-FR", "FR", "fr_CA" → "fr". Returns null for unsupported languages. */
export function normalizeLocale(input: string | null | undefined): Locale | null {
  const base = String(input ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

/** Parses the "en,fr" setting into a clean, non-empty list. */
export function parseLocales(value: string | null | undefined): Locale[] {
  const list = String(value ?? "")
    .split(",")
    .map((s) => normalizeLocale(s))
    .filter((l): l is Locale => !!l);
  const unique = Array.from(new Set(list));
  return unique.length > 0 ? unique : ["en"];
}

/**
 * Picks the portal language: explicit request (?lang= or the storefront
 * locale passed by the app proxy) → browser Accept-Language → shop default.
 * Only enabled languages are ever returned.
 */
export function pickLocale(args: {
  requested?: string | null;
  acceptLanguage?: string | null;
  enabled: Locale[];
  fallback: Locale;
}): Locale {
  const enabled = args.enabled.length > 0 ? args.enabled : [args.fallback];
  const requested = normalizeLocale(args.requested);
  if (requested && enabled.includes(requested)) return requested;
  if (args.acceptLanguage) {
    for (const part of args.acceptLanguage.split(",")) {
      const l = normalizeLocale(part.split(";")[0]);
      if (l && enabled.includes(l)) return l;
    }
  }
  return enabled.includes(args.fallback) ? args.fallback : enabled[0];
}

/** Replaces {name} placeholders. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ─── Portal dictionary ──────────────────────────────────────────────────────

const en = {
  // Merchant-customizable texts (keys match the legacy ShopSettings columns)
  labelFindOrder: "Find your order",
  descFindOrder: "Enter your order number and the email used at checkout.",
  labelCta: "Find order",
  labelSelectItems: "Select items to return",
  descSelectItems: "Choose the items you'd like to return.",
  labelReasons: "Tell us why",
  descReasons: "Help us understand why you're returning each item.",
  labelRefundType: "How would you like to be refunded?",
  descRefundType: "Choose the option that works best for you.",
  labelConfirm: "Review & submit",
  descConfirm: "One last look before we send this.",
  labelSubmit: "Submit return request",
  labelBackToStore: "Back to store",
  labelCantFind: "Can't find your order?",
  labelStartAnother: "Start another return",
  labelTrackingToggle: "Already have a return? Track it",
  labelPoweredBy: "Secured by TrackBack",

  // Chrome
  returnCenter: "Return Center",
  returns: "Returns",
  yourReturn: "Your return",
  needHelp: "Need help?",
  step: "Step {n}",
  stepOf: "Step {n} of {total}",
  back: "Back",
  continue: "Continue",
  close: "Close",
  copy: "Copy",
  copied: "Copied",
  optional: "optional",
  language: "Language",
  stepFind: "Order",
  stepItems: "Items",
  stepReason: "Reason",
  stepResolution: "Refund",
  stepConfirm: "Confirm",

  // Step 1
  orderNumber: "Order number",
  emailAddress: "Email address",
  searching: "Searching…",
  returnPolicy: "Return policy",
  readPolicy: "Read our return policy",
  trackReturn: "Track an existing return",
  withdrawLink: "Withdraw from contract here",

  // Step 2
  fromOrder: "Order {order} · placed {date}",
  returnBy: "Return by {date}",
  qty: "Qty",
  noEligibleItems: "None of the items in this order can be returned online.",
  reasonFinalSale: "Final sale — not returnable",
  reasonNotFulfilled: "Not shipped yet",
  reasonAlreadyReturned: "Already returned",
  reasonWindowExpired: "Return window closed on {date}",
  reasonDiscounted: "Discounted items can't be returned",
  reasonOneReturn: "A return already exists for this order",

  // Step 3
  selectReason: "Reason",
  chooseReason: "Choose a reason…",
  notes: "Additional details",
  notesPlaceholder: "Anything else we should know?",
  photos: "Photos",
  photosRequired: "Please add at least one photo for this reason.",
  addPhoto: "Add photo",
  uploading: "Uploading…",
  photoHint: "Up to 3 photos (JPG, PNG, WebP).",
  photoError: "This photo couldn't be uploaded. Try another one.",

  // Step 4 — resolution
  refundOriginalTitle: "Refund to original payment",
  refundOriginalDesc: "Back to your original payment method within 5–10 business days.",
  refundOfflineTitle: "Mobile money or bank transfer",
  refundOfflineDesc: "You paid on delivery: tell us where to send your refund.",
  storeCreditTitle: "Store credit",
  storeCreditDesc: "Use it on your next order, available as soon as your return is processed.",
  fastest: "Fastest",
  bonusBadge: "+{pct}% bonus",
  bonusLine: "Get {total} instead of {base}",
  exchangeTitle: "Exchange for another size or color",
  exchangeDesc: "We ship the replacement as soon as we receive your return.",
  shopNowTitle: "Exchange for another product",
  shopNowDesc: "Pick anything in the store: the value of your return is applied.",
  recommended: "Recommended",
  chooseReplacement: "Choose the replacement",
  outOfStock: "Out of stock",
  priceDiffMore: "+{amount} to pay",
  priceDiffLess: "{amount} back as credit",
  noVariants: "No other option is available for this item.",
  searchProducts: "Search products…",
  noProducts: "No product found.",
  selectOption: "Select",
  payoutTitle: "Where should we send your refund?",
  payoutMethod: "Refund method",
  payoutAccountPhone: "Mobile money number",
  payoutAccountBank: "IBAN or account number",
  payoutAccountOther: "Account details",
  payoutName: "Account holder name",
  payoutCashNote: "The store will contact you to arrange your cash refund.",
  returnMethodTitle: "How will you send the items back?",
  methodShip: "Ship it yourself",
  methodShipDesc: "Send the parcel with the carrier of your choice.",
  methodLabel: "Prepaid shipping label",
  methodLabelDesc: "We email you a shipping label once your return is approved.",
  methodStore: "Drop off in store",
  methodStoreDesc: "Bring the items to our store.",
  methodPickup: "Home pickup",
  methodPickupDesc: "Our courier collects the parcel from you.",
  fee: "Fee {amount}",

  // Step 5 — confirm
  subtotal: "Subtotal",
  restockingFee: "Restocking fee",
  shippingFee: "Return shipping",
  waived: "Waived",
  bonusCredit: "Store credit bonus (+{pct}%)",
  estimatedRefund: "Estimated refund",
  totalCredit: "Total store credit",
  exchangeValue: "Exchange value",
  refundMethodLabel: "Refund",
  returnMethodLabel: "Return method",
  keepItemTitle: "Good news: keep the item",
  keepItemDesc: "No need to send it back. Keep it or give it to someone who'll enjoy it.",
  phoneLabel: "Phone number (WhatsApp)",
  whatsappOptIn: "Send me updates about my return on WhatsApp",
  submitting: "Submitting…",
  agreePolicy: "By submitting, you agree to our return policy.",

  // Confirmation
  submittedTitle: "Your return request is submitted",
  submittedDesc: "We've emailed you a confirmation with the next steps.",
  approvedTitle: "Your return is approved",
  yourRma: "Your return number",
  nextSteps: "Next steps",
  stepReview: "We review your request, usually within 1 business day.",
  stepShipAfterApproval: "Once approved, we email you the return address.",
  stepShipTo: "Send the items to this address:",
  stepLabel: "Once approved, you'll receive a prepaid label by email.",
  stepStore: "Bring the items to our store:",
  stepPickup: "Our courier will contact you to collect the parcel.",
  stepRefund: "Once received, your refund is issued within 3–5 business days.",
  stepCredit: "Your store credit is issued as soon as we receive the items.",
  stepExchange: "Your replacement ships as soon as we receive your return.",
  stepKeep: "Your refund is issued as soon as your request is approved.",
  writeRma: "Write {rma} on the parcel.",
  trackThisReturn: "Track this return",
  contactWhatsapp: "Chat with us on WhatsApp",
  whatsappHello: "Hello! I have a question about my return {rma}.",

  // Status page
  statusTitle: "Track your return",
  statusDesc: "Enter your return number and the email used for the request.",
  rmaNumber: "Return number",
  lookUp: "Look up",
  statusNotFound: "No return matches this number and email.",
  status_PENDING: "Under review",
  status_APPROVED: "Approved — waiting for your parcel",
  status_SHIPPED: "On its way back to us",
  status_RECEIVED: "Received — being processed",
  status_REFUNDED: "Completed",
  status_REJECTED: "Declined",
  status_EXPIRED: "Expired",
  tlRequested: "Request received",
  tlApproved: "Approved",
  tlShipped: "Parcel sent",
  tlReceived: "Items received",
  tlRefunded: "Refund issued",
  tlRejected: "Declined",
  tlExpired: "Expired",
  rejectionReason: "Reason: {reason}",
  addTracking: "Add your tracking number",
  carrier: "Carrier",
  selectCarrier: "Select a carrier…",
  otherCarrier: "Carrier name",
  otherCarrierOption: "Other / not listed",
  trackingNumber: "Tracking number",
  saveTracking: "Save tracking",
  trackingSaved: "Tracking saved, thank you!",
  trackParcel: "Track the parcel",
  returnInstructions: "Return instructions",
  newReturn: "Start a new return",
  refundDone: "{method}: {amount}",

  // EU withdrawal
  withdrawTitle: "Withdraw from your purchase",
  withdrawDesc: "You can withdraw within 14 days of delivery, without giving any reason.",
  withdrawName: "Full name",
  withdrawItems: "Items concerned",
  withdrawAll: "The whole order",
  withdrawComment: "Comment",
  withdrawConfirm: "Confirm withdrawal",
  withdrawDoneTitle: "Your withdrawal is registered",
  withdrawDoneDesc: "Received on {date}. A confirmation has been sent to {email}.",
  withdrawNotEligible: "The withdrawal period for this order has ended.",

  // Errors
  errOrderNotFound: "We couldn't find an order with this number and email.",
  errInvalidEmail: "Please enter a valid email address.",
  errNotShipped: "This order hasn't shipped yet. You can request a return once it has been delivered.",
  errQuota: "This store can't accept new online returns right now. Please contact the store.",
  errSession: "Your session expired. Please look up your order again.",
  errGeneric: "Something went wrong. Please try again.",
  errTooMany: "Too many attempts. Please wait a few minutes and try again.",
  errBlocked: "This return can't be requested online. Please contact the store.",
  errPhotoRequired: "Please add the requested photos before continuing.",
  errPayout: "Please complete your refund details.",
  errUnavailable: "This return portal isn't available right now.",
  errItems: "Some selected items can no longer be returned. Please review your selection.",

  // Chat widget
  chatTitle: "Chat with {store}",
  chatSubtitle: "We usually reply within a few hours",
  chatIntro: "Tell us who you are so we can reply to you.",
  chatName: "Your name",
  chatEmail: "Your email",
  chatStart: "Start chatting",
  chatPlaceholder: "Write a message…",
  chatSend: "Send",
  chatEmpty: "Send us a message, we're here to help.",
  chatError: "Message not sent. Please try again.",
} as const;

export type PortalKey = keyof typeof en;
export type PortalDictionary = Record<PortalKey, string>;

const fr: PortalDictionary = {
  labelFindOrder: "Retrouvez votre commande",
  descFindOrder: "Saisissez votre numéro de commande et l'e-mail utilisé lors de l'achat.",
  labelCta: "Rechercher",
  labelSelectItems: "Sélectionnez les articles à retourner",
  descSelectItems: "Choisissez les articles que vous souhaitez retourner.",
  labelReasons: "Dites-nous pourquoi",
  descReasons: "Aidez-nous à comprendre la raison de chaque retour.",
  labelRefundType: "Comment souhaitez-vous être remboursé ?",
  descRefundType: "Choisissez l'option qui vous convient le mieux.",
  labelConfirm: "Vérifiez et envoyez",
  descConfirm: "Un dernier coup d'œil avant l'envoi.",
  labelSubmit: "Envoyer la demande de retour",
  labelBackToStore: "Retour à la boutique",
  labelCantFind: "Commande introuvable ?",
  labelStartAnother: "Faire un autre retour",
  labelTrackingToggle: "Vous avez déjà un retour ? Suivez-le",
  labelPoweredBy: "Sécurisé par TrackBack",

  returnCenter: "Centre de retours",
  returns: "Retours",
  yourReturn: "Votre retour",
  needHelp: "Besoin d'aide ?",
  step: "Étape {n}",
  stepOf: "Étape {n} sur {total}",
  back: "Retour",
  continue: "Continuer",
  close: "Fermer",
  copy: "Copier",
  copied: "Copié",
  optional: "facultatif",
  language: "Langue",
  stepFind: "Commande",
  stepItems: "Articles",
  stepReason: "Motif",
  stepResolution: "Remboursement",
  stepConfirm: "Validation",

  orderNumber: "Numéro de commande",
  emailAddress: "Adresse e-mail",
  searching: "Recherche…",
  returnPolicy: "Politique de retour",
  readPolicy: "Lire notre politique de retour",
  trackReturn: "Suivre un retour existant",
  withdrawLink: "Se rétracter du contrat ici",

  fromOrder: "Commande {order} · passée le {date}",
  returnBy: "À retourner avant le {date}",
  qty: "Qté",
  noEligibleItems: "Aucun article de cette commande ne peut être retourné en ligne.",
  reasonFinalSale: "Vente finale : non reprise",
  reasonNotFulfilled: "Pas encore expédié",
  reasonAlreadyReturned: "Déjà retourné",
  reasonWindowExpired: "Délai de retour dépassé depuis le {date}",
  reasonDiscounted: "Les articles soldés ne sont pas repris",
  reasonOneReturn: "Un retour existe déjà pour cette commande",

  selectReason: "Motif",
  chooseReason: "Choisissez un motif…",
  notes: "Précisions",
  notesPlaceholder: "Autre chose à nous signaler ?",
  photos: "Photos",
  photosRequired: "Ajoutez au moins une photo pour ce motif.",
  addPhoto: "Ajouter une photo",
  uploading: "Envoi…",
  photoHint: "Jusqu'à 3 photos (JPG, PNG, WebP).",
  photoError: "Cette photo n'a pas pu être envoyée. Essayez-en une autre.",

  refundOriginalTitle: "Remboursement sur votre moyen de paiement",
  refundOriginalDesc: "Sur votre moyen de paiement d'origine sous 5 à 10 jours ouvrés.",
  refundOfflineTitle: "Mobile money ou virement",
  refundOfflineDesc: "Vous avez payé à la livraison : indiquez-nous où envoyer votre remboursement.",
  storeCreditTitle: "Avoir en boutique",
  storeCreditDesc: "À utiliser sur votre prochaine commande, dès le traitement de votre retour.",
  fastest: "Le plus rapide",
  bonusBadge: "+{pct} % offerts",
  bonusLine: "Recevez {total} au lieu de {base}",
  exchangeTitle: "Échanger contre une autre taille ou couleur",
  exchangeDesc: "Nous expédions le remplacement dès réception de votre retour.",
  shopNowTitle: "Échanger contre un autre produit",
  shopNowDesc: "Choisissez n'importe quel produit : la valeur de votre retour est déduite.",
  recommended: "Recommandé",
  chooseReplacement: "Choisissez le remplacement",
  outOfStock: "Épuisé",
  priceDiffMore: "+{amount} à payer",
  priceDiffLess: "{amount} rendus en avoir",
  noVariants: "Aucune autre option n'est disponible pour cet article.",
  searchProducts: "Rechercher un produit…",
  noProducts: "Aucun produit trouvé.",
  selectOption: "Choisir",
  payoutTitle: "Où devons-nous envoyer votre remboursement ?",
  payoutMethod: "Mode de remboursement",
  payoutAccountPhone: "Numéro mobile money",
  payoutAccountBank: "IBAN ou numéro de compte",
  payoutAccountOther: "Coordonnées",
  payoutName: "Nom du titulaire",
  payoutCashNote: "La boutique vous contactera pour organiser votre remboursement en espèces.",
  returnMethodTitle: "Comment nous renvoyez-vous les articles ?",
  methodShip: "Je l'expédie moi-même",
  methodShipDesc: "Envoyez le colis avec le transporteur de votre choix.",
  methodLabel: "Étiquette prépayée",
  methodLabelDesc: "Nous vous envoyons une étiquette dès l'acceptation du retour.",
  methodStore: "Dépôt en boutique",
  methodStoreDesc: "Rapportez les articles en boutique.",
  methodPickup: "Enlèvement à domicile",
  methodPickupDesc: "Notre livreur récupère le colis chez vous.",
  fee: "Frais {amount}",

  subtotal: "Sous-total",
  restockingFee: "Frais de remise en stock",
  shippingFee: "Frais de retour",
  waived: "Offerts",
  bonusCredit: "Bonus avoir (+{pct} %)",
  estimatedRefund: "Remboursement estimé",
  totalCredit: "Total de l'avoir",
  exchangeValue: "Valeur de l'échange",
  refundMethodLabel: "Remboursement",
  returnMethodLabel: "Mode de retour",
  keepItemTitle: "Bonne nouvelle : gardez l'article",
  keepItemDesc: "Inutile de le renvoyer. Gardez-le ou offrez-le à quelqu'un.",
  phoneLabel: "Numéro de téléphone (WhatsApp)",
  whatsappOptIn: "Recevoir le suivi de mon retour sur WhatsApp",
  submitting: "Envoi…",
  agreePolicy: "En envoyant cette demande, vous acceptez notre politique de retour.",

  submittedTitle: "Votre demande de retour est envoyée",
  submittedDesc: "Un e-mail de confirmation avec les prochaines étapes vous a été envoyé.",
  approvedTitle: "Votre retour est accepté",
  yourRma: "Votre numéro de retour",
  nextSteps: "Prochaines étapes",
  stepReview: "Nous examinons votre demande, en général sous 1 jour ouvré.",
  stepShipAfterApproval: "Après validation, nous vous envoyons l'adresse de retour par e-mail.",
  stepShipTo: "Envoyez les articles à cette adresse :",
  stepLabel: "Après validation, vous recevrez une étiquette prépayée par e-mail.",
  stepStore: "Rapportez les articles en boutique :",
  stepPickup: "Notre livreur vous contactera pour récupérer le colis.",
  stepRefund: "Dès réception, votre remboursement est effectué sous 3 à 5 jours ouvrés.",
  stepCredit: "Votre avoir est émis dès réception des articles.",
  stepExchange: "Votre article de remplacement part dès réception de votre retour.",
  stepKeep: "Votre remboursement est effectué dès l'acceptation de la demande.",
  writeRma: "Indiquez {rma} sur le colis.",
  trackThisReturn: "Suivre ce retour",
  contactWhatsapp: "Nous écrire sur WhatsApp",
  whatsappHello: "Bonjour ! J'ai une question sur mon retour {rma}.",

  statusTitle: "Suivre votre retour",
  statusDesc: "Saisissez votre numéro de retour et l'e-mail utilisé pour la demande.",
  rmaNumber: "Numéro de retour",
  lookUp: "Rechercher",
  statusNotFound: "Aucun retour ne correspond à ce numéro et à cet e-mail.",
  status_PENDING: "En cours d'examen",
  status_APPROVED: "Accepté : en attente de votre colis",
  status_SHIPPED: "En route vers nous",
  status_RECEIVED: "Reçu : en cours de traitement",
  status_REFUNDED: "Terminé",
  status_REJECTED: "Refusé",
  status_EXPIRED: "Expiré",
  tlRequested: "Demande reçue",
  tlApproved: "Acceptée",
  tlShipped: "Colis envoyé",
  tlReceived: "Articles reçus",
  tlRefunded: "Remboursement effectué",
  tlRejected: "Refusée",
  tlExpired: "Expirée",
  rejectionReason: "Motif : {reason}",
  addTracking: "Ajoutez votre numéro de suivi",
  carrier: "Transporteur",
  selectCarrier: "Choisissez un transporteur…",
  otherCarrier: "Nom du transporteur",
  otherCarrierOption: "Autre / non listé",
  trackingNumber: "Numéro de suivi",
  saveTracking: "Enregistrer le suivi",
  trackingSaved: "Suivi enregistré, merci !",
  trackParcel: "Suivre le colis",
  returnInstructions: "Instructions de retour",
  newReturn: "Faire un nouveau retour",
  refundDone: "{method} : {amount}",

  withdrawTitle: "Se rétracter de votre achat",
  withdrawDesc: "Vous pouvez vous rétracter dans les 14 jours suivant la livraison, sans avoir à vous justifier.",
  withdrawName: "Nom complet",
  withdrawItems: "Articles concernés",
  withdrawAll: "Toute la commande",
  withdrawComment: "Commentaire",
  withdrawConfirm: "Confirmer la rétractation",
  withdrawDoneTitle: "Votre rétractation est enregistrée",
  withdrawDoneDesc: "Reçue le {date}. Une confirmation a été envoyée à {email}.",
  withdrawNotEligible: "Le délai de rétractation de cette commande est expiré.",

  errOrderNotFound: "Aucune commande ne correspond à ce numéro et à cet e-mail.",
  errInvalidEmail: "Veuillez saisir une adresse e-mail valide.",
  errNotShipped: "Cette commande n'est pas encore expédiée. Vous pourrez demander un retour après la livraison.",
  errQuota: "La boutique ne peut pas accepter de nouveaux retours en ligne pour le moment. Contactez-la directement.",
  errSession: "Votre session a expiré. Recherchez à nouveau votre commande.",
  errGeneric: "Une erreur est survenue. Veuillez réessayer.",
  errTooMany: "Trop de tentatives. Patientez quelques minutes avant de réessayer.",
  errBlocked: "Ce retour ne peut pas être demandé en ligne. Contactez la boutique.",
  errPhotoRequired: "Ajoutez les photos demandées avant de continuer.",
  errPayout: "Veuillez compléter vos informations de remboursement.",
  errUnavailable: "Ce portail de retour n'est pas disponible pour le moment.",
  errItems: "Certains articles sélectionnés ne peuvent plus être retournés. Vérifiez votre sélection.",

  chatTitle: "Discuter avec {store}",
  chatSubtitle: "Nous répondons en général en quelques heures",
  chatIntro: "Présentez-vous pour que nous puissions vous répondre.",
  chatName: "Votre nom",
  chatEmail: "Votre e-mail",
  chatStart: "Démarrer la discussion",
  chatPlaceholder: "Écrivez un message…",
  chatSend: "Envoyer",
  chatEmpty: "Envoyez-nous un message, nous sommes là pour vous aider.",
  chatError: "Message non envoyé. Veuillez réessayer.",
};

export const PORTAL_STRINGS: Record<Locale, PortalDictionary> = { en, fr };

/** Keys a merchant can override from the Portal Editor. */
export const CUSTOMIZABLE_KEYS = [
  "labelFindOrder",
  "descFindOrder",
  "labelCta",
  "labelSelectItems",
  "descSelectItems",
  "labelReasons",
  "descReasons",
  "labelRefundType",
  "descRefundType",
  "labelConfirm",
  "descConfirm",
  "labelSubmit",
  "labelBackToStore",
  "labelCantFind",
  "labelStartAnother",
  "labelTrackingToggle",
  "labelPoweredBy",
] as const satisfies readonly PortalKey[];

export type CustomizableKey = (typeof CUSTOMIZABLE_KEYS)[number];

/** Legacy English defaults stored in the ShopSettings label columns. */
const LEGACY_DEFAULTS: Record<CustomizableKey, string> = {
  labelFindOrder: "Find your order",
  descFindOrder: "Enter your order number and the email used at checkout.",
  labelCta: "Find Order",
  labelSelectItems: "Select items to return",
  descSelectItems: "Select the items you'd like to return.",
  labelReasons: "Tell us why",
  descReasons: "Help us understand why you're returning each item.",
  labelRefundType: "How would you like to be refunded?",
  descRefundType: "Choose the option that works best for you.",
  labelConfirm: "Review & submit",
  descConfirm: "One last look before we send this.",
  labelSubmit: "Submit Return Request",
  labelBackToStore: "Back to store",
  labelCantFind: "Can't find your order?",
  labelStartAnother: "Start another return",
  labelTrackingToggle: "Already shipped your return? Submit tracking",
  labelPoweredBy: "Secured by TrackBack",
};

export type PortalTextOverrides = Partial<Record<Locale, Partial<Record<CustomizableKey, string>>>>;

/** Safely reads the `portalTexts` JSON column. */
export function parsePortalTexts(value: unknown): PortalTextOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PortalTextOverrides = {};
  for (const locale of SUPPORTED_LOCALES) {
    const entry = (value as Record<string, unknown>)[locale];
    if (!entry || typeof entry !== "object") continue;
    const clean: Partial<Record<CustomizableKey, string>> = {};
    for (const key of CUSTOMIZABLE_KEYS) {
      const v = (entry as Record<string, unknown>)[key];
      if (typeof v === "string") clean[key] = v.slice(0, 300);
    }
    out[locale] = clean;
  }
  return out;
}

/**
 * Effective dictionary for a locale:
 *   built-in defaults
 *   ← legacy label columns (only for the shop's default language, and only
 *     when the merchant actually changed them)
 *   ← Portal Editor overrides for that locale
 * `whiteLabel=false` forces the TrackBack attribution.
 */
export function resolvePortalTexts(args: {
  locale: Locale;
  defaultLocale: Locale;
  legacy?: Partial<Record<CustomizableKey, string | null | undefined>>;
  overrides?: PortalTextOverrides;
  whiteLabel: boolean;
}): PortalDictionary {
  const dict: PortalDictionary = { ...PORTAL_STRINGS[args.locale] };

  if (args.locale === args.defaultLocale && args.legacy) {
    for (const key of CUSTOMIZABLE_KEYS) {
      const v = args.legacy[key];
      if (typeof v === "string" && v.trim() && v.trim() !== LEGACY_DEFAULTS[key]) {
        dict[key] = v;
      }
    }
  }

  const localeOverrides = args.overrides?.[args.locale];
  if (localeOverrides) {
    for (const key of CUSTOMIZABLE_KEYS) {
      const v = localeOverrides[key];
      if (typeof v === "string" && v.trim()) dict[key] = v;
    }
  }

  if (!args.whiteLabel) {
    dict.labelPoweredBy = PORTAL_STRINGS[args.locale].labelPoweredBy;
  } else if (localeOverrides && localeOverrides.labelPoweredBy === "") {
    // Pro merchants can hide the attribution entirely with an empty value.
    dict.labelPoweredBy = "";
  }
  return dict;
}

/** Tiny translator bound to a dictionary. */
export function makeT(dict: PortalDictionary) {
  return (key: PortalKey, vars?: Record<string, string | number>) => interpolate(dict[key] ?? key, vars);
}

/** Locale-aware date formatting ("12 mai 2026" / "May 12, 2026"). */
export function formatDate(value: string | number | Date, locale: Locale): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(value: string | number | Date, locale: Locale): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Payout methods (cash-on-delivery refunds) ──────────────────────────────

export const PAYOUT_METHODS = [
  { key: "wave", label: { en: "Wave", fr: "Wave" }, kind: "phone" },
  { key: "orange_money", label: { en: "Orange Money", fr: "Orange Money" }, kind: "phone" },
  { key: "mtn_momo", label: { en: "MTN MoMo", fr: "MTN MoMo" }, kind: "phone" },
  { key: "moov_money", label: { en: "Moov Money", fr: "Moov Money" }, kind: "phone" },
  { key: "mpesa", label: { en: "M-Pesa", fr: "M-Pesa" }, kind: "phone" },
  { key: "airtel_money", label: { en: "Airtel Money", fr: "Airtel Money" }, kind: "phone" },
  { key: "bank_transfer", label: { en: "Bank transfer", fr: "Virement bancaire" }, kind: "bank" },
  { key: "cash", label: { en: "Cash", fr: "Espèces" }, kind: "cash" },
  { key: "other", label: { en: "Other", fr: "Autre" }, kind: "other" },
] as const;

export type PayoutMethodKey = (typeof PAYOUT_METHODS)[number]["key"];

export function payoutMethodLabel(key: string | null | undefined, locale: Locale): string {
  const m = PAYOUT_METHODS.find((p) => p.key === key);
  return m ? m.label[locale] : String(key ?? "");
}

export function payoutMethodKind(key: string | null | undefined): "phone" | "bank" | "cash" | "other" {
  return (PAYOUT_METHODS.find((p) => p.key === key)?.kind ?? "other") as "phone" | "bank" | "cash" | "other";
}

/** Masks all but the last 4 characters of an account/phone number. */
export function maskAccount(value: string | null | undefined): string {
  const v = String(value ?? "").replace(/\s+/g, "");
  if (v.length <= 4) return v;
  return "•".repeat(Math.min(6, v.length - 4)) + v.slice(-4);
}
