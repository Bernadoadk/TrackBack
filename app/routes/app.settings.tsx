import { useState, useEffect, type ReactNode } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData, useLocation, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Toggle, Input, Textarea, Select, useToast, TierBadge, UpgradeNotice } from "../components/ui";
import { DEFAULT_REASONS } from "../components/mock-data";
import { ensureBillingSynced, getShopPlan } from "../lib/plan.server";
import { hasFeature, requiredTier, type Feature } from "../lib/plans";
import { LOCALE_LABELS, PAYOUT_METHODS, SUPPORTED_LOCALES, parseLocales } from "../lib/i18n";
import { RETURN_METHOD_KEYS, getReturnMethods, parseList } from "../lib/returns-logic";
import { randomSecret, sha256 } from "../lib/tokens.server";
import { signWebhookBody } from "../lib/webhooks-out.server";

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const appUrl = (process.env.SHOPIFY_APP_URL || new URL(request.url).origin).replace(/\/$/, "");

  let settings = await prisma.shopSettings.findUnique({ where: { shop }, include: { reasons: true } });
  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: { shop, reasons: { create: DEFAULT_REASONS.map(r => ({ label: r.label, enabled: r.enabled })) } },
      include: { reasons: true },
    });
  }
  const plan = await ensureBillingSynced(admin, shop);
  const features = Object.fromEntries(
    (["storeCredit", "variantExchange", "shopNow", "customReasons", "returnFees", "photos", "greenReturns", "orderTags",
      "weeklyReport", "whatsapp", "automations", "fraud", "webhooks", "api"] as Feature[]).map((f) => [f, hasFeature(plan, f)]),
  ) as Record<string, boolean>;

  // Never ship secrets to the browser.
  const { whatsappAccessToken, apiKeyHash, ...safe } = settings;
  return {
    settings: {
      ...safe,
      hasWhatsappToken: !!whatsappAccessToken,
      hasApiKey: !!apiKeyHash,
      returnMethodsList: getReturnMethods(settings),
    },
    shop,
    appUrl,
    plan,
    features,
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
  };
};

// ─── Action ─────────────────────────────────────────────────────────────────

