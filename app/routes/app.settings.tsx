import { useState, useEffect, type ReactNode } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Toggle, Input, Textarea, Select, useToast } from "../components/ui";
import { DEFAULT_REASONS, EMAIL_TEMPLATES } from "../components/mock-data";
import { getShopPlan, planAtLeast, syncBillingFromShopify } from "../lib/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const appUrl = new URL(request.url).origin;

  let settings = await prisma.shopSettings.findUnique({
    where: { shop },
    include: { reasons: true },
  });

  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: {
        shop,
        reasons: {
          create: DEFAULT_REASONS.map(r => ({ label: r.label, enabled: r.enabled }))
        }
      },
      include: { reasons: true }
    });
  }

  // Sync directly with Shopify to avoid races with the parent app.tsx loader.
  const [emailTemplates, plan] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { shop } }),
    syncBillingFromShopify(admin, shop),
  ]);

  // Seed default templates if not present
  const TEMPLATE_TYPES = ['Request Received', 'Approved', 'Rejected', 'Refunded'];
  for (const type of TEMPLATE_TYPES) {
    const exists = emailTemplates.find(t => t.type === type);
    if (!exists) {
      const def = EMAIL_TEMPLATES[type as keyof typeof EMAIL_TEMPLATES];
      await prisma.emailTemplate.create({ data: { shop, type, subject: def.subject, body: def.body } });
    }
  }
  const templates = await prisma.emailTemplate.findMany({ where: { shop } });

  return { settings, templates, shop, appUrl, plan };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_general") {
    await prisma.shopSettings.update({
      where: { shop },
      data: {
        returnWindow: Number(formData.get("returnWindow")),
        returnAddress: formData.get("returnAddress") as string,
        autoApprove: formData.get("autoApprove") === "true",
        autoExpireDays: Number(formData.get("autoExpireDays")) || 7,
        blockedSkus: formData.get("blockedSkus") as string || "",
        notifyMerchant: formData.get("notifyMerchant") === "true",
        fromEmail: formData.get("fromEmail") as string,
        allowStoreCredit: formData.get("allowStoreCredit") === "true",
        allowExchanges: formData.get("allowExchanges") === "true",
        storeCreditBonusPercent: Number(formData.get("storeCreditBonusPercent")),
        incentivizeStoreCredit: formData.get("incentivizeStoreCredit") === "true"
      }
    });
  } else if (intent === "save_reasons") {
    const shopPlan = await getShopPlan(shop);
    if (!planAtLeast(shopPlan, 'pro')) {
      return { error: 'upgrade_required' };
    }
    const reasonsStr = formData.get("reasons") as string;
    const reasons = JSON.parse(reasonsStr);
    
    await prisma.$transaction([
      prisma.returnReason.deleteMany({ where: { shop } }),
      prisma.returnReason.createMany({
        data: reasons.map((r: any) => ({ shop, label: r.label, enabled: r.enabled }))
      })
    ]);
  } else if (intent === "save_policy") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { returnPolicy: formData.get("returnPolicy") as string }
    });
  } else if (intent === "save_email_template") {
    const type = formData.get("templateType") as string;
    const subject = formData.get("subject") as string;
    const body = formData.get("body") as string;
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      create: { shop, type, subject, body },
      update: { subject, body }
    });
  }

  return { success: true };
};

export default function SettingsPage() {
  const { settings, templates, shop, appUrl, plan } = useLoaderData<typeof loader>();

  const tabs = [
    { key: 'General', icon: 'Settings2' },
    { key: 'Reasons', icon: 'Tag' },
    { key: 'Emails',  icon: 'Mail' },
    { key: 'Policy',  icon: 'FileText' },
    { key: 'Portal',  icon: 'Globe' },
  ];

  // Support deep-link via ?tab=Portal (or any other tab key)
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'General';
    const t = new URL(window.location.href).searchParams.get('tab');
    return tabs.some(x => x.key === t) ? (t as string) : 'General';
  })();
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('tab');
    if (t && tabs.some(x => x.key === t)) setTab(t);
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure how returns work for your store." />

      {/* Secondary tab nav */}
      <div className="flex items-center gap-1 border-b border-divider mb-6 overflow-x-auto">
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              <Icon name={t.icon} size={13.5} />
              {t.key}
              {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {tab === 'General' && <GeneralTab settings={settings} />}
      {tab === 'Reasons' && <ReasonsTab settings={settings} plan={plan} />}
      {tab === 'Emails'  && <EmailsTab templates={templates} />}
      {tab === 'Policy'  && <PolicyTab settings={settings} />}
      {tab === 'Portal'  && <PortalAccessTab shop={shop} appUrl={appUrl} />}
    </div>
  );
}

