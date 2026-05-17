import { useState, useRef, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planAtLeast } from "../lib/plan.server";
import {
  PageHeader, Icon, ColorPicker, CloudinaryLogoUploader, useToast
} from "../components/ui";
import { EMAIL_TEMPLATES } from "../components/mock-data";
import {
  uploadToCloudinary, deleteFromCloudinary, isCloudinaryUrl
} from "../lib/cloudinary.server";

// ─── Types ───────────────────────────────────────────────────────────────────

type Template = { type: string; subject: string; body: string };

const TEMPLATE_TYPES = ["Request Received", "Approved", "Rejected", "Refunded"] as const;

const TEMPLATE_VARS: Record<string, { key: string; label: string }[]> = {
  "Request Received": [
    { key: "customer_name", label: "Customer name" },
    { key: "rma_number",    label: "RMA number"    },
    { key: "order_number",  label: "Order #"        },
    { key: "item_count",    label: "Item count"     },
  ],
  Approved: [
    { key: "customer_name", label: "Customer name" },
    { key: "rma_number",    label: "RMA number"    },
    { key: "order_number",  label: "Order #"        },
    { key: "refund_amount", label: "Refund amount" },
  ],
  Rejected: [
    { key: "customer_name",   label: "Customer name"    },
    { key: "rma_number",      label: "RMA number"       },
    { key: "order_number",    label: "Order #"           },
    { key: "rejection_reason",label: "Rejection reason" },
  ],
  Refunded: [
    { key: "customer_name", label: "Customer name" },
    { key: "rma_number",    label: "RMA number"    },
    { key: "order_number",  label: "Order #"        },
    { key: "refund_amount", label: "Refund amount" },
  ],
};

