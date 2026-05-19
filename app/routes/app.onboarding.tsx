import { useState, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, Btn, Input, Textarea, useToast } from "../components/ui";
import { ensureShopSettings, evaluateOnboarding } from "../lib/onboarding.server";
import { CRITICAL_FIELDS, fieldIsCustomized } from "../lib/onboarding";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await ensureShopSettings(shop);

  const state = evaluateOnboarding(settings);
  if (state.status === 'complete') {
    const url = new URL(request.url);
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return {
    shop,
    initial: {
      fromEmail: fieldIsCustomized('fromEmail', settings.fromEmail) ? settings.fromEmail : '',
      returnAddress: fieldIsCustomized('returnAddress', settings.returnAddress) ? settings.returnAddress : '',
      returnWindow: fieldIsCustomized('returnWindow', settings.returnWindow) ? settings.returnWindow : 30,
      returnPolicy: fieldIsCustomized('returnPolicy', settings.returnPolicy) ? settings.returnPolicy : '',
    },
    alreadySkipped: !!settings.onboardingSkippedAt,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  if (intent === "skip") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { onboardingSkippedAt: new Date() }
    });
    return { ok: true, redirectTo: qs ? `/app?${qs}` : '/app' };
  }

  if (intent === "complete") {
    const fromEmail = String(formData.get("fromEmail") || '').trim();
    const returnAddress = String(formData.get("returnAddress") || '').trim();
    const returnWindow = Number(formData.get("returnWindow")) || 30;
    const returnPolicy = String(formData.get("returnPolicy") || '').trim();

    if (!fromEmail || !returnAddress || !returnPolicy || returnWindow < 1) {
      return { error: "Please complete every field before finishing." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      return { error: "That doesn't look like a valid email address." };
    }

    await prisma.shopSettings.update({
      where: { shop },
      data: {
        fromEmail,
        returnAddress,
        returnWindow,
        returnPolicy,
        onboardingCompletedAt: new Date(),
        onboardingSkippedAt: null,
      }
    });
    const extra = qs ? `&${qs}` : '';
    return { ok: true, redirectTo: `/app?onboarded=1${extra}` };
  }

  return null;
};

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'fromEmail', title: 'Reply-to email' },
  { id: 'returnAddress', title: 'Return address' },
  { id: 'returnWindow', title: 'Return window' },
  { id: 'returnPolicy', title: 'Return policy' },
  { id: 'done', title: 'All set' },
] as const;

const POLICY_TEMPLATE = `We want you to love what you buy. If something isn't quite right, here's how it works:

· Returns are accepted within 30 days of delivery.
· Items must be unworn, unwashed, and in original packaging.
· Final-sale items (marked at checkout) cannot be returned.
· Refunds are issued to the original payment method within 3–5 business days of receiving the returned item.

To start a return, head to our return portal with your order number and email. We'll email a prepaid label and you can drop it off at any location.

Questions? Email us — we usually reply within 1 business day.`;