function SettingRow({ label, hint, children, wide }: any) {
  return (
    <div className={`py-5 border-b border-divider last:border-0 grid ${wide ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[260px_1fr]'} gap-3 md:gap-8`}>
      <div className="pt-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-1 leading-relaxed max-w-[260px]">{hint}</div>}
      </div>
      <div className="max-w-xl">{children}</div>
    </div>
  );
}

function SaveBar({ onSave, onDiscard, isSaving, disabled }: any) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      <Btn variant="ghost" onClick={onDiscard} disabled={isSaving || disabled}>Discard</Btn>
      <Btn variant="primary" icon="Check" onClick={onSave} disabled={isSaving || disabled}>
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Btn>
    </div>
  );
}

// ---- General tab ----
function GeneralTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_general";
  const actionData = useActionData<typeof action>();

  const [returnWindow, setReturnWindow] = useState(settings.returnWindow);
  const [address, setAddress] = useState(settings.returnAddress);
  const [autoApprove, setAutoApprove] = useState(settings.autoApprove);
  const [autoExpireDays, setAutoExpireDays] = useState(settings.autoExpireDays ?? 7);
  const [blockedSkus, setBlockedSkus] = useState(settings.blockedSkus ?? "");
  const [notify, setNotify] = useState(settings.notifyMerchant);
  const [fromEmail, setFromEmail] = useState(settings.fromEmail);
  const [allowStoreCredit, setAllowStoreCredit] = useState(settings.allowStoreCredit);
  const [allowExchanges, setAllowExchanges] = useState(settings.allowExchanges);
  const [storeCreditBonusPercent, setStoreCreditBonusPercent] = useState(settings.storeCreditBonusPercent);
  const [incentivizeStoreCredit, setIncentivizeStoreCredit] = useState(settings.incentivizeStoreCredit);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_general") {
      toast({ kind: 'success', title: 'General settings saved' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_general");
    formData.append("returnWindow", returnWindow.toString());
    formData.append("returnAddress", address);
    formData.append("autoApprove", autoApprove.toString());
    formData.append("autoExpireDays", autoExpireDays.toString());
    formData.append("blockedSkus", blockedSkus);
    formData.append("notifyMerchant", notify.toString());
    formData.append("fromEmail", fromEmail);
    formData.append("allowStoreCredit", allowStoreCredit.toString());
    formData.append("allowExchanges", allowExchanges.toString());
    formData.append("storeCreditBonusPercent", storeCreditBonusPercent.toString());
    formData.append("incentivizeStoreCredit", incentivizeStoreCredit.toString());
    
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg px-6">
      <SettingRow label="Return window" hint="How many days after delivery customers can request a return.">
        <div className="flex items-center gap-2">
          <input type="number" value={returnWindow} onChange={e => setReturnWindow(+e.target.value)}
            className="w-24 h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
          <span className="text-[13px] text-muted">days</span>
        </div>
      </SettingRow>

      <SettingRow label="Return address" hint="Shown on the customer-facing return label and confirmation emails.">
        <Textarea value={address} onChange={(e: any) => setAddress(e.target.value)} rows={4} />
      </SettingRow>

      <SettingRow label="Auto-approve returns" hint="Skip manual review for returns under your return window.">
        <Toggle checked={autoApprove} onChange={setAutoApprove}
                label={autoApprove ? 'Returns are auto-approved' : 'Manual review required'}
                description="Recommended off until your reason policy is tuned." />
      </SettingRow>

      <SettingRow label="Auto-expire approved returns" hint="Automatically expire approved returns if the customer hasn't shipped after this many days.">
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={60} value={autoExpireDays} onChange={e => setAutoExpireDays(Math.max(1, +e.target.value))}
            className="w-24 h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
          <span className="text-[13px] text-muted">days after approval</span>
        </div>
      </SettingRow>

      <SettingRow label="Blocked SKUs / product IDs" hint="Comma-separated list of SKUs or Shopify product IDs that cannot be returned. Leave empty to allow all.">
        <Textarea
          value={blockedSkus}
          onChange={(e: any) => setBlockedSkus(e.target.value)}
          rows={3}
          placeholder="e.g. SALE-FINAL, SKU-001, gid://shopify/Product/123456789"
        />
        <div className="mt-1.5 text-[11.5px] text-faint">Customers will see an error if they try to return these items.</div>
      </SettingRow>

      <SettingRow label="Notify merchant" hint="Get an email each time a customer files a new return.">
        <Toggle checked={notify} onChange={setNotify}
                label="Email me when a new request comes in"
                description={fromEmail} />
      </SettingRow>

      <SettingRow label="From email" hint="The reply-to address on automated emails to customers.">
        <Input value={fromEmail} onChange={(e: any) => setFromEmail(e.target.value)} type="email" />
      </SettingRow>

      {/* Revenue Retention section */}
      <div className="py-6 border-b border-divider last:border-0">
        <div className="mb-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(108,99,255,0.15)', color: '#8B85FF' }}>
            <Icon name="TrendingUp" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Revenue Retention</div>
            <div className="text-[12.5px] text-muted mt-0.5 max-w-md leading-relaxed">
              Encourage customers to keep revenue in your store instead of requesting refunds.
            </div>
          </div>
        </div>

        <div className="space-y-4 ml-0 md:ml-12">
          {/* Store credit */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={allowStoreCredit} onChange={setAllowStoreCredit}
                    label="Allow Store Credit refunds"
                    description="Let customers choose store credit — issued instantly, retains revenue." />
            {allowStoreCredit && (
              <div className="mt-3 pl-12 space-y-3 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Store credit bonus</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={0} max={50}
                           value={storeCreditBonusPercent}
                           onChange={e => setStoreCreditBonusPercent(Math.max(0, Math.min(50, +e.target.value || 0)))}
                           placeholder="10"
                           className="w-20 h-8 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
                    <span className="text-[12.5px] text-muted">% bonus</span>
                  </div>
                  <span className="text-[11.5px] text-faint">0 = no bonus</span>
                </div>
                <Toggle checked={incentivizeStoreCredit}
                        onChange={setIncentivizeStoreCredit}
                        label="Incentivize store credit in the portal"
                        description="Show a badge and the bonus percentage on the store-credit option." />
                {incentivizeStoreCredit && storeCreditBonusPercent > 0 && (
                  <div className="px-3 py-2 rounded-md text-[12px] flex items-center gap-2 animate-fadeIn"
                       style={{ background: 'rgba(108,99,255,0.10)', color: '#8B85FF' }}>
                    <Icon name="Sparkles" size={12} />
                    Customers will see <strong className="text-ink">+{storeCreditBonusPercent}% bonus credit</strong> on the store-credit option.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exchanges */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={allowExchanges} onChange={setAllowExchanges}
                    label="Allow Exchanges"
                    description="Let customers swap an item for another size, color, or product." />
            {allowExchanges && (
              <div className="mt-3 pl-12 space-y-2 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Exchange window</label>
                  <span className="text-[12.5px] text-ink">Same as return window ({returnWindow} days)</span>
                </div>
                <div className="text-[11.5px] text-muted leading-relaxed">
                  Customers will be able to select <span className="text-ink">Exchange</span> as their refund type in the portal.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pb-6"><SaveBar onSave={handleSave} onDiscard={() => {
        setReturnWindow(settings.returnWindow);
        setAddress(settings.returnAddress);
        setAutoApprove(settings.autoApprove);
        setAutoExpireDays(settings.autoExpireDays ?? 7);
        setBlockedSkus(settings.blockedSkus ?? "");
        setNotify(settings.notifyMerchant);
        setFromEmail(settings.fromEmail);
        setAllowStoreCredit(settings.allowStoreCredit);
        setAllowExchanges(settings.allowExchanges);
        setStoreCreditBonusPercent(settings.storeCreditBonusPercent);
        setIncentivizeStoreCredit(settings.incentivizeStoreCredit);
      }} isSaving={isSaving} /></div>
    </div>
  );
}

// ---- Reasons tab ----
function ReasonsTab({ settings, plan }: any) {
  const isPro = plan === 'pro';
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const location = useLocation();
  const billingHref = `/app/billing${location.search}`;
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_reasons";
  const actionData = useActionData<typeof action>();

  const [reasons, setReasons] = useState(settings.reasons.map((r: any, idx: number) => ({ id: idx, label: r.label, enabled: r.enabled })));
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_reasons") {
      toast({ kind: 'success', title: 'Reasons updated' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const addReason = () => {
    if (!newLabel.trim()) return;
    setReasons((r: any) => [...r, { id: Date.now(), label: newLabel.trim(), enabled: true }]);
    setNewLabel('');
    toast({ kind: 'success', title: 'Reason added' });
  };
  const toggle = (id: number) => setReasons((rs: any) => rs.map((r: any) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  const del = (id: number) => { setReasons((rs: any) => rs.filter((r: any) => r.id !== id)); toast({ kind: 'info', title: 'Reason removed' }); };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_reasons");
    formData.append("reasons", JSON.stringify(reasons.map((r: any) => ({ label: r.label, enabled: r.enabled }))));
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      {!isPro && (
        <div className="flex items-center gap-3 p-4 mb-5 rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/8">
          <Icon name="Lock" size={15} style={{ color: '#8B5CF6' }} className="shrink-0" />
          <p className="text-[12.5px] text-ink flex-1">
            <span className="font-semibold">Custom return reasons require the Pro plan.</span>
            {" "}Upgrade to add, remove, and customize return reasons.
          </p>
          <Link to={billingHref}
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#8B5CF6' }}>
            Upgrade <Icon name="ArrowRight" size={12} />
          </Link>
        </div>
      )}

      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return reasons</div>
          <div className="text-[12.5px] text-muted mt-1">Customers pick one of these when filing a return.</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {reasons.map((r: any) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md bg-bg/30 border border-divider group">
            <Icon name="GripVertical" size={14} className="text-faint cursor-grab" />
            <div className={`flex-1 text-[13.5px] ${r.enabled ? 'text-ink' : 'text-faint line-through'}`}>{r.label}</div>
            <Toggle checked={r.enabled} onChange={() => isPro && toggle(r.id)} disabled={!isPro} />
            <button onClick={() => isPro && del(r.id)} disabled={!isPro} className="p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30">
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-divider flex items-center gap-2">
        <Input value={newLabel} onChange={(e: any) => isPro && setNewLabel(e.target.value)}
               onKeyDown={(e: any) => e.key === 'Enter' && isPro && addReason()}
               placeholder={isPro ? "e.g. Item not as pictured" : "Pro plan required"} className="flex-1"
               disabled={!isPro} />
        <Btn variant="secondary" icon="Plus" onClick={addReason} disabled={!newLabel.trim() || !isPro}>Add Custom Reason</Btn>
      </div>

      <div className="pt-6 border-t border-divider mt-6"><SaveBar onSave={handleSave} onDiscard={() => setReasons(settings.reasons.map((r: any, idx: number) => ({ id: idx, label: r.label, enabled: r.enabled })))} isSaving={isSaving} disabled={!isPro} /></div>
    </div>
  );
}

// ---- Emails tab ----
function EmailsTab({ templates }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const actionData = useActionData<typeof action>();

  const [templateType, setTemplateType] = useState('Request Received');
  
  const currentTemplate = templates.find((t: any) => t.type === templateType) || 
    templates[0] || { subject: '', body: '' };
  
  const [subject, setSubject] = useState(currentTemplate.subject);
  const [body, setBody] = useState(currentTemplate.body);
  
  const isSaving = navigation.state === "submitting" && 
    (navigation.formData as FormData | undefined)?.get("intent") === "save_email_template";

  useEffect(() => {
    const t = templates.find((t: any) => t.type === templateType);
    if (t) { setSubject(t.subject); setBody(t.body); }
  }, [templateType, templates]);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && 
        (navigation.formData as FormData | undefined)?.get("intent") === "save_email_template") {
      toast({ kind: 'success', title: 'Email template saved' });
    }
  }, [actionData, navigation.state, navigation.formData, toast]);

  const handleSave = () => {
    const fd = new FormData();
    fd.append("intent", "save_email_template");
    fd.append("templateType", templateType);
    fd.append("subject", subject);
    fd.append("body", body);
    submit(fd, { method: "POST" });
  };

  const fill = (s: string) => s
    .replace(/\{\{customer_name\}\}/g,  'Sarah')
    .replace(/\{\{rma_number\}\}/g,     'RMA-2026-000012')
    .replace(/\{\{order_number\}\}/g,   '#1089')
    .replace(/\{\{item_count\}\}/g,     '2')
    .replace(/\{\{refund_amount\}\}/g,  '$83.00')
    .replace(/\{\{rejection_reason\}\}/g, 'Outside 30-day return window');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-6">
        <label className="text-[12px] font-medium text-muted block mb-1.5">Template</label>
        <Select value={templateType} onChange={setTemplateType}
          options={['Request Received', 'Approved', 'Rejected', 'Refunded']} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Subject line</label>
        <Input value={subject} onChange={(e: any) => setSubject(e.target.value)} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Body</label>
        <Textarea value={body} onChange={(e: any) => setBody(e.target.value)} rows={11} className="font-mono text-[12.5px]" />

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-faint mr-1">Variables:</span>
          {['{{customer_name}}','{{rma_number}}','{{order_number}}','{{refund_amount}}'].map(v => (
            <span key={v} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent2 font-mono">{v}</span>
          ))}
        </div>

        <SaveBar onSave={handleSave} onDiscard={() => {
          const t = templates.find((t: any) => t.type === templateType);
          if (t) { setSubject(t.subject); setBody(t.body); }
        }} isSaving={isSaving} />
      </div>

      <div className="lg:col-span-2">
        <div className="text-[12px] font-medium text-muted mb-2 flex items-center gap-1.5"><Icon name="Eye" size={12}/> Live preview</div>
        <div className="bg-[#f6f6f8] rounded-lg border border-border shadow-pop overflow-hidden">
          <div className="bg-white px-5 py-3 border-b border-[#e6e6ec] flex items-center gap-2">
            <div className="w-7 h-7 rounded grid place-content-center text-white text-[11px] font-bold"
                 style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>A</div>
            <div>
              <div className="text-[12.5px] font-semibold text-[#111]">Acme Store</div>
              <div className="text-[10.5px] text-[#666]">to sarah.johnson@email.com</div>
            </div>
          </div>
          <div className="px-5 py-4 bg-white">
            <div className="text-[14px] font-semibold text-[#111] mb-3">{fill(subject)}</div>
            <pre className="text-[12.5px] text-[#333] whitespace-pre-wrap font-sans leading-relaxed">{fill(body)}</pre>
            <div className="mt-4 pt-4 border-t border-[#e6e6ec]">
              <button className="w-full h-9 rounded text-[12.5px] font-semibold text-white"
                      style={{ background: '#6C63FF' }}>View return status</button>
            </div>
          </div>
          <div className="bg-[#f1f1f5] px-5 py-2.5 text-[10.5px] text-[#888] text-center">Sent by ReturnFlow · Acme Store</div>
        </div>
      </div>
    </div>
  );
}

// ---- Portal Access tab ----
function PortalAccessTab({ shop, appUrl }: { shop: string; appUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  const proxyUrl   = `https://${shop}/apps/returns`;
  const directUrl  = `${appUrl}/portal?shop=${shop}`;
  const iframeCode = `<iframe\n  src="${directUrl}"\n  width="100%"\n  height="700"\n  frameborder="0"\n  style="border:none;border-radius:12px;"\n></iframe>`;

  const EXTENSION_UID    = "e8b27fcc-79e9-97be-bb6e-f4b9ff6f32de1c30314c";
  const EXTENSION_HANDLE = "returnflow-return-button";
  const themeEditorUrl   = `https://${shop}/admin/themes/current/editor?addAppBlockId=${EXTENSION_UID}/${EXTENSION_HANDLE}&target=newAppsSection`;

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Intro hero ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-xl border border-divider bg-gradient-to-br from-accent/[0.04] via-bg/20 to-transparent p-6">
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg grid place-content-center shrink-0 bg-accent/15 text-accent2">
            <Icon name="Rocket" size={18} />
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-ink">Connect customers to your returns portal</div>
            <p className="text-[12.5px] text-muted mt-1 leading-relaxed max-w-2xl">
              Three ways to do it — pick one or combine them. The theme block is the fastest setup (under a minute);
              direct URLs work anywhere; embeds put the portal inside any web page.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <QuickJump label="Theme block" color="#22C55E" />
              <QuickJump label="Page URLs" color="#8B85FF" />
              <QuickJump label="Embed" color="#3B82F6" />
            </div>
          </div>
        </div>
      </div>

      {/* ── 1. Theme block ──────────────────────────────────────────────── */}
      <SectionShell number={1} colorRgb="34,197,94" iconName="Blocks" title="Add a Return button to your theme"
        subtitle="Drop the ReturnFlow theme block on any page — footer, FAQ, order status, anywhere — without touching code.">
        <Stepper
          color="#22C55E"
          steps={[
            { title: 'Click "Open Theme Editor"',       body: 'The Return Button block is pre-selected for you.' },
            { title: 'Pick a section',                  body: 'Add it to your Footer group, or any section where it makes sense.' },
            { title: 'Hit Save',                        body: 'Top-right corner of the theme editor. Live instantly.' },
          ]}
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a href={themeEditorUrl} target="_blank" rel="noreferrer"
             className="group inline-flex items-center gap-2 h-10 px-5 rounded-md text-[13px] font-semibold text-white transition shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_8px_22px_-6px_rgba(34,197,94,0.45)] hover:shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_12px_30px_-8px_rgba(34,197,94,0.6)] hover:-translate-y-px"
             style={{ background: 'linear-gradient(180deg, #2BCD66 0%, #22C55E 100%)' }}>
            <Icon name="ExternalLink" size={14} className="transition-transform group-hover:translate-x-[1px]" />
            Open Theme Editor
          </a>
          <span className="text-[11.5px] text-muted flex items-center gap-1.5">
            <Icon name="Clock3" size={12} /> Takes under 60 seconds
          </span>
        </div>
      </SectionShell>

      {/* ── 2. Page URLs ────────────────────────────────────────────────── */}
      <SectionShell number={2} colorRgb="108,99,255" iconName="Link2" title="Share a link"
        subtitle="Paste these URLs in your footer, return policy page, order confirmation emails, social bios, QR codes — anywhere.">
        <div className="grid gap-3">
          <UrlCard
            label="Shopify store URL"
            badge="Recommended"
            badgeTone="green"
            tagline="Branded — customers stay on your domain."
            url={proxyUrl}
            urlScheme="https://"
            copyKey="proxy"
            copied={copied}
            onCopy={copy}
          />
          <UrlCard
            label="Direct portal link"
            badge="Universal"
            badgeTone="purple"
            tagline="Works anywhere — email, QR code, ads, any platform."
            url={directUrl}
            urlScheme="https://"
            copyKey="direct"
            copied={copied}
            onCopy={copy}
          />
        </div>
      </SectionShell>

      {/* ── 3. Embed ────────────────────────────────────────────────────── */}
      <SectionShell number={3} colorRgb="59,130,246" iconName="Code2" title="Embed the portal in a page"
        subtitle="Slip the whole returns portal inside any web page — Shopify, Webflow, WordPress, Squarespace, even plain HTML.">
        <div className="space-y-3">
          <CodeCard
            tabLabel="Shopify page"
            tabColor="#22C55E"
            badge="App Proxy"
            badgeTone="green"
            description="Add this path as a link or button in a Shopify page. Shopify routes it through the app proxy automatically."
            code={'/apps/returns'}
            language="path"
            copyKey="shopify-path"
            copied={copied}
            onCopy={copy}
            theme="light"
          />
          <CodeCard
            tabLabel="Any other website"
            tabColor="#3B82F6"
            badge="iFrame"
            badgeTone="blue"
            description="Paste this HTML where you want the portal to appear. Works on Webflow, WordPress, Squarespace, Notion, and anything that accepts embed code."
            code={iframeCode}
            language="html"
            copyKey="iframe"
            copied={copied}
            onCopy={copy}
            theme="dark"
          />
        </div>
      </SectionShell>

      {/* ── Pro tip ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-xl border-l-2 border-accent border-y border-y-divider border-r border-r-divider bg-bg/30 p-4 pl-5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md grid place-content-center shrink-0 bg-accent/15 text-accent2">
          <Icon name="Lightbulb" size={15} />
        </div>
        <div className="text-[12.5px] text-muted leading-relaxed">
          <div className="font-semibold text-ink text-[13px] mb-0.5">Pro tip — start with the footer</div>
          The fastest, most visible spot is your footer: every page links to it. Use the <span className="font-mono text-ink bg-bg/60 px-1 py-0.5 rounded">/apps/returns</span> path
          (theme block or a plain link button) and you're done in 60 seconds. Customers can look up their order and submit a return request without an account.
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function QuickJump({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ background: `${color}1f`, color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function SectionShell({ number, colorRgb, iconName, title, subtitle, children }: {
  number: number; colorRgb: string; iconName: string; title: string; subtitle: string; children: ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* colored top bar */}
      <div className="h-1" style={{ background: `rgb(${colorRgb})` }} />
      <div className="p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="relative shrink-0">
            <div className="w-11 h-11 rounded-lg grid place-content-center"
                 style={{ background: `rgba(${colorRgb},0.12)`, color: `rgb(${colorRgb})` }}>
              <Icon name={iconName} size={18} />
            </div>
            <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full grid place-content-center text-[10.5px] font-bold text-white shadow-md"
                 style={{ background: `rgb(${colorRgb})` }}>
              {number}
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <div className="text-[15px] font-semibold text-ink">{title}</div>
            <div className="text-[12.5px] text-muted mt-1 leading-relaxed max-w-2xl">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ steps, color }: { color: string; steps: { title: string; body: string }[] }) {
  return (
    <ol className="relative space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <div className="relative flex flex-col items-center">
            <span className="w-6 h-6 rounded-full grid place-content-center text-[11px] font-bold shrink-0"
                  style={{ background: `${color}26`, color }}>
              {i + 1}
            </span>
            {i < steps.length - 1 && (
              <span className="flex-1 w-px mt-1" style={{ background: `${color}33` }} />
            )}
          </div>
          <div className="flex-1 pb-1">
            <div className="text-[13px] font-medium text-ink leading-snug">{s.title}</div>
            <div className="text-[12px] text-muted leading-relaxed mt-0.5">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const BADGE_TONES: Record<string, { bg: string; fg: string }> = {
  green:  { bg: 'rgba(34,197,94,0.15)',  fg: '#16A34A' },
  purple: { bg: 'rgba(108,99,255,0.15)', fg: '#7c70ff' },
  blue:   { bg: 'rgba(59,130,246,0.15)', fg: '#3B82F6' },
};

function UrlCard({ label, badge, badgeTone, tagline, url, urlScheme, copyKey, copied, onCopy }: {
  label: string; badge: string; badgeTone: keyof typeof BADGE_TONES; tagline: string;
  url: string; urlScheme: string;
  copyKey: string; copied: string | null; onCopy: (key: string, text: string) => void;
}) {
  const tone = BADGE_TONES[badgeTone];
  const urlWithoutScheme = url.startsWith(urlScheme) ? url.slice(urlScheme.length) : url;
  const isCopied = copied === copyKey;
  return (
    <div className="group rounded-lg border border-divider bg-bg/20 hover:bg-bg/40 hover:border-border transition p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded"
              style={{ background: tone.bg, color: tone.fg }}>
          {badgeTone === 'green' && <Icon name="Check" size={9} strokeWidth={3} />}
          {badge}
        </span>
      </div>
      <div className="text-[11.5px] text-muted leading-relaxed mb-2.5">{tagline}</div>

      <div className="flex items-stretch gap-2 flex-wrap">
        <div className="flex-1 min-w-0 flex items-center h-9 px-3 rounded-md bg-bg border border-border font-mono text-[12px] overflow-hidden">
          <span className="text-faint shrink-0">{urlScheme}</span>
          <span className="text-ink truncate">{urlWithoutScheme}</span>
        </div>
        <button
          onClick={() => onCopy(copyKey, url)}
          className={`h-9 px-3 rounded-md text-[12px] font-medium border transition flex items-center gap-1.5 shrink-0 ${
            isCopied
              ? 'border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]'
              : 'border-border bg-surface hover:bg-bg hover:border-[#3a3e58] text-ink'
          }`}>
          {isCopied
            ? <><Icon name="Check" size={13} strokeWidth={2.5} /> Copied</>
            : <><Icon name="Copy" size={13} /> Copy URL</>}
        </button>
        <a href={url} target="_blank" rel="noreferrer"
           className="h-9 px-3 rounded-md text-[12px] font-medium border border-border bg-surface hover:bg-bg hover:border-[#3a3e58] text-ink transition flex items-center gap-1.5 shrink-0">
          <Icon name="ExternalLink" size={13} /> Open
        </a>
      </div>
    </div>
  );
}

function CodeCard({ tabLabel, tabColor, badge, badgeTone, description, code, language, copyKey, copied, onCopy, theme }: {
  tabLabel: string; tabColor: string;
  badge: string; badgeTone: keyof typeof BADGE_TONES;
  description: string;
  code: string;
  language: 'path' | 'html';
  copyKey: string; copied: string | null; onCopy: (key: string, text: string) => void;
  theme: 'dark' | 'light';
}) {
  const tone = BADGE_TONES[badgeTone];
  const isCopied = copied === copyKey;
  const isDark = theme === 'dark';

  return (
    <div className="rounded-lg border border-divider bg-bg/20 overflow-hidden">
      {/* Tab header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider bg-bg/40">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tabColor }} />
          <span className="text-[12px] font-semibold text-ink">{tabLabel}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded"
                style={{ background: tone.bg, color: tone.fg }}>
            {badge}
          </span>
        </div>
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-faint">{language}</span>
      </div>

      {/* Description */}
      <p className="px-4 pt-3 pb-2 text-[12px] text-muted leading-relaxed">{description}</p>

      {/* Code + copy */}
      <div className="px-4 pb-4">
        <div className="relative">
          <pre className={`w-full p-3 pr-16 rounded-md font-mono text-[11.5px] leading-relaxed overflow-x-auto ${
            isDark ? 'bg-[#0f1117] text-[#e2e8f0]' : 'bg-bg border border-border text-ink'
          }`}>
            {code}
          </pre>
          <button
            onClick={() => onCopy(copyKey, code)}
            className={`absolute top-2 right-2 h-7 px-2.5 rounded text-[11px] font-medium transition flex items-center gap-1.5 ${
              isDark
                ? (isCopied
                    ? 'bg-[#22C55E]/20 text-[#22C55E]'
                    : 'bg-white/10 hover:bg-white/20 text-white')
                : (isCopied
                    ? 'bg-[#22C55E]/15 text-[#22C55E]'
                    : 'border border-border bg-surface hover:bg-bg text-ink')
            }`}>
            {isCopied
              ? <><Icon name="Check" size={12} strokeWidth={2.5} /> Copied</>
              : <><Icon name="Copy" size={12} /> Copy</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Policy tab ----
function PolicyTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_policy";
  const actionData = useActionData<typeof action>();

  const [policy, setPolicy] = useState(settings.returnPolicy);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_policy") {
      toast({ kind: 'success', title: 'Policy updated' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_policy");
    formData.append("returnPolicy", policy);
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return policy</div>
          <div className="text-[12.5px] text-muted mt-1">Shown on the customer portal and linked in confirmation emails.</div>
        </div>
        <div className="text-[11.5px] text-muted flex items-center gap-1.5">
          <Icon name="Eye" size={12} /> {policy.length} characters · {policy.split(/\s+/).filter(Boolean).length} words
        </div>
      </div>
      <Textarea value={policy} onChange={(e: any) => setPolicy(e.target.value)} rows={14} className="leading-relaxed" />
      <SaveBar onSave={handleSave} onDiscard={() => setPolicy(settings.returnPolicy)} isSaving={isSaving} />
    </div>
  );
}
