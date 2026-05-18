/**
 * Carrier auto-detection + tracking URL templates.
 *
 * Free professional fallback when no AfterShip/EasyPost API key is configured.
 * The merchant (or customer) just types a carrier name + tracking number,
 * and we generate a clickable "Track live" URL pointing to the carrier's
 * official tracking page.
 *
 * Covers the major worldwide + FR carriers used by Shopify merchants.
 */

export type Carrier = {
  slug: string;
  name: string;
  aliases: string[];
  trackingUrl: (n: string) => string;
  estimatedDays?: [number, number]; // [min, max] business days for typical domestic transit
};

const enc = (s: string) => encodeURIComponent(s.trim());

export const CARRIERS: Carrier[] = [
  {
    slug: 'fedex',
    name: 'FedEx',
    aliases: ['fedex', 'federal express', 'fed-ex', 'fdx'],
    trackingUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'ups',
    name: 'UPS',
    aliases: ['ups', 'united parcel service'],
    trackingUrl: (n) => `https://www.ups.com/track?tracknum=${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'usps',
    name: 'USPS',
    aliases: ['usps', 'us postal', 'united states postal', 'usps.com'],
    trackingUrl: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(n)}`,
    estimatedDays: [3, 7],
  },
  {
    slug: 'dhl',
    name: 'DHL',
    aliases: ['dhl', 'dhl express', 'dhl ecommerce'],
    trackingUrl: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc(n)}`,
    estimatedDays: [3, 7],
  },
  {
    slug: 'colissimo',
    name: 'Colissimo',
    aliases: ['colissimo', 'la poste colissimo'],
    trackingUrl: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'chronopost',
    name: 'Chronopost',
    aliases: ['chronopost', 'chrono'],
    trackingUrl: (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${enc(n)}`,
    estimatedDays: [1, 2],
  },
  {
    slug: 'mondial-relay',
    name: 'Mondial Relay',
    aliases: ['mondial relay', 'mondialrelay', 'mr'],
    trackingUrl: (n) => `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${enc(n)}`,
    estimatedDays: [3, 6],
  },
  {
    slug: 'la-poste',
    name: 'La Poste',
    aliases: ['la poste', 'laposte', 'lettre suivie'],
    trackingUrl: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'royal-mail',
    name: 'Royal Mail',
    aliases: ['royal mail', 'royalmail'],
    trackingUrl: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${enc(n)}`,
    estimatedDays: [2, 4],
  },
  {
    slug: 'dpd',
    name: 'DPD',
    aliases: ['dpd', 'dpd group'],
    trackingUrl: (n) => `https://www.dpd.com/tracking/${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'gls',
    name: 'GLS',
    aliases: ['gls', 'gls group', 'general logistics systems'],
    trackingUrl: (n) => `https://gls-group.com/track/${enc(n)}`,
    estimatedDays: [2, 5],
  },
  {
    slug: 'canada-post',
    name: 'Canada Post',
    aliases: ['canada post', 'canadapost', 'postes canada'],
    trackingUrl: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${enc(n)}`,
    estimatedDays: [3, 7],
  },
  {
    slug: 'australia-post',
    name: 'Australia Post',
    aliases: ['australia post', 'auspost'],
    trackingUrl: (n) => `https://auspost.com.au/mypost/track/#/details/${enc(n)}`,
    estimatedDays: [2, 6],
  },
];

const normalize = (s: string) =>
  s.toLowerCase().trim().replace(/[._-]/g, ' ').replace(/\s+/g, ' ');

/** Resolve a carrier from a free-text name. Returns null if no match. */
export function resolveCarrier(name: string | null | undefined): Carrier | null {
  if (!name) return null;
  const norm = normalize(name);
  for (const c of CARRIERS) {
    if (c.aliases.some((a) => norm === a || norm.includes(a))) return c;
  }
  return null;
}

/**
 * Generate a tracking URL for the given carrier + tracking number.
 * Falls back to Google search if the carrier isn't recognized — still
 * gives the customer a useful one-click action.
 */
export function getTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined
): string | null {
  if (!trackingNumber) return null;
  const c = resolveCarrier(carrier);
  if (c) return c.trackingUrl(trackingNumber);
  // Graceful fallback
  return `https://www.google.com/search?q=${enc(`${carrier || ''} tracking ${trackingNumber}`)}`;
}

export function getCarrierDisplayName(carrier: string | null | undefined): string {
  const c = resolveCarrier(carrier);
  return c?.name ?? (carrier || 'Carrier');
}

export function getEstimatedTransitLabel(carrier: string | null | undefined): string | null {
  const c = resolveCarrier(carrier);
  if (!c?.estimatedDays) return null;
  const [min, max] = c.estimatedDays;
  return `Est. ${min}–${max} business days`;
}