const bool = (v: unknown) => v === true || v === "true";
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const cleanList = (v: unknown, max = 2000) =>
  parseList(str(v, max)).map((x) => x.slice(0, 120)).join(", ");

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getShopPlan(shop);
  const can = (f: Feature) => hasFeature(plan, f);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  let d: any = {};
  try {
    d = JSON.parse(String(formData.get("data") ?? "{}"));
  } catch {
    return { ok: false, intent, error: "Invalid data" };
  }
  const current = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!current) return { ok: false, intent, error: "Settings not found" };

  switch (intent) {
    case "save_general": {
      const locales = parseLocales(Array.isArray(d.portalLocales) ? d.portalLocales.join(",") : d.portalLocales);
      const defaultLocale = locales.includes(d.defaultLocale) ? d.defaultLocale : locales[0];
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          returnWindow: int(d.returnWindow, 1, 365, current.returnWindow),
          returnWindowBasis: d.returnWindowBasis === "order" ? "order" : "fulfillment",
          returnAddress: str(d.returnAddress, 1000),
          fromEmail: str(d.fromEmail, 254).trim(),
          notifyMerchant: bool(d.notifyMerchant),
          autoApprove: bool(d.autoApprove),
          autoExpireDays: int(d.autoExpireDays, 1, 90, 7),
          portalLocales: locales.join(","),
          defaultLocale,
          portalDisplayMode: d.portalDisplayMode === "standalone" ? "standalone" : "embedded",
          ...(can("automations")
            ? {
                autoApproveMaxAmount: num(d.autoApproveMaxAmount, 0, 1e9, 0),
                autoApproveSkipRisky: bool(d.autoApproveSkipRisky),
                autoRefundOnReceive: bool(d.autoRefundOnReceive),
                autoRefundOriginal: bool(d.autoRefundOriginal),
              }
            : {}),
        },
      });
      break;
    }
    case "save_eligibility": {
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          blockedSkus: cleanList(d.blockedSkus),
          blockedTags: cleanList(d.blockedTags),
          blockedProductTypes: cleanList(d.blockedProductTypes),
          blockDiscountedItems: bool(d.blockDiscountedItems),
          oneReturnPerOrder: bool(d.oneReturnPerOrder),
          ...(can("fraud")
            ? { blockedEmails: cleanList(d.blockedEmails, 5000), riskReturnThreshold: int(d.riskReturnThreshold, 1, 50, 3) }
            : {}),
        },
      });
      break;
    }
    case "save_methods": {
      const methods = (Array.isArray(d.returnMethods) ? d.returnMethods : [])
        .filter((m: string) => (RETURN_METHOD_KEYS as readonly string[]).includes(m));
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          returnMethods: (methods.length ? methods : ["ship"]).join(","),
          returnShippingMethod: methods.includes("label") && !methods.includes("ship") ? "merchant_provides_label" : "customer_pays",
          storeDropoffInfo: str(d.storeDropoffInfo, 1000),
          pickupInfo: str(d.pickupInfo, 1000),
          ...(can("returnFees")
            ? {
                returnShippingFee: num(d.returnShippingFee, 0, 1e6, 0),
                restockingFeePercent: num(d.restockingFeePercent, 0, 100, 0),
                feeWaivedForStoreCredit: bool(d.feeWaivedForStoreCredit),
                feeWaivedForExchange: bool(d.feeWaivedForExchange),
                feeExemptReasons: cleanList(d.feeExemptReasons),
              }
            : {}),
        },
      });
      break;
    }
    case "save_refunds": {
      const allowedPayouts = new Set<string>(PAYOUT_METHODS.map((p) => p.key));
      const payouts = (Array.isArray(d.payoutMethods) ? d.payoutMethods : []).filter((k: string) => allowedPayouts.has(k));
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          allowStoreCredit: can("storeCredit") ? bool(d.allowStoreCredit) : false,
          storeCreditBonusPercent: int(d.storeCreditBonusPercent, 0, 50, 0),
          incentivizeStoreCredit: bool(d.incentivizeStoreCredit),
          storeCreditMethod: ["auto", "store_credit", "gift_card"].includes(d.storeCreditMethod) ? d.storeCreditMethod : "auto",
          allowExchanges: can("variantExchange") ? bool(d.allowExchanges) : false,
          allowShopNow: can("shopNow") ? bool(d.allowShopNow) : false,
          greenReturnsEnabled: can("greenReturns") ? bool(d.greenReturnsEnabled) : false,
          greenReturnMaxAmount: num(d.greenReturnMaxAmount, 0, 1e7, 0),
          photosEnabled: can("photos") ? bool(d.photosEnabled) : false,
          codRefundsEnabled: bool(d.codRefundsEnabled),
          payoutMethods: (payouts.length ? payouts : ["bank_transfer", "cash"]).join(","),
        },
      });
      break;
    }
    case "save_reasons": {
      if (!can("customReasons")) return { ok: false, intent, error: "Custom reasons require the Starter plan." };
      const reasons = (Array.isArray(d.reasons) ? d.reasons : [])
        .map((r: any) => ({ label: str(r.label, 120).trim(), enabled: bool(r.enabled), requirePhoto: can("photos") && bool(r.requirePhoto) }))
        .filter((r: any) => r.label)
        .slice(0, 40);
      await prisma.$transaction([
        prisma.returnReason.deleteMany({ where: { shop } }),
        prisma.returnReason.createMany({ data: reasons.map((r: any) => ({ shop, ...r })) }),
      ]);
      break;
    }
    case "save_policy": {
      await prisma.shopSettings.update({
        where: { shop },
        data: { returnPolicy: str(d.returnPolicy, 20000), euWithdrawalEnabled: bool(d.euWithdrawalEnabled) },
      });
      break;
    }
    case "save_notifications": {
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          weeklyReportEnabled: bool(d.weeklyReportEnabled),
          orderTagsEnabled: bool(d.orderTagsEnabled),
          ...(can("whatsapp")
            ? {
                whatsappNumber: str(d.whatsappNumber, 30).replace(/[^\d+]/g, ""),
                whatsappNotifyEnabled: bool(d.whatsappNotifyEnabled),
                whatsappPhoneNumberId: str(d.whatsappPhoneNumberId, 40).trim(),
                whatsappTemplateName: str(d.whatsappTemplateName, 80).trim(),
                whatsappTemplateLang: str(d.whatsappTemplateLang, 10).trim() || "en",
                ...(d.whatsappAccessToken ? { whatsappAccessToken: str(d.whatsappAccessToken, 1000).trim() } : {}),
              }
            : {}),
        },
      });
      break;
    }
    case "save_webhook": {
      if (!can("webhooks")) return { ok: false, intent, error: "Webhooks require the Pro plan." };
      const url = str(d.webhookUrl, 500).trim();
      if (url && !/^https:\/\//i.test(url)) return { ok: false, intent, error: "The webhook URL must start with https://" };
      await prisma.shopSettings.update({
        where: { shop },
        data: { webhookUrl: url, ...(current.webhookSecret ? {} : { webhookSecret: `whsec_${randomSecret(24)}` }) },
      });
      break;
    }
    case "rotate_webhook_secret": {
      if (!can("webhooks")) return { ok: false, intent, error: "Webhooks require the Pro plan." };
      await prisma.shopSettings.update({ where: { shop }, data: { webhookSecret: `whsec_${randomSecret(24)}` } });
      break;
    }
    case "test_webhook": {
      if (!can("webhooks") || !current.webhookUrl) return { ok: false, intent, error: "Save a webhook URL first." };
      const body = JSON.stringify({ id: `test_${Date.now()}`, event: "test.ping", shop, occurred_at: new Date().toISOString(), data: {} });
      try {
        const res = await fetch(current.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-TrackBack-Event": "test.ping",
            "X-TrackBack-Signature": `sha256=${signWebhookBody(current.webhookSecret, body)}`,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        await prisma.shopSettings.update({ where: { shop }, data: { webhookLastStatus: `test.ping → ${res.status}`, webhookLastAt: new Date() } });
        return { ok: res.ok, intent, error: res.ok ? undefined : `Endpoint answered HTTP ${res.status}` };
      } catch (e: any) {
        return { ok: false, intent, error: `Delivery failed: ${e?.message ?? "network error"}` };
      }
    }
    case "generate_api_key": {
      if (!can("api")) return { ok: false, intent, error: "The API requires the Pro plan." };
      const key = `tb_live_${randomSecret(24)}`;
      await prisma.shopSettings.update({ where: { shop }, data: { apiKeyHash: sha256(key), apiKeyPrefix: key.slice(0, 12) } });
      return { ok: true, intent, apiKey: key };
    }
    case "revoke_api_key": {
      await prisma.shopSettings.update({ where: { shop }, data: { apiKeyHash: "", apiKeyPrefix: "" } });
      break;
    }
    default:
      return { ok: false, intent, error: "Unknown action" };
  }
  return { ok: true, intent };
};

// ─── Page ───────────────────────────────────────────────────────────────────

