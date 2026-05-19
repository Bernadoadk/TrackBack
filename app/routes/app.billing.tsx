import { useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Card, Btn, Icon, useToast } from "../components/ui";
import { isBillingTestMode, syncBillingFromShopify } from "../lib/plan.server";

const PLANS = [
  { id: 'free',    name: 'Free',    price: 0,  unit: 'forever', monthlyLimit: 10,
    summary: '10 returns / month',
    features: ['Customer return portal', 'Email notifications', 'Basic analytics', 'Up to 10 returns/month'],
  },
  { id: 'starter', name: 'Starter', price: 19, unit: 'month',   monthlyLimit: 100, popular: true,
    summary: '100 returns / month',
    features: ['Everything in Free', 'Custom branding & logo', 'Advanced analytics', 'Email templates', 'Priority support'],
  },
  { id: 'pro',     name: 'Pro',     price: 49, unit: 'month',   monthlyLimit: 999999,
    summary: 'Unlimited returns',
    features: ['Everything in Starter', 'Live chat with customers', 'API access & webhooks', 'Custom return reasons', 'White-label portal', 'Dedicated CSM'],
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Source of truth = Shopify. This re-queries active subscriptions and
  // mirrors them into the local DB, so the page always reflects reality
  // whether the user just approved, declined, cancelled, or never visited
  // the approval URL at all.
  const resolvedPlan = await syncBillingFromShopify(admin, shop);

  // Detect "just activated" (charge_id in URL + we now have a paid plan) so
  // we can fire a one-time success toast.
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  const activated = !!(chargeId && resolvedPlan !== 'free');

  // Count this month's returns
  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  firstDayOfMonth.setHours(0, 0, 0, 0);

  const usedThisMonth = await prisma.returnRequest.count({
    where: { shop, createdAt: { gte: firstDayOfMonth } }
  });

  const currentPlan = PLANS.find(p => p.id === resolvedPlan) || PLANS[0];
  const limit = currentPlan.monthlyLimit;

  return { usedThisMonth, limit, currentPlan, activated };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing: shopifyBilling } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const intent = formData.get("intent") as string;
  const testMode = isBillingTestMode();

  if (intent === "upgrade" && planId !== "free") {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) return { error: "Plan not found" };

    console.log(`[billing] upgrade → ${plan.name} | BILLING_MODE=${process.env.BILLING_MODE ?? "(unset)"} | isTest=${testMode}`);

    // Already subscribed to this plan?
    try {
      const { hasActivePayment } = await shopifyBilling.check({
        plans: [plan.name],
        isTest: testMode,
      });
      if (hasActivePayment) {
        await prisma.billingSubscription.upsert({
          where: { shop },
          create: { shop, plan: planId, status: "active" },
          update: { plan: planId, status: "active" },
        });
        return { success: true, plan: planId, alreadyActive: true };
      }
    } catch (e) {
      console.error("[billing] billing.check failed (continuing):", e);
    }

    // Request subscription. In React Router 7 with embedded auth, billing.request()
    // throws a Response (302/401) that contains the Shopify confirmation URL in headers.
    //
    // We DON'T write to the local DB here — Shopify hasn't confirmed anything yet.
    // The DB only gets updated by `syncBillingFromShopify` after the user actually
    // approves (or doesn't). This avoids stale "pending" rows when the user
    // cancels the approval page.
    try {
      const response = (await shopifyBilling.request({
        plan: plan.name as any,
        isTest: testMode,
        // returnUrl defaults to the appUrl; Shopify redirects back with ?charge_id=...
      })) as any;

      // Some SDK versions return a Response instead of throwing — handle both
      if (response instanceof Response) {
        const url = extractConfirmationUrl(response);
        if (url) return { confirmationUrl: url };
      }
      // Legacy shape: { confirmationUrl, appSubscription }
      if (response?.confirmationUrl) {
        return { confirmationUrl: response.confirmationUrl };
      }
      return { error: "Could not start subscription — no confirmation URL returned." };
    } catch (error) {
      if (error instanceof Response) {
        const url = await extractConfirmationUrlAsync(error);
        if (url) return { confirmationUrl: url };
      }
      console.error("[billing] subscription request failed:", error);
      return { error: "Could not start subscription. Please try again." };
    }
  }

  if (intent === "cancel") {
    try {
      // Look up the active subscription on Shopify side, then cancel it.
      const allPaidPlans = PLANS.filter((p) => p.id !== "free").map((p) => p.name);
      const billingCheck = await shopifyBilling.check({
        plans: allPaidPlans as any,
        isTest: testMode,
      });
      const subscription = (billingCheck as any).appSubscriptions?.[0];
      if (subscription) {
        await shopifyBilling.cancel({
          subscriptionId: subscription.id,
          isTest: testMode,
          prorate: true,
        });
      }
    } catch (e) {
      console.error("[billing] cancel failed (continuing to local downgrade):", e);
    }

    await prisma.billingSubscription.upsert({
      where: { shop },
      create: { shop, plan: "free", status: "active" },
      update: { plan: "free", status: "active", shopifyChargeId: null },
    });
    return { success: true, cancelled: true };
  }

  return null;
};

