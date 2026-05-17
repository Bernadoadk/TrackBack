import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Toggle, Input, Textarea, Select, useToast } from "../components/ui";
import { DEFAULT_REASONS, EMAIL_TEMPLATES } from "../components/mock-data";
import { getShopPlan, planAtLeast } from "../lib/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  const [emailTemplates, plan] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { shop } }),
    getShopPlan(shop),
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
          <a href="/app/billing"
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#8B5CF6' }}>
            Upgrade <Icon name="ArrowRight" size={12} />
          </a>
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
      {/* Theme block setup — required for App Store compliance (5.1.3) */}
      <div className="bg-surface border border-border rounded-lg p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
            <Icon name="Blocks" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Add return button to your theme</div>
            <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed max-w-lg">
              Use the <strong className="text-ink">ReturnFlow — Return Button</strong> theme block to add a branded
              "Start a Return" button directly on any page in your Online Store (e.g. footer, order status page).
            </div>
          </div>
        </div>

        <ol className="space-y-2 mb-5 text-[12.5px] text-muted list-none">
          {[
            'Click "Open Theme Editor" below — the block will be pre-selected.',
            'In the editor, choose a section where you want the button to appear (e.g. Footer group).',
            'Click "Save" in the top-right corner of the theme editor.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full text-[11px] font-bold grid place-content-center shrink-0 mt-0.5"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <a href={themeEditorUrl} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-[13px] font-semibold border transition"
           style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E', borderColor: 'rgba(34,197,94,0.25)' }}>
          <Icon name="ExternalLink" size={14} />
          Open Theme Editor
        </a>
      </div>

      {/* Page URLs section */}
      <div className="bg-surface border border-border rounded-lg p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(108,99,255,0.15)', color: '#8B85FF' }}>
            <Icon name="Link2" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Page URLs</div>
            <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed max-w-lg">
              Add a link to your returns page in your store footer, returns policy page, or order confirmation emails using these URLs.
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <UrlRow
            label="Shopify store (via app proxy)"
            badge="Recommended"
            description="Customers access the portal through your Shopify store URL — fully branded."
            url={proxyUrl}
            copyKey="proxy"
            copied={copied}
            onCopy={copy}
          />
          <UrlRow
            label="Direct portal link"
            badge="Universal"
            description="Works on any website, email, or QR code — hosted on our servers."
            url={directUrl}
            copyKey="direct"
            copied={copied}
            onCopy={copy}
          />
        </div>
      </div>

      {/* Embedded returns page section */}
      <div className="bg-surface border border-border rounded-lg p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}>
            <Icon name="Code2" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Embedded returns page</div>
            <div className="text-[12.5px] text-muted mt-0.5 leading-relaxed max-w-lg">
              Embed the returns portal directly inside a page on your website for a seamless branded experience.
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Shopify - app proxy */}
          <div className="rounded-lg border border-divider bg-bg/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">For Shopify</span>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}>App Proxy</span>
            </div>
            <p className="text-[12.5px] text-muted mb-3 leading-relaxed">
              Add this path as a link or button in a Shopify page. Shopify routes it through the app proxy automatically.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center h-9 px-3 rounded-md bg-bg border border-border font-mono text-[12px] text-ink overflow-x-auto">
                /apps/returns
              </div>
              <button
                onClick={() => copy('shopify-path', '/apps/returns')}
                className="h-9 px-3 rounded-md text-[12px] font-medium border border-border bg-surface hover:bg-bg transition flex items-center gap-1.5 shrink-0"
              >
                {copied === 'shopify-path' ? <><Icon name="Check" size={13} className="text-[#22c55e]" /> Copied</> : <><Icon name="Copy" size={13} /> Copy</>}
              </button>
            </div>
          </div>

          {/* Other platforms - iframe */}
          <div className="rounded-lg border border-divider bg-bg/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">For other platforms</span>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ background: 'rgba(108,99,255,0.15)', color: '#6C63FF' }}>iFrame</span>
            </div>
            <p className="text-[12.5px] text-muted mb-3 leading-relaxed">
              Paste this code into any HTML page to embed the returns portal. Works on Webflow, WordPress, Squarespace, and more.
            </p>
            <div className="relative">
              <pre className="w-full p-3 rounded-md bg-[#0f1117] text-[#e2e8f0] font-mono text-[11.5px] leading-relaxed overflow-x-auto">
                {iframeCode}
              </pre>
              <button
                onClick={() => copy('iframe', iframeCode)}
                className="absolute top-2 right-2 h-7 px-2.5 rounded text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5"
              >
                {copied === 'iframe' ? <><Icon name="Check" size={12} /> Copied</> : <><Icon name="Copy" size={12} /> Copy</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* How to add tip */}
      <div className="rounded-lg border border-divider bg-bg/30 p-4 flex items-start gap-3">
        <Icon name="Lightbulb" size={15} className="text-accent mt-0.5 shrink-0" />
        <div className="text-[12.5px] text-muted leading-relaxed">
          <span className="font-semibold text-ink">Tip: </span>
          The easiest way is to add a "Start a Return" button in your Shopify store's footer or on your order confirmation page pointing to <span className="font-mono text-ink">/apps/returns</span>.
          Customers can then look up their order and submit a return request without logging in.
        </div>
      </div>
    </div>
  );
}

function UrlRow({ label, badge, description, url, copyKey, copied, onCopy }: {
  label: string; badge: string; description: string; url: string;
  copyKey: string; copied: string | null; onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border border-divider bg-bg/20 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-ink">{label}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ background: 'rgba(108,99,255,0.12)', color: '#6C63FF' }}>{badge}</span>
        </div>
        <div className="text-[11.5px] text-muted">{description}</div>
        <div className="mt-1.5 font-mono text-[12px] text-ink truncate">{url}</div>
      </div>
      <button
        onClick={() => onCopy(copyKey, url)}
        className="h-8 px-3 rounded-md text-[12px] font-medium border border-border bg-surface hover:bg-bg transition flex items-center gap-1.5 shrink-0"
      >
        {copied === copyKey
          ? <><Icon name="Check" size={13} className="text-[#22c55e]" /> Copied</>
          : <><Icon name="Copy" size={13} /> Copy URL</>}
      </button>
      <a href={url} target="_blank" rel="noreferrer"
         className="h-8 px-3 rounded-md text-[12px] font-medium border border-border bg-surface hover:bg-bg transition flex items-center gap-1.5 shrink-0">
        <Icon name="ExternalLink" size={13} /> Open
      </a>
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