const TABS = [
  { key: "General", icon: "Settings2" },
  { key: "Eligibility", icon: "ShieldCheck" },
  { key: "Returns & fees", icon: "Truck" },
  { key: "Refunds", icon: "Wallet" },
  { key: "Reasons", icon: "Tag" },
  { key: "Policy", icon: "FileText" },
  { key: "Notifications", icon: "Bell" },
  { key: "Integrations", icon: "Webhook" },
  { key: "Portal", icon: "Globe" },
] as const;

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const initialTab = (() => {
    if (typeof window === "undefined") return "General";
    const t = new URL(window.location.href).searchParams.get("tab");
    return TABS.some((x) => x.key === t) ? (t as string) : "General";
  })();
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t);
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure how returns work for your store." />
      <div className="flex items-center gap-1 border-b border-divider mb-6 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
              <Icon name={t.icon} size={13.5} />
              {t.key}
              {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {tab === "General" && <GeneralTab data={data} />}
      {tab === "Eligibility" && <EligibilityTab data={data} />}
      {tab === "Returns & fees" && <MethodsTab data={data} />}
      {tab === "Refunds" && <RefundsTab data={data} />}
      {tab === "Reasons" && <ReasonsTab data={data} />}
      {tab === "Policy" && <PolicyTab data={data} />}
      {tab === "Notifications" && <NotificationsTab data={data} />}
      {tab === "Integrations" && <IntegrationsTab data={data} />}
      {tab === "Portal" && <PortalAccessTab shop={data.shop} appUrl={data.appUrl} apiKey={data.apiKey} withdrawal={data.settings.euWithdrawalEnabled} />}
    </div>
  );
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function useSettingsForm<T extends Record<string, any>>(intent: string, initial: T) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>() as any;
  const toast = useToast();
  const [values, setValues] = useState<T>(initial);
  const set = <K extends keyof T>(k: K, v: T[K]) => setValues((p) => ({ ...p, [k]: v }));
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending || navigation.state !== "idle" || !actionData || actionData.intent !== intent) return;
    setPending(false);
    if (actionData.ok) toast({ kind: "success", title: "Settings saved" });
    else toast({ kind: "error", title: "Couldn't save", body: actionData.error });
  }, [actionData, navigation.state, pending, intent, toast]);
  const save = () => {
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("data", JSON.stringify(values));
    setPending(true);
    submit(fd, { method: "POST" });
  };
  return { values, set, save, reset: () => setValues(initial), isSaving };
}

function SettingRow({ label, hint, children, tier, allowed = true }: { label: ReactNode; hint?: ReactNode; children: ReactNode; tier?: "starter" | "pro"; allowed?: boolean }) {
  return (
    <div className="py-5 border-b border-divider last:border-0 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 md:gap-8">
      <div className="pt-1">
        <div className="text-[13.5px] font-semibold text-ink flex items-center gap-2">{label}{tier && <TierBadge tier={tier} />}</div>
        {hint && <div className="text-[12px] text-muted mt-1 leading-relaxed max-w-[260px]">{hint}</div>}
      </div>
      <div className="max-w-xl">
        <div className={allowed ? "" : "opacity-50 pointer-events-none select-none"}>{children}</div>
        {!allowed && tier && <div className="mt-2"><UpgradeNotice tier={tier} /></div>}
      </div>
    </div>
  );
}

function SaveBar({ onSave, onDiscard, isSaving, disabled }: any) {
  return (
    <div className="py-5 flex items-center justify-end gap-2">
      <Btn variant="ghost" onClick={onDiscard} disabled={isSaving || disabled}>Discard</Btn>
      <Btn variant="primary" icon="Check" onClick={onSave} disabled={isSaving || disabled} loading={isSaving}>
        {isSaving ? "Saving…" : "Save changes"}
      </Btn>
    </div>
  );
}

function NumberField({ value, onChange, suffix, min = 0, max, step = 1, width = "w-24" }: any) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className={`${width} h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums`} />
      {suffix && <span className="text-[13px] text-muted">{suffix}</span>}
    </div>
  );
}

function ChoiceCards({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; title: string; desc: string; icon: string; color: string }[] }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const sel = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={`w-full text-left p-3 rounded-md border-2 transition flex items-start gap-3 ${sel ? "border-accent bg-accent/[0.06]" : "border-divider hover:border-[#3a3e58]"}`}>
            <div className="w-8 h-8 rounded-md grid place-content-center shrink-0" style={{ background: `${opt.color}1f`, color: opt.color }}>
              <Icon name={opt.icon} size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink">{opt.title}</div>
              <div className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{opt.desc}</div>
            </div>
            {sel && <Icon name="Check" size={15} className="text-accent2 shrink-0 mt-1" strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}

