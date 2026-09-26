import { useState, useRef, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureBillingSynced, getShopPlan } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";
import { PageHeader, Icon, ColorPicker, CloudinaryLogoUploader, useToast, UpgradeNotice } from "../components/ui";
import {
  BUILT_IN_TEMPLATES, EMAIL_STRINGS, EMAIL_TYPES, SAMPLE_VARIABLES, TYPE_DESCRIPTIONS, TYPE_VARIABLES, VARIABLE_LABELS,
  fillTemplate, isLegacyDefault, storageType, type EmailType,
} from "../lib/email-templates";
import { LOCALE_LABELS, normalizeLocale, parseLocales, type Locale } from "../lib/i18n";
import { deleteShopAsset, isAcceptableImageDataUrl, shopFolder, uploadToCloudinary } from "../lib/cloudinary.server";

type Template = { subject: string; body: string; custom: boolean };

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) settings = await prisma.shopSettings.create({ data: { shop } });
  const [rows, plan] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { shop } }),
    ensureBillingSynced(admin, shop),
  ]);

  const locales = parseLocales(settings.portalLocales);
  const defaultLocale = (normalizeLocale(settings.defaultLocale) ?? "en") as Locale;
  const byType = new Map(rows.map((r) => [r.type, r]));
  const templates: Record<string, Template> = {};
  for (const locale of locales) {
    for (const type of EMAIL_TYPES) {
      const localized = byType.get(storageType(type, locale));
      const legacy = locale === defaultLocale ? byType.get(type) : undefined;
      if (localized) templates[`${type}@${locale}`] = { subject: localized.subject, body: localized.body, custom: true };
      else if (legacy && !isLegacyDefault(type, legacy.subject, legacy.body)) {
        templates[`${type}@${locale}`] = { subject: legacy.subject.replace(/Acme Store/g, "{{store_name}}"), body: legacy.body.replace(/Acme Store/g, "{{store_name}}"), custom: true };
      } else {
        templates[`${type}@${locale}`] = { ...BUILT_IN_TEMPLATES[locale][type], custom: false };
      }
    }
  }

  return {
    shop,
    plan,
    canEdit: hasFeature(plan, "emailTemplates"),
    whiteLabel: hasFeature(plan, "whiteLabel"),
    locales,
    defaultLocale,
    storeName: settings.portalStoreName || shop.split(".")[0],
    logoUrl: settings.logoUrl ?? "",
    brandColor: settings.emailBrandColor || settings.brandColor,
    fromEmail: settings.fromEmail,
    poweredBy: settings.labelPoweredBy,
    templates,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getShopPlan(shop);
  if (!hasFeature(plan, "emailTemplates")) return { error: "upgrade_required" };
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "upload_logo") {
    const base64 = String(fd.get("base64") ?? "");
    if (!isAcceptableImageDataUrl(base64)) return { error: "Unsupported image" };
    const current = await prisma.shopSettings.findUnique({ where: { shop }, select: { logoUrl: true } });
    const { url } = await uploadToCloudinary(base64, shopFolder(shop, "logos"));
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: url } });
    // Only the logo we stored for THIS shop can ever be deleted.
    await deleteShopAsset(shop, current?.logoUrl);
    return { logoUrl: url };
  }
  if (intent === "remove_logo") {
    const current = await prisma.shopSettings.findUnique({ where: { shop }, select: { logoUrl: true } });
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: null } });
    await deleteShopAsset(shop, current?.logoUrl);
    return { removed: true };
  }
  if (intent === "save_branding") {
    const color = String(fd.get("brandColor") ?? "");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Invalid color" };
    await prisma.shopSettings.update({ where: { shop }, data: { emailBrandColor: color } });
    return { brandingSaved: true };
  }

  const type = String(fd.get("type") ?? "") as EmailType;
  const locale = normalizeLocale(String(fd.get("locale") ?? "")) as Locale | null;
  if (!EMAIL_TYPES.includes(type) || !locale) return { error: "Unknown template" };

  if (intent === "save_template") {
    const subject = String(fd.get("subject") ?? "").slice(0, 300);
    const body = String(fd.get("body") ?? "").slice(0, 10000);
    if (!subject.trim() || !body.trim()) return { error: "Subject and body are required" };
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type: storageType(type, locale) } },
      create: { shop, type: storageType(type, locale), subject, body },
      update: { subject, body },
    });
    return { templateSaved: true, type, locale };
  }
  if (intent === "reset_template") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { defaultLocale: true } });
    const types = [storageType(type, locale)];
    if ((normalizeLocale(settings?.defaultLocale) ?? "en") === locale) types.push(type);
    await prisma.emailTemplate.deleteMany({ where: { shop, type: { in: types } } });
    return { templateReset: true, type, locale };
  }
  return null;
};