export default function OnboardingPage() {
  const { initial, alreadySkipped } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toast = useToast();
  const navigate = useNavigate();

  const [stepIdx, setStepIdx] = useState(0);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [returnAddress, setReturnAddress] = useState(initial.returnAddress);
  const [returnWindow, setReturnWindow] = useState<number>(initial.returnWindow);
  const [returnPolicy, setReturnPolicy] = useState(initial.returnPolicy);

  const step = STEPS[stepIdx];

  // Per-step validation
  const stepValid = useMemo(() => {
    if (step.id === 'welcome' || step.id === 'done') return true;
    if (step.id === 'fromEmail') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail.trim());
    if (step.id === 'returnAddress') return returnAddress.trim().length > 10;
    if (step.id === 'returnWindow') return returnWindow >= 1 && returnWindow <= 365;
    if (step.id === 'returnPolicy') return returnPolicy.trim().length > 30;
    return true;
  }, [step.id, fromEmail, returnAddress, returnWindow, returnPolicy]);

  const goNext = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIdx((i) => Math.max(i - 1, 0));

  const submitting = fetcher.state !== 'idle';

  const handleFinish = () => {
    fetcher.submit({
      intent: 'complete',
      fromEmail: fromEmail.trim(),
      returnAddress: returnAddress.trim(),
      returnWindow: String(returnWindow),
      returnPolicy: returnPolicy.trim(),
    }, { method: 'POST' });
  };

  const handleSkip = () => {
    if (!confirm('Skip setup for now? Returns and refunds may not work correctly until you complete the critical fields.')) return;
    fetcher.submit({ intent: 'skip' }, { method: 'POST' });
  };

  useEffect(() => {
    const data = fetcher.data as any;
    if (data?.error) toast?.({ kind: 'error', title: 'Error', body: data.error });
    if (data?.ok && data?.redirectTo) navigate(data.redirectTo, { replace: true });
  }, [fetcher.data, toast, navigate]);

  return (
    <div className="-m-6 md:-m-10 min-h-[calc(100vh-2rem)] flex flex-col relative">
      {/* Skip — discreet, floats top-right, intentionally outside the stepper */}
      {step.id !== 'done' && (
        <button
          onClick={handleSkip}
          disabled={submitting}
          className="absolute top-5 right-5 md:top-6 md:right-8 z-10 text-[12.5px] text-muted hover:text-ink transition px-3 py-1.5 rounded-md hover:bg-elevated"
        >
          Skip for now
        </button>
      )}

      {/* Stepper — bare row of dots, no card, no border */}
      <div className="px-6 md:px-10 pt-10 pb-2 flex justify-center">
        <ol className="flex items-center w-full max-w-md">
          {STEPS.map((s, idx) => {
            const reached = idx <= stepIdx;
            const isCurrent = idx === stepIdx;
            return (
              <li key={s.id} className="flex items-center flex-1 last:flex-none">
                <div
                  className={`shrink-0 w-7 h-7 rounded-full grid place-content-center text-[11.5px] font-semibold transition ${
                    reached
                      ? 'text-white shadow-[0_2px_8px_rgba(108,99,255,0.4)]'
                      : 'text-muted border border-divider bg-surface'
                  } ${isCurrent ? 'ring-2 ring-accent2/40 ring-offset-2 ring-offset-bg' : ''}`}
                  style={reached ? { background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' } : undefined}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={s.title}
                >
                  {idx + 1}
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className="h-px flex-1 mx-2 transition-all"
                    style={{
                      background:
                        idx < stepIdx
                          ? 'linear-gradient(90deg,#6C63FF,#8B5CF6)'
                          : undefined,
                    }}
                  >
                    {idx >= stepIdx && <div className="h-full bg-divider" />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Step content — centered card */}
      <main className="flex-1 flex items-start md:items-center justify-center px-6 md:px-10 pt-6 pb-10">
        <div className="w-full max-w-xl">

          {step.id === 'welcome' && (
            <WelcomeStep onStart={goNext} alreadySkipped={alreadySkipped} />
          )}

          {step.id === 'fromEmail' && (
            <FieldStep
              field={CRITICAL_FIELDS.find(f => f.key === 'fromEmail')!}
              icon="Mail"
            >
              <label className="text-[12.5px] font-medium text-muted block mb-1.5">Email address</label>
              <Input
                value={fromEmail}
                onChange={(e: any) => setFromEmail(e.target.value)}
                placeholder="returns@yourstore.com"
                type="email"
                autoFocus
              />
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                Tip: use an inbox that someone monitors — customers will reply to it with questions.
              </p>
            </FieldStep>
          )}

          {step.id === 'returnAddress' && (
            <FieldStep
              field={CRITICAL_FIELDS.find(f => f.key === 'returnAddress')!}
              icon="MapPin"
            >
              <label className="text-[12.5px] font-medium text-muted block mb-1.5">Full return address</label>
              <Textarea
                value={returnAddress}
                onChange={(e: any) => setReturnAddress(e.target.value)}
                placeholder={"Your Store — Returns\n123 Main Street, Suite 200\nCity, State 12345\nCountry"}
                rows={6}
                autoFocus
              />
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                Include the full mailing address. This is printed on shipping labels and shown to customers.
              </p>
            </FieldStep>
          )}

          {step.id === 'returnWindow' && (
            <FieldStep
              field={CRITICAL_FIELDS.find(f => f.key === 'returnWindow')!}
              icon="CalendarClock"
            >
              <label className="text-[12.5px] font-medium text-muted block mb-1.5">Days from delivery</label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[15, 30, 60, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setReturnWindow(d)}
                    className={`py-2.5 rounded-lg text-[13px] font-semibold transition border ${
                      returnWindow === d
                        ? 'bg-accent2/20 text-accent2 border-accent2/40'
                        : 'bg-elevated text-muted border-divider hover:text-ink hover:border-border'
                    }`}>
                    {d} days
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={365}
                value={returnWindow}
                onChange={(e: any) => setReturnWindow(parseInt(e.target.value) || 0)}
                placeholder="30"
              />
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                Industry standard is 30 days. Apparel often allows 60, while electronics typically 14–30.
              </p>
            </FieldStep>
          )}

          {step.id === 'returnPolicy' && (
            <FieldStep
              field={CRITICAL_FIELDS.find(f => f.key === 'returnPolicy')!}
              icon="FileText"
            >
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12.5px] font-medium text-muted">Your return policy</label>
                {!returnPolicy.trim() && (
                  <button type="button" onClick={() => setReturnPolicy(POLICY_TEMPLATE)}
                          className="text-[11.5px] text-accent2 hover:text-white transition font-semibold">
                    Use template →
                  </button>
                )}
              </div>
              <Textarea
                value={returnPolicy}
                onChange={(e: any) => setReturnPolicy(e.target.value)}
                placeholder="Describe your return conditions, exclusions, and refund timing…"
                rows={10}
                autoFocus
              />
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                Plain language wins. You can always refine this later from Settings.
              </p>
            </FieldStep>
          )}

          {step.id === 'done' && (
            <DoneStep
              onFinish={handleFinish}
              submitting={submitting}
              summary={{ fromEmail, returnAddress, returnWindow, returnPolicy }}
            />
          )}

          {/* Footer nav */}
          {step.id !== 'welcome' && step.id !== 'done' && (
            <div className="flex items-center justify-between mt-8">
              <Btn variant="ghost" icon="ArrowLeft" onClick={goBack} disabled={submitting}>Back</Btn>
              <Btn variant="primary" iconRight="ArrowRight" onClick={goNext} disabled={!stepValid || submitting}>
                Continue
              </Btn>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

function WelcomeStep({ onStart, alreadySkipped }: any) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl grid place-content-center text-white shadow-[0_10px_30px_-8px_rgba(108,99,255,0.6)] mx-auto mb-6"
           style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
        <Icon name="Sparkles" size={28} strokeWidth={2.2} />
      </div>
      <h1 className="text-[32px] md:text-[36px] font-bold text-ink tracking-tight leading-tight">
        Let's set up your returns
      </h1>
      <p className="text-[15px] text-muted mt-3 max-w-md mx-auto leading-relaxed">
        Four quick questions — about <strong className="text-ink font-semibold">2 minutes</strong>. We need a few essentials before refunds and emails to your customers can work correctly.
      </p>
      {alreadySkipped && (
        <div className="mt-5 mx-auto max-w-md px-3.5 py-2.5 rounded-lg bg-warn/10 border border-warn/20 text-[12.5px] text-warn text-left flex items-start gap-2">
          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
          <div>You skipped this earlier. Setup is still incomplete — finishing now will unlock the full flow.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mt-8 max-w-md mx-auto text-left">
        <Feature icon="Mail"          title="Reply-to email"   sub="Where customers can answer back." />
        <Feature icon="MapPin"        title="Return address"   sub="Where they ship the box." />
        <Feature icon="CalendarClock" title="Return window"    sub="How many days they get." />
        <Feature icon="FileText"      title="Return policy"    sub="The fine print, in plain words." />
      </div>
      <Btn variant="primary" size="lg" iconRight="ArrowRight" onClick={onStart} className="mt-8">
        Get started
      </Btn>
    </div>
  );
}

function Feature({ icon, title, sub }: any) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-elevated border border-divider">
      <div className="w-7 h-7 rounded-md bg-accent/15 text-accent2 grid place-content-center shrink-0">
        <Icon name={icon} size={14} />
      </div>
      <div>
        <div className="text-[12.5px] font-semibold text-ink">{title}</div>
        <div className="text-[11.5px] text-muted mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function FieldStep({ field, icon, children }: any) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent2 grid place-content-center shrink-0">
          <Icon name={icon} size={18} />
        </div>
        <div>
          <h2 className="text-[22px] font-semibold text-ink tracking-tight">{field.label}</h2>
        </div>
      </div>
      <p className="text-[13px] text-muted leading-relaxed mb-5">{field.why}</p>
      <div className="rf-glass rounded-xl p-5">
        {children}
      </div>
    </div>
  );
}

function DoneStep({ onFinish, submitting, summary }: any) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl grid place-content-center text-white shadow-[0_10px_30px_-8px_rgba(34,197,94,0.6)] mx-auto mb-6 relative"
           style={{ background: 'linear-gradient(135deg,#22C55E,#10B981)' }}>
        <Icon name="Check" size={32} strokeWidth={3} />
        <span className="absolute inset-0 rounded-2xl animate-ping opacity-30"
              style={{ background: 'linear-gradient(135deg,#22C55E,#10B981)' }} />
      </div>
      <h1 className="text-[32px] font-bold text-ink tracking-tight">You're all set</h1>
      <p className="text-[14.5px] text-muted mt-2 max-w-md mx-auto leading-relaxed">
        Your store is ready to handle returns. Here's a quick recap of what you configured:
      </p>
      <div className="mt-6 text-left rf-glass rounded-xl p-5 space-y-3">
        <SummaryRow icon="Mail"          label="Reply-to email" value={summary.fromEmail} />
        <SummaryRow icon="MapPin"        label="Return address" value={summary.returnAddress.split('\n')[0] + '…'} />
        <SummaryRow icon="CalendarClock" label="Return window"  value={`${summary.returnWindow} days`} />
        <SummaryRow icon="FileText"      label="Return policy"  value={`${summary.returnPolicy.slice(0, 60)}…`} />
      </div>
      <Btn variant="primary" size="lg" icon="Rocket" onClick={onFinish} disabled={submitting} className="mt-8">
        {submitting ? 'Saving…' : 'Go to dashboard'}
      </Btn>
      <div className="text-[11.5px] text-muted mt-3">You can change any of this from Settings.</div>
    </div>
  );
}

function SummaryRow({ icon, label, value }: any) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-md bg-accent/15 text-accent2 grid place-content-center shrink-0">
        <Icon name={icon} size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] text-muted">{label}</div>
        <div className="text-[13px] text-ink font-medium truncate">{value}</div>
      </div>
    </div>
  );
}