function CheckList({ values, onChange, options }: { values: string[]; onChange: (v: string[]) => void; options: { value: string; label: string; hint?: string }[] }) {
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {options.map((o) => (
        <label key={o.value} className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition ${values.includes(o.value) ? "border-accent/60 bg-accent/[0.06]" : "border-divider hover:border-[#3a3e58]"}`}>
          <input type="checkbox" className="rf-check mt-0.5" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
          <span>
            <span className="block text-[13px] text-ink">{o.label}</span>
            {o.hint && <span className="block text-[11.5px] text-muted mt-0.5">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="bg-surface border border-border rounded-lg px-6">{children}</div>;
}

// ─── General ────────────────────────────────────────────────────────────────

function GeneralTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const f = useSettingsForm("save_general", {
    returnWindow: s.returnWindow,
    returnWindowBasis: s.returnWindowBasis,
    returnAddress: s.returnAddress,
    fromEmail: s.fromEmail,
    notifyMerchant: s.notifyMerchant,
    autoApprove: s.autoApprove,
    autoExpireDays: s.autoExpireDays,
    portalLocales: parseLocales(s.portalLocales) as string[],
    defaultLocale: s.defaultLocale,
    portalDisplayMode: s.portalDisplayMode,
    autoApproveMaxAmount: s.autoApproveMaxAmount,
    autoApproveSkipRisky: s.autoApproveSkipRisky,
    autoRefundOnReceive: s.autoRefundOnReceive,
    autoRefundOriginal: s.autoRefundOriginal,
  });
  const v = f.values;
  const pro = data.features.automations;
  return (
    <Panel>
      <SettingRow label="Return window" hint="How long customers have to request a return.">
        <div className="flex items-center gap-3 flex-wrap">
          <NumberField value={v.returnWindow} onChange={(n: number) => f.set("returnWindow", n)} min={1} max={365} suffix="days after" />
          <Select value={v.returnWindowBasis} onChange={(x: string) => f.set("returnWindowBasis", x)} className="w-[190px]"
            options={[{ value: "fulfillment", label: "fulfillment / delivery" }, { value: "order", label: "order date" }]} />
        </div>
      </SettingRow>
      <SettingRow label="Return address" hint="Sent to the customer in the approval email and shown on their return page.">
        <Textarea value={v.returnAddress} onChange={(e: any) => f.set("returnAddress", e.target.value)} rows={4} />
      </SettingRow>
      <SettingRow label="Reply-to email" hint="Customer replies to TrackBack emails reach this address.">
        <Input value={v.fromEmail} onChange={(e: any) => f.set("fromEmail", e.target.value)} type="email" />
        <div className="mt-3">
          <Toggle checked={v.notifyMerchant} onChange={(x: boolean) => f.set("notifyMerchant", x)} label="Email me when a new request comes in" />
        </div>
      </SettingRow>
      <SettingRow label="Portal languages" hint="The portal opens in the customer's store language when enabled; emails follow the language of the request.">
        <CheckList values={v.portalLocales} onChange={(x) => f.set("portalLocales", x.length ? x : ["en"])}
          options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} />
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          Default language
          <Select value={v.defaultLocale} onChange={(x: string) => f.set("defaultLocale", x)} className="w-[150px]"
            options={v.portalLocales.map((l: string) => ({ value: l, label: LOCALE_LABELS[l as "en" | "fr"] }))} />
        </div>
      </SettingRow>
      <SettingRow label="Portal display" hint="How /apps/returns opens on your store.">
        <ChoiceCards value={v.portalDisplayMode} onChange={(x) => f.set("portalDisplayMode", x)} options={[
          { value: "embedded", title: "Inside my store theme", desc: "Customers stay on your domain with your header and footer. Recommended.", icon: "LayoutTemplate", color: "#22C55E" },
          { value: "standalone", title: "Full-page portal", desc: "Opens the TrackBack page with your branding (use if your theme conflicts).", icon: "Maximize2", color: "#3B82F6" },
        ]} />
      </SettingRow>
      <SettingRow label="Auto-approve returns" hint="Eligible requests are approved and the customer gets the return instructions immediately.">
        <Toggle checked={v.autoApprove} onChange={(x: boolean) => f.set("autoApprove", x)}
          label={v.autoApprove ? "Returns are auto-approved" : "Manual review required"} />
        <div className={`mt-3 space-y-3 p-3 rounded-md border border-divider bg-bg/30 ${!v.autoApprove ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between gap-2"><span className="text-[12.5px] font-semibold text-ink">Conditions</span><TierBadge tier="pro" /></div>
          <div className={pro ? "space-y-3" : "space-y-3 opacity-50 pointer-events-none"}>
            <div className="flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
              Only when the return value is below
              <NumberField value={v.autoApproveMaxAmount} onChange={(n: number) => f.set("autoApproveMaxAmount", n)} min={0} step={1} width="w-28" suffix="(0 = no limit)" />
            </div>
            <Toggle checked={v.autoApproveSkipRisky} onChange={(x: boolean) => f.set("autoApproveSkipRisky", x)} label="Never auto-approve high-risk customers" />
          </div>
          {!pro && <UpgradeNotice tier="pro" />}
        </div>
      </SettingRow>
      <SettingRow label="Auto-refund" hint="Refund automatically as soon as you mark the items as received." tier="pro" allowed={pro}>
        <Toggle checked={v.autoRefundOnReceive} onChange={(x: boolean) => f.set("autoRefundOnReceive", x)} label="Store credit & exchanges: issue on receipt" />
        <div className="mt-2">
          <Toggle checked={v.autoRefundOriginal} onChange={(x: boolean) => f.set("autoRefundOriginal", x)} label="Also refund card payments automatically" description="Cash-on-delivery refunds always stay manual." />
        </div>
      </SettingRow>
      <SettingRow label="Auto-expire approved returns" hint="Approved returns that aren't shipped in time expire and the customer is notified.">
        <NumberField value={v.autoExpireDays} onChange={(n: number) => f.set("autoExpireDays", n)} min={1} max={90} suffix="days after approval" />
      </SettingRow>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </Panel>
  );
}

// ─── Eligibility ────────────────────────────────────────────────────────────

function EligibilityTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const f = useSettingsForm("save_eligibility", {
    blockedSkus: s.blockedSkus,
    blockedTags: s.blockedTags,
    blockedProductTypes: s.blockedProductTypes,
    blockDiscountedItems: s.blockDiscountedItems,
    oneReturnPerOrder: s.oneReturnPerOrder,
    blockedEmails: s.blockedEmails,
    riskReturnThreshold: s.riskReturnThreshold,
  });
  const v = f.values;
  return (
    <Panel>
      <SettingRow label="Final-sale products" hint="Items matching any of these rules are shown as “Final sale — not returnable” in the portal.">
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">Product tags</label>
            <Input value={v.blockedTags} onChange={(e: any) => f.set("blockedTags", e.target.value)} placeholder="final-sale, clearance" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">Product types</label>
            <Input value={v.blockedProductTypes} onChange={(e: any) => f.set("blockedProductTypes", e.target.value)} placeholder="Underwear, Gift card" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">SKUs or product IDs</label>
            <Textarea value={v.blockedSkus} onChange={(e: any) => f.set("blockedSkus", e.target.value)} rows={3} placeholder="SKU-001, 1234567890" />
          </div>
        </div>
      </SettingRow>
      <SettingRow label="Rules">
        <div className="space-y-3">
          <Toggle checked={v.blockDiscountedItems} onChange={(x: boolean) => f.set("blockDiscountedItems", x)} label="Don't accept discounted items" description="Items sold below their original price can't be returned." />
          <Toggle checked={v.oneReturnPerOrder} onChange={(x: boolean) => f.set("oneReturnPerOrder", x)} label="One return request per order" description="Customers can't open a second request for the same order." />
        </div>
      </SettingRow>
      <SettingRow label="Fraud protection" hint="Flag customers who return often and block known abusers." tier="pro" allowed={data.features.fraud}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
            Flag a customer after
            <NumberField value={v.riskReturnThreshold} onChange={(n: number) => f.set("riskReturnThreshold", n)} min={1} max={50} width="w-20" suffix="returns in 90 days" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">Blocked customers (emails or @domains)</label>
            <Textarea value={v.blockedEmails} onChange={(e: any) => f.set("blockedEmails", e.target.value)} rows={3} placeholder="abuser@mail.com, @spam-domain.com" />
          </div>
        </div>
      </SettingRow>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </Panel>
  );
}

// ─── Return methods & fees ──────────────────────────────────────────────────

const METHOD_OPTIONS = [
  { value: "ship", label: "Customer ships the parcel", hint: "They send it with any carrier and add the tracking number." },
  { value: "label", label: "Prepaid label", hint: "You attach a label link when approving." },
  { value: "store", label: "Drop-off in store", hint: "Customers bring the items to your shop." },
  { value: "pickup", label: "Home pickup by your courier", hint: "Your delivery person collects the parcel." },
];

function MethodsTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const f = useSettingsForm("save_methods", {
    returnMethods: s.returnMethodsList as string[],
    storeDropoffInfo: s.storeDropoffInfo,
    pickupInfo: s.pickupInfo,
    returnShippingFee: s.returnShippingFee,
    restockingFeePercent: s.restockingFeePercent,
    feeWaivedForStoreCredit: s.feeWaivedForStoreCredit,
    feeWaivedForExchange: s.feeWaivedForExchange,
    feeExemptReasons: s.feeExemptReasons,
  });
  const v = f.values;
  return (
    <Panel>
      <SettingRow label="Return methods" hint="Customers choose among the enabled methods in the portal.">
        <CheckList values={v.returnMethods} onChange={(x) => f.set("returnMethods", x.length ? x : ["ship"])} options={METHOD_OPTIONS} />
      </SettingRow>
      {v.returnMethods.includes("store") && (
        <SettingRow label="Store drop-off details" hint="Address and opening hours shown to the customer.">
          <Textarea value={v.storeDropoffInfo} onChange={(e: any) => f.set("storeDropoffInfo", e.target.value)} rows={3} placeholder="Boutique Plateau — Rue 10, Dakar · Mon–Sat 9am–7pm" />
        </SettingRow>
      )}
      {v.returnMethods.includes("pickup") && (
        <SettingRow label="Pickup details" hint="What the customer should expect.">
          <Textarea value={v.pickupInfo} onChange={(e: any) => f.set("pickupInfo", e.target.value)} rows={3} placeholder="Our courier calls you within 48h to schedule the pickup." />
        </SettingRow>
      )}
      <SettingRow label="Return fees" hint="Deducted from the refund. Shown to the customer before they submit." tier="starter" allowed={data.features.returnFees}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
            Restocking fee
            <NumberField value={v.restockingFeePercent} onChange={(n: number) => f.set("restockingFeePercent", n)} min={0} max={100} width="w-20" suffix="% of the items" />
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
            Return shipping fee (label & pickup)
            <NumberField value={v.returnShippingFee} onChange={(n: number) => f.set("returnShippingFee", n)} min={0} step={0.5} width="w-28" />
          </div>
          <Toggle checked={v.feeWaivedForStoreCredit} onChange={(x: boolean) => f.set("feeWaivedForStoreCredit", x)} label="Waive fees for store credit" />
          <Toggle checked={v.feeWaivedForExchange} onChange={(x: boolean) => f.set("feeWaivedForExchange", x)} label="Waive fees for exchanges" />
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">No fees for these reasons</label>
            <Input value={v.feeExemptReasons} onChange={(e: any) => f.set("feeExemptReasons", e.target.value)} placeholder="Defective, Wrong item received" />
          </div>
        </div>
      </SettingRow>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </Panel>
  );
}

// ─── Refunds & exchanges ────────────────────────────────────────────────────

function RefundsTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const f = useSettingsForm("save_refunds", {
    allowStoreCredit: s.allowStoreCredit,
    storeCreditBonusPercent: s.storeCreditBonusPercent,
    incentivizeStoreCredit: s.incentivizeStoreCredit,
    storeCreditMethod: s.storeCreditMethod,
    allowExchanges: s.allowExchanges,
    allowShopNow: s.allowShopNow,
    greenReturnsEnabled: s.greenReturnsEnabled,
    greenReturnMaxAmount: s.greenReturnMaxAmount,
    photosEnabled: s.photosEnabled,
    codRefundsEnabled: s.codRefundsEnabled,
    payoutMethods: parseList(s.payoutMethods),
  });
  const v = f.values;
  const ft = data.features;
  return (
    <Panel>
      <SettingRow label="Store credit" hint="Keeps the money in your store. Customers can get a bonus for choosing it." tier="starter" allowed={ft.storeCredit}>
        <Toggle checked={v.allowStoreCredit} onChange={(x: boolean) => f.set("allowStoreCredit", x)} label="Offer store credit in the portal" />
        {v.allowStoreCredit && (
          <div className="mt-3 space-y-3 pl-12">
            <div className="flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
              Bonus
              <NumberField value={v.storeCreditBonusPercent} onChange={(n: number) => f.set("storeCreditBonusPercent", n)} min={0} max={50} width="w-20" suffix="%" />
            </div>
            <Toggle checked={v.incentivizeStoreCredit} onChange={(x: boolean) => f.set("incentivizeStoreCredit", x)} label="Highlight the bonus in the portal" />
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Issue as</label>
              <Select value={v.storeCreditMethod} onChange={(x: string) => f.set("storeCreditMethod", x)} className="w-[320px]" options={[
                { value: "auto", label: "Store credit, or gift card for guest orders" },
                { value: "store_credit", label: "Shopify store credit only" },
                { value: "gift_card", label: "Gift card code (works without an account)" },
              ]} />
            </div>
          </div>
        )}
      </SettingRow>
      <SettingRow label="Exchanges" hint="Customers pick the replacement size/color themselves; stock is checked live." tier="starter" allowed={ft.variantExchange}>
        <Toggle checked={v.allowExchanges} onChange={(x: boolean) => f.set("allowExchanges", x)} label="Offer variant exchanges" />
        <div className={`mt-3 ${ft.shopNow ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-2">
            <Toggle checked={v.allowShopNow} onChange={(x: boolean) => ft.shopNow && f.set("allowShopNow", x)} label="Shop Now: exchange for any product" />
            <TierBadge tier="pro" />
          </div>
        </div>
      </SettingRow>
      <SettingRow label="Green returns" hint="Refund low-value items without asking for them back — cheaper than paying for shipping." tier="starter" allowed={ft.greenReturns}>
        <Toggle checked={v.greenReturnsEnabled} onChange={(x: boolean) => f.set("greenReturnsEnabled", x)} label="Let customers keep low-value items" />
        {v.greenReturnsEnabled && (
          <div className="mt-3 pl-12 flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
            When the return value is at most
            <NumberField value={v.greenReturnMaxAmount} onChange={(n: number) => f.set("greenReturnMaxAmount", n)} min={0} step={1} width="w-28" />
          </div>
        )}
      </SettingRow>
      <SettingRow label="Photo evidence" hint="Customers can attach up to 3 photos per item. Make them mandatory per reason in the Reasons tab." tier="starter" allowed={ft.photos}>
        <Toggle checked={v.photosEnabled} onChange={(x: boolean) => f.set("photosEnabled", x)} label="Allow photos on every return" />
      </SettingRow>
      <SettingRow label="Cash-on-delivery refunds" hint="For orders paid on delivery, customers tell you where to send the refund. You pay them, then record the payout in TrackBack.">
        <Toggle checked={v.codRefundsEnabled} onChange={(x: boolean) => f.set("codRefundsEnabled", x)} label="Collect mobile money / bank details in the portal" />
        {v.codRefundsEnabled && (
          <div className="mt-3">
            <CheckList values={v.payoutMethods} onChange={(x) => f.set("payoutMethods", x)} options={PAYOUT_METHODS.map((p) => ({ value: p.key, label: p.label.en }))} />
          </div>
        )}
      </SettingRow>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </Panel>
  );
}

// ─── Reasons ────────────────────────────────────────────────────────────────

function ReasonsTab({ data }: { data: LoaderData }) {
  const can = data.features.customReasons;
  const photos = data.features.photos;
  const initial = data.settings.reasons.map((r: any, idx: number) => ({ id: idx, label: r.label, enabled: r.enabled, requirePhoto: r.requirePhoto }));
  const f = useSettingsForm("save_reasons", { reasons: initial });
  const [newLabel, setNewLabel] = useState("");
  const reasons = f.values.reasons;
  const update = (id: number, patch: any) => f.set("reasons", reasons.map((r: any) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      {!can && <div className="mb-5"><UpgradeNotice tier={requiredTier("customReasons")}>Add, rename and remove reasons with the Starter plan.</UpgradeNotice></div>}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return reasons</div>
          <div className="text-[12.5px] text-muted mt-1">Customers pick one of these for each item.{photos ? " Require a photo for the reasons that need proof." : ""}</div>
        </div>
      </div>
      <div className={`space-y-1.5 ${can ? "" : "opacity-60 pointer-events-none"}`}>
        {reasons.map((r: any) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md bg-bg/30 border border-divider group">
            <Icon name="GripVertical" size={14} className="text-faint" />
            <input value={r.label} onChange={(e) => update(r.id, { label: e.target.value })}
              className={`flex-1 bg-transparent text-[13.5px] focus:outline-none ${r.enabled ? "text-ink" : "text-faint line-through"}`} />
            {photos && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-muted cursor-pointer" title="Customers must add a photo">
                <input type="checkbox" className="rf-check" checked={!!r.requirePhoto} onChange={() => update(r.id, { requirePhoto: !r.requirePhoto })} />
                <Icon name="Camera" size={12} /> Photo
              </label>
            )}
            <Toggle checked={r.enabled} onChange={() => update(r.id, { enabled: !r.enabled })} />
            <button onClick={() => f.set("reasons", reasons.filter((x: any) => x.id !== r.id))}
              className="p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover:opacity-100">
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className={`mt-5 pt-5 border-t border-divider flex items-center gap-2 ${can ? "" : "opacity-60 pointer-events-none"}`}>
        <Input value={newLabel} onChange={(e: any) => setNewLabel(e.target.value)} placeholder="e.g. Item not as pictured" className="flex-1"
          onKeyDown={(e: any) => { if (e.key === "Enter" && newLabel.trim()) { f.set("reasons", [...reasons, { id: Date.now(), label: newLabel.trim(), enabled: true, requirePhoto: false }]); setNewLabel(""); } }} />
        <Btn variant="secondary" icon="Plus" disabled={!newLabel.trim()}
          onClick={() => { f.set("reasons", [...reasons, { id: Date.now(), label: newLabel.trim(), enabled: true, requirePhoto: false }]); setNewLabel(""); }}>Add reason</Btn>
      </div>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} disabled={!can} />
    </div>
  );
}

// ─── Policy & EU withdrawal ─────────────────────────────────────────────────

function PolicyTab({ data }: { data: LoaderData }) {
  const f = useSettingsForm("save_policy", { returnPolicy: data.settings.returnPolicy, euWithdrawalEnabled: data.settings.euWithdrawalEnabled });
  const v = f.values;
  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
      <div>
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <div className="text-[14px] font-semibold text-ink">Return policy</div>
            <div className="text-[12.5px] text-muted mt-1">Shown in the portal (“Read our return policy”) and accepted by the customer when submitting.</div>
          </div>
          <div className="text-[11.5px] text-muted flex items-center gap-1.5">
            <Icon name="Eye" size={12} /> {v.returnPolicy.length} characters
          </div>
        </div>
        <Textarea value={v.returnPolicy} onChange={(e: any) => f.set("returnPolicy", e.target.value)} rows={12} className="leading-relaxed" />
      </div>
      <div className="p-4 rounded-md border border-divider bg-bg/30">
        <Toggle checked={v.euWithdrawalEnabled} onChange={(x: boolean) => f.set("euWithdrawalEnabled", x)}
          label="EU withdrawal button (“Withdraw from contract here”)"
          description="Required since 19 June 2026 when you sell to consumers in the EU: a 2-step withdrawal flow reachable without logging in, with an immediate acknowledgment email." />
        {v.euWithdrawalEnabled && (
          <div className="mt-3 pl-12 text-[12px] text-muted leading-relaxed">
            Add a footer link named “Withdraw from contract here” / « Se rétracter du contrat ici » pointing to{" "}
            <span className="font-mono text-ink">/apps/returns?mode=withdraw</span> (see the Portal tab).
          </div>
        )}
      </div>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </div>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────

function NotificationsTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const f = useSettingsForm("save_notifications", {
    weeklyReportEnabled: s.weeklyReportEnabled,
    orderTagsEnabled: s.orderTagsEnabled,
    whatsappNumber: s.whatsappNumber,
    whatsappNotifyEnabled: s.whatsappNotifyEnabled,
    whatsappPhoneNumberId: s.whatsappPhoneNumberId,
    whatsappTemplateName: s.whatsappTemplateName,
    whatsappTemplateLang: s.whatsappTemplateLang,
    whatsappAccessToken: "",
  });
  const v = f.values;
  const ft = data.features;
  return (
    <Panel>
      <SettingRow label="WhatsApp" hint="Customers can contact you on WhatsApp from their return page, and you can message them in one click from each return." tier="pro" allowed={ft.whatsapp}>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Your WhatsApp Business number (international format)</label>
        <Input value={v.whatsappNumber} onChange={(e: any) => f.set("whatsappNumber", e.target.value)} placeholder="+221 77 123 45 67" />
        <div className="mt-4 p-3 rounded-md border border-divider bg-bg/30 space-y-3">
          <Toggle checked={v.whatsappNotifyEnabled} onChange={(x: boolean) => f.set("whatsappNotifyEnabled", x)}
            label="Automatic WhatsApp updates (Meta Cloud API)"
            description="Customers who opt in receive status updates. Requires a WhatsApp Business account and an approved utility template with 3 variables: {{1}} name, {{2}} return number, {{3}} update." />
          {v.whatsappNotifyEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted block mb-1.5">Phone number ID</label>
                <Input value={v.whatsappPhoneNumberId} onChange={(e: any) => f.set("whatsappPhoneNumberId", e.target.value)} />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted block mb-1.5">Template name</label>
                <Input value={v.whatsappTemplateName} onChange={(e: any) => f.set("whatsappTemplateName", e.target.value)} placeholder="return_update" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted block mb-1.5">Template language</label>
                <Input value={v.whatsappTemplateLang} onChange={(e: any) => f.set("whatsappTemplateLang", e.target.value)} placeholder="fr" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted block mb-1.5">Access token {s.hasWhatsappToken && <span className="text-ok">(saved)</span>}</label>
                <Input value={v.whatsappAccessToken} onChange={(e: any) => f.set("whatsappAccessToken", e.target.value)} type="password" placeholder={s.hasWhatsappToken ? "Leave empty to keep" : "EAAG…"} />
              </div>
            </div>
          )}
        </div>
      </SettingRow>
      <SettingRow label="Weekly report" hint="Every Monday: returns, refunds, retained revenue and top reasons of the past week." tier="starter" allowed={ft.weeklyReport}>
        <Toggle checked={v.weeklyReportEnabled} onChange={(x: boolean) => f.set("weeklyReportEnabled", x)} label="Email me a weekly summary" />
      </SettingRow>
      <SettingRow label="Shopify order tags" hint="Tag orders with trackback-return, trackback-exchange, trackback-refunded… to filter them in Shopify." tier="starter" allowed={ft.orderTags}>
        <Toggle checked={v.orderTagsEnabled} onChange={(x: boolean) => f.set("orderTagsEnabled", x)} label="Tag orders automatically" />
      </SettingRow>
      <SaveBar onSave={f.save} onDiscard={f.reset} isSaving={f.isSaving} />
    </Panel>
  );
}

// ─── Integrations (webhooks + API) ──────────────────────────────────────────

function IntegrationsTab({ data }: { data: LoaderData }) {
  const s = data.settings;
  const fetcher = useFetcher<typeof action>();
  const toast = useToast();
  const [url, setUrl] = useState(s.webhookUrl);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const busy = fetcher.state !== "idle";
  const run = (intent: string, payload: Record<string, unknown> = {}) =>
    fetcher.submit({ intent, data: JSON.stringify(payload) }, { method: "POST" });

  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state !== "idle" || !d) return;
    if (d.apiKey) setNewKey(d.apiKey);
    if (d.ok) toast({ kind: "success", title: d.intent === "test_webhook" ? "Test delivered" : "Saved" });
    else toast({ kind: "error", title: "Failed", body: d.error });
  }, [fetcher.state, fetcher.data, toast]);

  return (
    <Panel>
      <SettingRow label="Webhooks" hint="We POST return events (created, approved, shipped, received, refunded…) signed with HMAC-SHA256." tier="pro" allowed={data.features.webhooks}>
        <div className="flex gap-2">
          <Input value={url} onChange={(e: any) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/trackback" className="flex-1" />
          <Btn variant="primary" disabled={busy} onClick={() => run("save_webhook", { webhookUrl: url })}>Save</Btn>
        </div>
        {s.webhookSecret && (
          <div className="mt-3 space-y-2 text-[12.5px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted">Signing secret</span>
              <span className="font-mono text-ink bg-bg px-2 py-1 rounded">{showSecret ? s.webhookSecret : "whsec_••••••••••••"}</span>
              <button className="text-accent2 text-[12px]" onClick={() => setShowSecret((x) => !x)}>{showSecret ? "Hide" : "Reveal"}</button>
              <button className="text-muted text-[12px] hover:text-ink" onClick={() => run("rotate_webhook_secret")}>Rotate</button>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="secondary" size="sm" icon="Send" disabled={busy || !s.webhookUrl} onClick={() => run("test_webhook")}>Send test event</Btn>
              {s.webhookLastStatus && <span className="text-muted">Last: {s.webhookLastStatus}</span>}
            </div>
          </div>
        )}
      </SettingRow>
      <SettingRow label="REST API" hint="Read your returns from your ERP, WMS or spreadsheet." tier="pro" allowed={data.features.api}>
        {newKey ? (
          <div className="p-3 rounded-md border border-ok/30 bg-ok/10 text-[12.5px] space-y-1.5">
            <div className="font-semibold text-ink">Copy your key now — it won't be shown again.</div>
            <div className="font-mono text-ink break-all">{newKey}</div>
          </div>
        ) : s.hasApiKey ? (
          <div className="text-[12.5px] text-muted">Active key: <span className="font-mono text-ink">{s.apiKeyPrefix}…</span></div>
        ) : (
          <div className="text-[12.5px] text-muted">No API key yet.</div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Btn variant="secondary" size="sm" icon="KeyRound" disabled={busy} onClick={() => run("generate_api_key")}>{s.hasApiKey ? "Regenerate key" : "Generate key"}</Btn>
          {s.hasApiKey && <Btn variant="ghost" size="sm" disabled={busy} onClick={() => run("revoke_api_key")}>Revoke</Btn>}
        </div>
        <pre className="mt-3 p-3 rounded-md bg-[#0f1117] text-[#e2e8f0] font-mono text-[11.5px] overflow-x-auto">{`curl ${data.appUrl}/api/v1/returns?status=PENDING \\
  -H "Authorization: Bearer tb_live_…"`}</pre>
      </SettingRow>
    </Panel>
  );
}

// ---- Portal Access tab ----
function PortalAccessTab({ shop, appUrl, apiKey, withdrawal }: { shop: string; appUrl: string; apiKey: string; withdrawal: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);

  const proxyUrl = `https://${shop}/apps/returns`;
  const withdrawalUrl = `https://${shop}/apps/returns?mode=withdraw`;
  const trackUrl = `https://${shop}/apps/returns?mode=status`;
  const directUrl = `${appUrl}/portal?shop=${shop}`;
  const iframeCode = `<iframe\n  src="${directUrl}"\n  width="100%"\n  height="700"\n  frameborder="0"\n  style="border:none;border-radius:12px;"\n></iframe>`;

  // Format Shopify: addAppBlockId={api_client_id}/{block_file_handle}
  // Le block est extensions/theme-return-button/blocks/return-button.liquid → "return-button".
  const BLOCK_HANDLE = "return-button";
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=index&addAppBlockId=${apiKey}/${BLOCK_HANDLE}&target=newAppsSection`;

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
        subtitle="Drop the TrackBack theme block on any page — footer, FAQ, order status, anywhere — without touching code.">
        <Stepper
          color="#22C55E"
          steps={[
            { title: 'Click "Open Theme Editor"', body: 'The Return Button block is pre-selected for you.' },
            { title: 'Pick a section', body: 'Add it to your Footer group, or any section where it makes sense.' },
            { title: 'Hit Save', body: 'Top-right corner of the theme editor. Live instantly.' },
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
          <UrlCard
            label="Track a return"
            badge="Status page"
            badgeTone="blue"
            tagline="Customers look up an existing return and add their tracking number."
            url={trackUrl}
            urlScheme="https://"
            copyKey="track"
            copied={copied}
            onCopy={copy}
          />
          {withdrawal && (
            <UrlCard
              label="Withdraw from contract (EU)"
              badge="Legal"
              badgeTone="green"
              tagline="Link it in your footer as “Withdraw from contract here” / « Se rétracter du contrat ici »."
              url={withdrawalUrl}
              urlScheme="https://"
              copyKey="withdraw"
              copied={copied}
              onCopy={copy}
            />
          )}
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
  green: { bg: 'rgba(34,197,94,0.15)', fg: '#16A34A' },
  purple: { bg: 'rgba(108,99,255,0.15)', fg: '#7c70ff' },
  blue: { bg: 'rgba(59,130,246,0.15)', fg: '#3B82F6' },
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
          className={`h-9 px-3 rounded-md text-[12px] font-medium border transition flex items-center gap-1.5 shrink-0 ${isCopied
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
          <pre className={`w-full p-3 pr-16 rounded-md font-mono text-[11.5px] leading-relaxed overflow-x-auto ${isDark ? 'bg-[#0f1117] text-[#e2e8f0]' : 'bg-bg border border-border text-ink'
            }`}>
            {code}
          </pre>
          <button
            onClick={() => onCopy(copyKey, code)}
            className={`absolute top-2 right-2 h-7 px-2.5 rounded text-[11px] font-medium transition flex items-center gap-1.5 ${isDark
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