// ─── Page ────────────────────────────────────────────────────────────────────

const TYPE_META: Record<EmailType, { icon: string; color: string; bg: string }> = {
  "Request Received": { icon: "Inbox", color: "#3B82F6", bg: "rgba(59,130,246,0.1)" },
  Approved: { icon: "Check", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  Rejected: { icon: "X", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  Shipped: { icon: "Truck", color: "#0EA5E9", bg: "rgba(14,165,233,0.1)" },
  Received: { icon: "PackageCheck", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)" },
  Refunded: { icon: "Banknote", color: "#22C55E", bg: "rgba(34,197,94,0.1)" },
  Expired: { icon: "Clock", color: "#6B7280", bg: "rgba(107,114,128,0.1)" },
  "Withdrawal Received": { icon: "FileX", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
};

export default function EmailTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>() as any;
  const toast = useToast();

  const [logoUrl, setLogoUrl] = useState(data.logoUrl);
  const [brandColor, setBrandColor] = useState(data.brandColor);
  const [activeType, setActiveType] = useState<EmailType>(EMAIL_TYPES[0]);
  const [locale, setLocale] = useState<Locale>(data.defaultLocale);
  const [editMap, setEditMap] = useState<Record<string, Template>>(data.templates);
  useEffect(() => setEditMap(data.templates), [data.templates]);

  const isSaving = navigation.state === "submitting";
  const key = `${activeType}@${locale}`;
  const cur = editMap[key] ?? { ...BUILT_IN_TEMPLATES[locale][activeType], custom: false };
  const setCur = (patch: Partial<Template>) => setEditMap((prev) => ({ ...prev, [key]: { ...cur, ...patch } }));

  useEffect(() => {
    if (navigation.state !== "idle" || !actionData) return;
    if (actionData.brandingSaved) toast({ kind: "success", title: "Branding saved" });
    if (actionData.templateSaved) toast({ kind: "success", title: `“${actionData.type}” (${actionData.locale}) saved` });
    if (actionData.templateReset) toast({ kind: "info", title: "Template reset to default" });
    if (actionData.error && actionData.error !== "upgrade_required") toast({ kind: "error", title: "Error", body: actionData.error });
  }, [navigation.state, actionData, toast]);

  const post = (payload: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
    submit(fd, { method: "POST" });
  };

  return (
    <div>
      <PageHeader title="Email Templates" subtitle="Customize the emails sent to customers at each stage, in each language." />
      {!data.canEdit && <div className="mb-6"><UpgradeNotice tier="starter">Email Templates require the Starter plan — the default templates below are sent until then.</UpgradeNotice></div>}

      <div className="mb-6 p-5 rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded grid place-content-center" style={{ background: "rgba(108,99,255,0.12)", color: "#8B85FF" }}>
            <Icon name="Sparkles" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-ink">Email branding</span>
          <span className="text-[11.5px] text-muted">— logo and brand color appear in all email headers</span>
        </div>
        <div className={`flex flex-wrap gap-8 items-start ${data.canEdit ? "" : "opacity-60 pointer-events-none"}`}>
          <div className="w-72">
            <CloudinaryLogoUploader value={logoUrl} onUpload={(url) => setLogoUrl(url)} onRemove={() => setLogoUrl("")} />
          </div>
          <div className="flex-1 min-w-[240px]">
            <ColorPicker label="Brand color" hint="Used in the email header background" value={brandColor} onChange={setBrandColor} />
            <button onClick={() => post({ intent: "save_branding", brandColor })} disabled={brandColor === data.brandColor || isSaving}
              className="mt-4 h-8 px-4 rounded-lg text-[12.5px] font-semibold text-white flex items-center gap-1.5 transition disabled:opacity-40" style={{ background: "#6C63FF" }}>
              <Icon name="Check" size={12} /> Save branding
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {EMAIL_TYPES.map((t) => {
            const m = TYPE_META[t];
            const active = activeType === t;
            return (
              <button key={t} onClick={() => setActiveType(t)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12.5px] font-medium transition ${active ? "border-accent bg-accent/5 text-ink" : "border-border bg-surface text-muted hover:text-ink"}`}>
                <div className="w-5 h-5 rounded grid place-content-center" style={active ? { background: m.bg, color: m.color } : { background: "rgba(0,0,0,0.05)", color: "#888" }}>
                  <Icon name={m.icon} size={11} strokeWidth={2.5} />
                </div>
                {t}
              </button>
            );
          })}
        </div>
        {data.locales.length > 1 && (
          <div className="inline-flex items-center bg-surface border border-border rounded-md p-0.5">
            {data.locales.map((l) => (
              <button key={l} onClick={() => setLocale(l)}
                className={`px-3 h-7 text-[12px] font-medium rounded transition-colors ${locale === l ? "bg-accent/15 text-accent2" : "text-muted hover:text-ink"}`}>
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5">
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-divider flex items-center justify-between gap-3">
            <div>
              <div className="text-[13.5px] font-semibold text-ink flex items-center gap-2">
                {activeType}
                <span className="text-[10.5px] uppercase font-bold text-faint">{locale}</span>
                {cur.custom && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(108,99,255,0.14)", color: "#8B85FF" }}>Custom</span>}
              </div>
              <div className="text-[11.5px] text-muted mt-0.5">{TYPE_DESCRIPTIONS[activeType]}</div>
            </div>
            <div className="flex items-center gap-2">
              {cur.custom && (
                <button onClick={() => post({ intent: "reset_template", type: activeType, locale })} disabled={isSaving || !data.canEdit}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium border border-border text-muted hover:text-ink transition disabled:opacity-40">Reset</button>
              )}
              <button onClick={() => post({ intent: "save_template", type: activeType, locale, subject: cur.subject, body: cur.body })} disabled={isSaving || !data.canEdit}
                className="h-8 px-4 rounded-lg text-[12.5px] font-semibold text-white flex items-center gap-1.5 transition disabled:opacity-40" style={{ background: "#6C63FF" }}>
                {isSaving ? <><Icon name="LoaderCircle" size={12} className="animate-spin" /> Saving…</> : <><Icon name="Check" size={12} /> Save</>}
              </button>
            </div>
          </div>
          <div className={`p-5 space-y-5 ${data.canEdit ? "" : "opacity-70"}`}>
            <div>
              <label className="block text-[12px] font-semibold text-ink mb-1.5">Subject line</label>
              <input type="text" value={cur.subject} readOnly={!data.canEdit} onChange={(e) => setCur({ subject: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-ink mb-1.5">Body</label>
              <BodyEditor value={cur.body} onChange={(body) => setCur({ body })} vars={TYPE_VARIABLES[activeType]} readOnly={!data.canEdit} />
            </div>
            <div className="p-3 rounded-lg bg-bg border border-divider text-[11.5px] text-muted flex items-start gap-2">
              <Icon name="Info" size={13} className="shrink-0 mt-0.5 text-faint" />
              <span>Sent in the customer's language. Replies go to <strong className="text-ink">{data.fromEmail || "your reply-to email"}</strong> (Settings → General). Blocks like <span className="font-mono">{"{{return_instructions}}"}</span> adapt to the return method automatically.</span>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-divider flex items-center gap-2">
            <Icon name="Eye" size={14} className="text-muted" />
            <span className="text-[13px] font-semibold text-ink">Live preview</span>
            <span className="text-[11px] text-muted ml-1">with sample data</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4" style={{ background: "#eceef2" }}>
            <EmailPreview logoUrl={logoUrl} brandColor={brandColor} storeName={data.storeName} subject={cur.subject} body={cur.body}
              locale={locale} poweredBy={data.whiteLabel ? data.poweredBy : EMAIL_STRINGS[locale].poweredBy} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BodyEditor({ value, onChange, vars, readOnly }: { value: string; onChange: (v: string) => void; vars: readonly string[]; readOnly?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const insertVar = (key: string) => {
    const ta = textareaRef.current;
    if (!ta || readOnly) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const token = `{{${key}}}`;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div>
      <textarea ref={textareaRef} value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} rows={14} spellCheck={false}
        className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg text-[13px] text-ink resize-y font-mono leading-relaxed focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition" />
      <div className="mt-2">
        <span className="text-[11px] text-faint mr-2">Insert variable:</span>
        {vars.map((k) => (
          <button key={k} type="button" onClick={() => insertVar(k)} title={VARIABLE_LABELS[k as keyof typeof VARIABLE_LABELS]}
            className="inline-flex items-center gap-1 mr-1.5 mb-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border border-border bg-bg text-ink hover:border-accent/60 hover:bg-accent/5 transition">
            <Icon name="Plus" size={9} />{`{{${k}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmailPreview({ logoUrl, brandColor, storeName, subject, body, locale, poweredBy }: {
  logoUrl: string; brandColor: string; storeName: string; subject: string; body: string; locale: Locale; poweredBy: string;
}) {
  const vars = { ...SAMPLE_VARIABLES[locale], store_name: storeName };
  const strings = EMAIL_STRINGS[locale];
  const paragraphs = fillTemplate(body, vars).split("\n").map((l, i) =>
    l.trim() ? <p key={i} style={{ margin: "0 0 14px", lineHeight: 1.65, fontSize: 14, color: "#1a1a2e", wordBreak: "break-word" }}>{l}</p> : <div key={i} style={{ height: 4 }} />,
  );
  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: 12, fontSize: 11.5, color: "#888", background: "#fff", borderRadius: 8, padding: "10px 14px", border: "1px solid #e6e6ec" }}>
        <div style={{ marginBottom: 3 }}><strong style={{ color: "#444" }}>From:</strong> {storeName}</div>
        <div><strong style={{ color: "#444" }}>Subject:</strong> {fillTemplate(subject, vars) || <span style={{ color: "#aaa" }}>—</span>}</div>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.08)", border: "1px solid #e6e6ec" }}>
        <div style={{ background: brandColor, padding: "22px 28px 20px" }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ height: 38, width: "auto", objectFit: "contain", marginBottom: 8, display: "block", maxWidth: 180 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{storeName}</div>
          )}
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>{strings.returnCenter}</div>
        </div>
        <div style={{ padding: "28px 32px 20px" }}>{paragraphs}</div>
        <div style={{ padding: "0 32px 24px" }}>
          <span style={{ display: "inline-block", padding: "10px 22px", borderRadius: 8, background: brandColor, color: "#fff", fontWeight: 600, fontSize: 13 }}>{strings.ctaStatus}</span>
        </div>
        {poweredBy && <div style={{ padding: "16px 32px", borderTop: "1px solid #f0f0f0", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>🔒 {poweredBy}</div>}
      </div>
    </div>
  );
}