const SAMPLE: Record<string, string> = {
  customer_name:    "Jane Smith",
  rma_number:       "RMA-2026-000042",
  order_number:     "#1089",
  item_count:       "2",
  refund_amount:    "$42.00",
  rejection_reason: "Item is not eligible for return.",
  carrier:          "UPS",
  tracking_number:  "1Z999AA10123456784",
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) settings = await prisma.shopSettings.create({ data: { shop } });

  // Seed defaults
  for (const type of TEMPLATE_TYPES) {
    const exists = await prisma.emailTemplate.findUnique({ where: { shop_type: { shop, type } } });
    if (!exists) {
      const def = EMAIL_TEMPLATES[type as keyof typeof EMAIL_TEMPLATES];
      await prisma.emailTemplate.create({ data: { shop, type, subject: def.subject, body: def.body } });
    }
  }

  const [templates, plan] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { shop } }),
    getShopPlan(shop),
  ]);

  return {
    shop,
    plan,
    logoUrl:    settings.logoUrl ?? "",
    brandColor: settings.emailBrandColor,
    fromEmail:  settings.fromEmail,
    templates,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getShopPlan(shop);
  if (!planAtLeast(plan, 'starter')) {
    return { error: 'upgrade_required' };
  }
  const fd = await request.formData();
  const intent = fd.get("intent") as string;

  if (intent === "upload_logo") {
    const base64      = fd.get("base64")      as string;
    const previousUrl = fd.get("previousUrl") as string;
    if (previousUrl && isCloudinaryUrl(previousUrl)) {
      await deleteFromCloudinary(previousUrl).catch(() => {});
    }
    const { url } = await uploadToCloudinary(base64);
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: url } });
    return { logoUrl: url };
  }

  if (intent === "remove_logo") {
    const logoUrl = fd.get("logoUrl") as string;
    if (isCloudinaryUrl(logoUrl)) {
      await deleteFromCloudinary(logoUrl).catch(() => {});
    }
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: null } });
    return { removed: true };
  }

  if (intent === "save_branding") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { emailBrandColor: fd.get("brandColor") as string },
    });
    return { brandingSaved: true };
  }

  if (intent === "save_template") {
    const type    = fd.get("type")    as string;
    const subject = fd.get("subject") as string;
    const body    = fd.get("body")    as string;
    await prisma.emailTemplate.upsert({
      where:  { shop_type: { shop, type } },
      create: { shop, type, subject, body },
      update: { subject, body },
    });
    return { templateSaved: true, type };
  }

  return null;
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EmailTemplatesPage() {
  const { logoUrl: initLogo, brandColor: initColor, fromEmail, templates, shop, plan } =
    useLoaderData<typeof loader>();
  const isStarter = plan === 'starter' || plan === 'pro';

  const submit     = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const toast      = useToast();

  const [logoUrl,    setLogoUrl]    = useState(initLogo);
  const [brandColor, setBrandColor] = useState(initColor);
  const [activeType, setActiveType] = useState<string>(TEMPLATE_TYPES[0]);

  const byType = (t: string): Template => {
    const found = templates.find((x: any) => x.type === t);
    const def   = EMAIL_TEMPLATES[t as keyof typeof EMAIL_TEMPLATES];
    return found ?? { type: t, subject: def?.subject ?? "", body: def?.body ?? "" };
  };

  const [editMap, setEditMap] = useState<Record<string, Template>>(() =>
    Object.fromEntries(TEMPLATE_TYPES.map(t => [t, byType(t)]))
  );

  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (navigation.state === "idle" && actionData) {
      if ((actionData as any).brandingSaved) toast({ kind: "success", title: "Branding saved!" });
      if ((actionData as any).templateSaved) toast({ kind: "success", title: `"${(actionData as any).type}" template saved!` });
    }
  }, [navigation.state, actionData]);

  const cur = editMap[activeType];
  const setCur = (patch: Partial<Template>) =>
    setEditMap(prev => ({ ...prev, [activeType]: { ...prev[activeType], ...patch } }));

  const saveBranding = () => {
    const fd = new FormData();
    fd.append("intent", "save_branding");
    fd.append("brandColor", brandColor);
    submit(fd, { method: "POST" });
  };

  const saveTemplate = () => {
    const fd = new FormData();
    fd.append("intent", "save_template");
    fd.append("type",    cur.type);
    fd.append("subject", cur.subject);
    fd.append("body",    cur.body);
    submit(fd, { method: "POST" });
  };

  const TYPE_META: Record<string, { icon: string; color: string; bg: string; desc: string }> = {
    "Request Received": { icon: "Inbox",    color: "#3B82F6", bg: "rgba(59,130,246,0.1)",  desc: "Sent when a customer submits a return" },
    "Approved":         { icon: "Check",    color: "#10B981", bg: "rgba(16,185,129,0.1)",  desc: "Sent when you approve a return request" },
    "Rejected":         { icon: "X",        color: "#EF4444", bg: "rgba(239,68,68,0.1)",   desc: "Sent when you reject a return request" },
    "Refunded":         { icon: "Banknote", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)",  desc: "Sent when the refund is issued" },
  };

  return (
    <div>
      <PageHeader
        title="Email Templates"
        subtitle="Customize the emails sent to customers at each stage of the return process."
      />

      {!isStarter && (
        <div className="flex items-center gap-3 p-4 mb-6 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/8">
          <Icon name="Lock" size={15} style={{ color: '#F59E0B' }} className="shrink-0" />
          <p className="text-[12.5px] text-ink flex-1">
            <span className="font-semibold">Email Templates require the Starter plan.</span>
            {" "}Upgrade to customize email content and branding.
          </p>
          <a href="/app/billing"
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#F59E0B' }}>
            Upgrade <Icon name="ArrowRight" size={12} />
          </a>
        </div>
      )}

      {/* ── Branding bar ── */}
      <div className="mb-6 p-5 rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded grid place-content-center" style={{ background: "rgba(108,99,255,0.12)", color: "#8B85FF" }}>
            <Icon name="Sparkles" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-ink">Email branding</span>
          <span className="text-[11.5px] text-muted">— logo and brand color appear in all email headers</span>
        </div>

        <div className="flex flex-wrap gap-8 items-start">
          {/* Logo */}
          <div className="w-72">
            <CloudinaryLogoUploader
              value={logoUrl}
              onUpload={url => setLogoUrl(url)}
              onRemove={() => setLogoUrl("")}
            />
          </div>

          {/* Brand color */}
          <div className="flex-1 min-w-[240px]">
            <ColorPicker
              label="Brand color"
              hint="Used in the email header background"
              value={brandColor}
              onChange={setBrandColor}
            />
            <button
              onClick={saveBranding}
              disabled={brandColor === initColor || isSaving || !isStarter}
              className="mt-4 h-8 px-4 rounded-lg text-[12.5px] font-semibold text-white flex items-center gap-1.5 transition disabled:opacity-40"
              style={{ background: "#6C63FF" }}
            >
              {isSaving
                ? <><Icon name="Loader2" size={12} className="animate-spin" /> Saving…</>
                : <><Icon name="Check" size={12} /> Save branding</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Template tabs ── */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {TEMPLATE_TYPES.map(t => {
          const m = TYPE_META[t];
          const active = activeType === t;
          return (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-[13px] font-medium transition ${
                active ? "border-accent bg-accent/5 text-ink" : "border-border bg-surface text-muted hover:text-ink hover:border-border/80"
              }`}
            >
              <div
                className="w-5 h-5 rounded grid place-content-center"
                style={active ? { background: m.bg, color: m.color } : { background: "rgba(0,0,0,0.05)", color: "#888" }}
              >
                <Icon name={m.icon} size={11} strokeWidth={2.5} />
              </div>
              {t}
            </button>
          );
        })}
      </div>

      {/* ── Split pane: editor + preview ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5">

        {/* Left — editor */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-divider flex items-center justify-between">
            <div>
              <div className="text-[13.5px] font-semibold text-ink">{activeType}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{TYPE_META[activeType].desc}</div>
            </div>
            <button
              onClick={saveTemplate}
              disabled={isSaving || !isStarter}
              className="h-8 px-4 rounded-lg text-[12.5px] font-semibold text-white flex items-center gap-1.5 transition disabled:opacity-40"
              style={{ background: "#6C63FF" }}
            >
              {isSaving
                ? <><Icon name="Loader2" size={12} className="animate-spin" /> Saving…</>
                : <><Icon name="Check" size={12} /> Save</>}
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Subject */}
            <div>
              <label className="block text-[12px] font-semibold text-ink mb-1.5">Subject line</label>
              <input
                type="text"
                value={cur.subject}
                onChange={e => setCur({ subject: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg text-[13px] text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-[12px] font-semibold text-ink mb-1.5">Body</label>
              <BodyEditor
                value={cur.body}
                onChange={body => setCur({ body })}
                vars={TEMPLATE_VARS[activeType] ?? []}
              />
            </div>

            {/* From email hint */}
            <div className="p-3 rounded-lg bg-bg border border-divider text-[11.5px] text-muted flex items-start gap-2">
              <Icon name="Info" size={13} className="shrink-0 mt-0.5 text-faint" />
              <span>Sent from <strong className="text-ink">{fromEmail || "your configured From Email"}</strong>. Update in <strong className="text-ink">Settings → General</strong>.</span>
            </div>
          </div>
        </div>

        {/* Right — preview */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-divider flex items-center gap-2">
            <Icon name="Eye" size={14} className="text-muted" />
            <span className="text-[13px] font-semibold text-ink">Live preview</span>
            <span className="text-[11px] text-muted ml-1">with sample data</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4" style={{ background: "#eceef2" }}>
            <EmailPreview
              logoUrl={logoUrl}
              brandColor={brandColor}
              storeName={shop.split(".")[0]}
              subject={cur.subject}
              body={cur.body}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Body editor with variable chips ─────────────────────────────────────────

function BodyEditor({ value, onChange, vars }: {
  value: string;
  onChange: (v: string) => void;
  vars: { key: string; label: string }[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = (key: string) => {
    const ta  = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end   = ta.selectionEnd   ?? value.length;
    const token = `{{${key}}}`;
    const next  = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Restore cursor after the inserted token
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={12}
        className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg text-[13px] text-ink resize-y font-mono leading-relaxed focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition placeholder:text-faint"
        placeholder="Write your email body here…"
        spellCheck={false}
      />

      {/* Variable chips */}
      <div className="mt-2">
        <span className="text-[11px] text-faint mr-2">Insert variable:</span>
        {vars.map(v => (
          <button
            key={v.key}
            type="button"
            onClick={() => insertVar(v.key)}
            className="inline-flex items-center gap-1 mr-1.5 mb-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border border-border bg-bg text-ink hover:border-accent/60 hover:bg-accent/5 transition"
          >
            <Icon name="Plus" size={9} />
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Email preview ────────────────────────────────────────────────────────────

function EmailPreview({ logoUrl, brandColor, storeName, subject, body }: {
  logoUrl: string;
  brandColor: string;
  storeName: string;
  subject: string;
  body: string;
}) {
  const fill = (s: string) =>
    Object.entries(SAMPLE).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
      s
    );

  const paragraphs = fill(body)
    .split("\n")
    .map((l, i) => l.trim() ? <p key={i} style={{ margin: "0 0 14px", lineHeight: 1.65, fontSize: 14, color: "#1a1a2e" }}>{l}</p> : <div key={i} style={{ height: 4 }} />);

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* Email meta bar */}
      <div style={{ marginBottom: 12, fontSize: 11.5, color: "#888", background: "#fff", borderRadius: 8, padding: "10px 14px", border: "1px solid #e6e6ec" }}>
        <div style={{ marginBottom: 3 }}><strong style={{ color: "#444" }}>From:</strong> ReturnFlow &lt;returns@{storeName}&gt;</div>
        <div><strong style={{ color: "#444" }}>Subject:</strong> {fill(subject) || <span style={{ color: "#aaa" }}>—</span>}</div>
      </div>

      {/* Email card */}
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.08)", border: "1px solid #e6e6ec" }}>
        {/* Header */}
        <div style={{ background: brandColor, padding: "22px 28px 20px" }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo"
                 style={{ height: 38, width: "auto", objectFit: "contain", marginBottom: 8, display: "block", maxWidth: 180 }}
                 onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              {storeName}
            </div>
          )}
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Return Center</div>
        </div>

        {/* Body */}
        <div style={{ padding: "28px 32px 20px" }}>
          {paragraphs}
        </div>

        {/* CTA */}
        <div style={{ padding: "0 32px 24px" }}>
          <a href="#"
             style={{ display: "inline-block", padding: "10px 22px", borderRadius: 8, background: brandColor, color: "#fff", fontWeight: 600, fontSize: 13, textDecoration: "none", cursor: "default" }}
             onClick={e => e.preventDefault()}>
            View Return Status
          </a>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 32px", borderTop: "1px solid #f0f0f0", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
          🔒 Secured by ReturnFlow
        </div>
      </div>
    </div>
  );
}