// Pull a confirmation URL out of various places Shopify can put it.
function extractConfirmationUrl(response: Response): string | null {
  return (
    response.headers.get("Location") ||
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
    null
  );
}

async function extractConfirmationUrlAsync(response: Response): Promise<string | null> {
  const fromHeaders = extractConfirmationUrl(response);
  if (fromHeaders) return fromHeaders;
  try {
    const body = await response.text();
    const m = body.match(/https:\/\/[^\s"'<>]+confirm[^\s"'<>]*/);
    if (m) return m[0];
  } catch {
    /* ignore */
  }
  return null;
}

export default function BillingPage() {
  const { usedThisMonth, limit, currentPlan, activated } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toast = useToast();

  // Show success toast when coming back from Shopify billing approval
  const shownActivated = useRef(false);
  useEffect(() => {
    if (activated && !shownActivated.current) {
      shownActivated.current = true;
      toast({ kind: 'success', title: `${currentPlan.name} plan activated!` });
    }
  }, [activated]);

  const pct = limit > 1000 ? 0 : Math.min((usedThisMonth / limit) * 100, 100);
  const isNearLimit = pct >= 80;
  const isSaving = fetcher.state !== 'idle';

  const handleUpgrade = (planId: string) => {
    const fd = new FormData();
    fd.append("intent", "upgrade");
    fd.append("planId", planId);
    fetcher.submit(fd, { method: "POST" });
  };

  // Redirect to Shopify billing confirmation page (opens at the top of the iframe)
  const redirectedRef = useRef<string | null>(null);
  useEffect(() => {
    const data = fetcher.data as any;
    if (!data?.confirmationUrl) return;
    if (redirectedRef.current === data.confirmationUrl) return;
    redirectedRef.current = data.confirmationUrl;
    // `_top` busts out of the embedded iframe so the merchant lands on the
    // Shopify billing confirmation page.
    open(data.confirmationUrl, "_top");
  }, [fetcher.data]);

  const toastedSuccessRef = useRef(false);
  useEffect(() => {
    const data = fetcher.data as any;
    if (!data) return;
    if (data.success && !data.cancelled && !toastedSuccessRef.current) {
      toastedSuccessRef.current = true;
      toast({
        kind: 'success',
        title: data.alreadyActive ? 'Subscription already active' : 'Plan activated!',
        body: data.alreadyActive ? "You're already subscribed to this plan." : 'Enjoy all features of your new plan.',
      });
    }
    if (data.cancelled) {
      toast({ kind: 'info', title: 'Downgraded to Free plan' });
    }
    if (data.error) {
      toast({ kind: 'error', title: 'Billing error', body: data.error });
    }
  }, [fetcher.data, toast]);

  return (
    <div>
      <PageHeader title="Billing & Plans" subtitle="Manage your subscription and invoices." />

      {/* Current plan banner */}
      <div className="bg-surface border border-border rounded-lg p-5 mb-6 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full opacity-[0.06] bg-warn pointer-events-none" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md grid place-content-center" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
              <Icon name="Sparkles" size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold text-ink">
                  You're on the <span className="text-warn">{currentPlan.name.toUpperCase()}</span> plan
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
                  {limit > 1000 ? 'Unlimited' : `${limit} returns/month`}
                </span>
              </div>
              <div className="text-[12.5px] text-muted mt-1">
                {currentPlan.id === 'free' ? 'Upgrade to unlock branding, analytics and unlimited returns.' : `${currentPlan.summary} · Cancel anytime.`}
              </div>
            </div>
          </div>

          {limit <= 1000 && (
            <div className="w-full md:w-[280px]">
              <div className="flex items-center justify-between text-[12px] mb-1.5">
                <span className="text-muted">Usage this month</span>
                <span className="text-ink font-semibold tabular-nums">{usedThisMonth} / {limit}</span>
              </div>
              <div className="h-2 rounded-full bg-bg overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                     style={{ width: pct + '%', background: isNearLimit ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : 'linear-gradient(90deg,#6C63FF,#8B85FF)' }} />
              </div>
              {isNearLimit && (
                <div className="text-[11px] text-warn mt-1.5 flex items-center gap-1">
                  <Icon name="TriangleAlert" size={11} /> You're approaching your limit
                </div>
              )}
            </div>
          )}
        </div>

        {currentPlan.id !== 'free' && (
          <div className="mt-4 pt-4 border-t border-divider">
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="cancel" />
              <button type="submit" disabled={isSaving}
                className="text-[12px] text-muted hover:text-danger transition">
                Downgrade to Free plan
              </button>
            </fetcher.Form>
          </div>
        )}
      </div>

      {/* Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {PLANS.map(p => {
          const isPop = p.popular;
          const isCurrent = currentPlan.id === p.id;
          return (
            <div key={p.id}
                 className={`relative bg-surface border rounded-xl p-6 flex flex-col transition-all ${
                   isPop ? 'border-accent shadow-[0_0_0_1px_rgba(108,99,255,0.5),0_12px_40px_rgba(108,99,255,0.18)]' : 'border-border hover:border-[#3a3e58]'
                 }`}>
              {isPop && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10.5px] font-bold px-2.5 py-1 rounded-full text-white tracking-wide"
                     style={{ background: 'linear-gradient(90deg,#6C63FF,#8B5CF6)', boxShadow: '0 4px 12px rgba(108,99,255,0.4)' }}>
                  ⭐ MOST POPULAR
                </div>
              )}
              <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: isPop ? '#8B85FF' : '#8B8FA8' }}>{p.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[36px] font-bold text-ink tracking-tight tabular-nums">${p.price}</span>
                <span className="text-[13px] text-muted">/{p.unit === 'month' ? 'mo' : p.unit}</span>
              </div>
              <div className="text-[13px] text-ink mt-1">{p.summary}</div>

              <div className="mt-5 pt-5 border-t border-divider space-y-2.5 flex-1">
                {p.features.map(f => (
                  <div key={f} className="flex items-start gap-2 text-[12.5px]">
                    <Icon name="Check" size={13} className="mt-0.5 shrink-0" style={{ color: isPop ? '#8B85FF' : '#22C55E' }} strokeWidth={2.5} />
                    <span className="text-ink">{f}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                {isCurrent ? (
                  <button disabled className="w-full h-10 rounded-md border border-border text-[13px] font-semibold text-muted bg-bg/40 cursor-default">
                    Current Plan
                  </button>
                ) : isPop ? (
                  <Btn variant="primary" className="w-full" size="lg" disabled={isSaving}
                       onClick={() => handleUpgrade(p.id)}>
                    {isSaving ? 'Redirecting...' : `Upgrade to ${p.name}`}
                  </Btn>
                ) : (
                  <Btn variant="secondary" className="w-full" size="lg" disabled={isSaving}
                       onClick={() => handleUpgrade(p.id)}>
                    {isSaving ? 'Redirecting...' : `Upgrade to ${p.name}`}
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center text-[12.5px] text-muted mb-8 flex items-center justify-center gap-1.5">
        <Icon name="Shield" size={13} className="text-accent2"/>
        <span>Cancel anytime. No trial period.</span>
      </div>

      <div className="mt-8 p-5 rounded-lg border border-divider bg-bg/30 flex items-start gap-3">
        <Icon name="MessageCircleQuestion" size={18} className="text-accent2 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Questions about pricing?</div>
          <div className="text-[12.5px] text-muted mt-0.5">Chat with our team — we usually reply within an hour.</div>
        </div>
        <Btn
          variant="secondary"
          size="sm"
          icon="MessageCircleMore"
          onClick={() => window.dispatchEvent(new Event('returnflow:open-support-chat'))}
        >
          Contact us
        </Btn>
      </div>
    </div>
  );
}
