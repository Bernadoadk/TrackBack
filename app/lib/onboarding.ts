/**
 * Pure (client+server safe) onboarding helpers — types, constants, and the
 * stateless `evaluateOnboarding` evaluator. Anything that needs Prisma or
 * server-only deps lives in `onboarding.server.ts`.
 */

/**
 * Critical settings that must be customized for the return/refund flow to
 * work correctly. Each field is paired with the user-facing reason it matters,
 * so the onboarding UI and any warning surfaces can speak the same language.
 */
export const CRITICAL_FIELDS = [
  {
    key: 'fromEmail' as const,
    label: 'Reply-to email',
    why: 'All automated emails sent to customers (return approved, shipping, refund issued) use this address. Without a real one, customers can\'t reply and your messages may land in spam.',
  },
  {
    key: 'returnAddress' as const,
    label: 'Return address',
    why: 'This is where customers ship the items back. It appears in the approval email and the customer portal. Without it, customers have no way to complete their return.',
  },
  {
    key: 'returnWindow' as const,
    label: 'Return window',
    why: 'The number of days a customer has to request a return after purchase. This controls eligibility in your customer portal and feeds expiration rules.',
  },
  {
    key: 'returnPolicy' as const,
    label: 'Return policy',
    why: 'The legal/policy text shown on the customer portal. Setting your own builds trust and protects you from disputes around unclear conditions.',
  },
] as const;

export type CriticalFieldKey = typeof CRITICAL_FIELDS[number]['key'];

const DEFAULT_FROM_EMAIL = 'returns@acmestore.com';
const DEFAULT_RETURN_ADDRESS_MARKER = 'Acme Store';
const DEFAULT_POLICY_MARKER = 'We want you to love what you buy.';

/**
 * Detect "untouched default" values — even if a field is technically populated
 * with the seed value, treat it as missing so the merchant explicitly confirms.
 */
export function fieldIsCustomized(key: CriticalFieldKey, value: any): boolean {
  if (value == null || value === '') return false;
  if (key === 'fromEmail') return value !== DEFAULT_FROM_EMAIL;
  if (key === 'returnAddress') return !String(value).includes(DEFAULT_RETURN_ADDRESS_MARKER);
  if (key === 'returnPolicy') return !String(value).startsWith(DEFAULT_POLICY_MARKER);
  if (key === 'returnWindow') return typeof value === 'number' && value > 0;
  return true;
}

export type OnboardingStatus = 'complete' | 'skipped' | 'pending';
export type OnboardingState = {
  status: OnboardingStatus;
  missingFields: CriticalFieldKey[];
  settings: any;
};

export function evaluateOnboarding(settings: any): OnboardingState {
  if (!settings) {
    return { status: 'pending', missingFields: CRITICAL_FIELDS.map((f) => f.key), settings: null };
  }
  const missingFields = CRITICAL_FIELDS
    .filter((f) => !fieldIsCustomized(f.key, settings[f.key]))
    .map((f) => f.key);

  // Once the merchant has explicitly completed the onboarding action (which
  // validates every field server-side before stamping the timestamp), trust
  // it — even if a value happens to match a DB default marker (e.g. the
  // policy template). Otherwise users get bounced back into the wizard.
  if (settings.onboardingCompletedAt) {
    return { status: 'complete', missingFields, settings };
  }
  if (settings.onboardingSkippedAt) {
    return { status: 'skipped', missingFields, settings };
  }
  return { status: 'pending', missingFields, settings };
}
