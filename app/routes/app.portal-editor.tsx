import React, { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { uploadToCloudinary, deleteFromCloudinary, isCloudinaryUrl } from "../lib/cloudinary.server";
import { getShopPlan, planAtLeast } from "../lib/plan.server";
import { Icon, useToast, ColorPicker, CloudinaryLogoUploader } from "../components/ui";

// ─── Types ───────────────────────────────────────────────────────────────────

type EditorSettings = {
  portalLayout:        string;
  brandColor:          string;
  bannerColor:         string;
  logoUrl:             string;
  portalStoreName:     string;
  footerContact:       string;
  labelFindOrder:      string;
  labelSelectItems:    string;
  labelReasons:        string;
  labelRefundType:     string;
  labelConfirm:        string;
  labelCta:            string;
  labelSubmit:         string;
  descFindOrder:       string;
  descSelectItems:     string;
  descReasons:         string;
  descRefundType:      string;
  descConfirm:         string;
  labelBackToStore:    string;
  labelCantFind:       string;
  labelStartAnother:   string;
  labelPoweredBy:      string;
  labelTrackingToggle: string;
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [s, plan] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }).then(r => r ?? prisma.shopSettings.create({ data: { shop } })),
    getShopPlan(shop),
  ]);

  return {
    shop,
    plan,
    initial: {
      portalLayout:        s.portalLayout,
      brandColor:          s.brandColor,
      bannerColor:         s.bannerColor,
      logoUrl:             s.logoUrl ?? "",
      portalStoreName:     s.portalStoreName,
      footerContact:       s.footerContact,
      labelFindOrder:      s.labelFindOrder,
      labelSelectItems:    s.labelSelectItems,
      labelReasons:        s.labelReasons,
      labelRefundType:     s.labelRefundType,
      labelConfirm:        s.labelConfirm,
      labelCta:            s.labelCta,
      labelSubmit:         s.labelSubmit,
      descFindOrder:       s.descFindOrder,
      descSelectItems:     s.descSelectItems,
      descReasons:         s.descReasons,
      descRefundType:      s.descRefundType,
      descConfirm:         s.descConfirm,
      labelBackToStore:    s.labelBackToStore,
      labelCantFind:       s.labelCantFind,
      labelStartAnother:   s.labelStartAnother,
      labelPoweredBy:      s.labelPoweredBy,
      labelTrackingToggle: s.labelTrackingToggle,
    } satisfies EditorSettings,
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
  const intent = fd.get("intent") as string | null;

  if (intent === "upload_logo") {
    const base64 = fd.get("base64") as string;
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

  await prisma.shopSettings.update({
    where: { shop },
    data: {
      portalLayout:        fd.get("portalLayout")        as string,
      brandColor:          fd.get("brandColor")          as string,
      bannerColor:         fd.get("bannerColor")         as string,
      logoUrl:             (fd.get("logoUrl") as string) || null,
      portalStoreName:     fd.get("portalStoreName")     as string,
      footerContact:       fd.get("footerContact")       as string,
      labelFindOrder:      fd.get("labelFindOrder")      as string,
      labelSelectItems:    fd.get("labelSelectItems")    as string,
      labelReasons:        fd.get("labelReasons")        as string,
      labelRefundType:     fd.get("labelRefundType")     as string,
      labelConfirm:        fd.get("labelConfirm")        as string,
      labelCta:            fd.get("labelCta")            as string,
      labelSubmit:         fd.get("labelSubmit")         as string,
      descFindOrder:       fd.get("descFindOrder")       as string,
      descSelectItems:     fd.get("descSelectItems")     as string,
      descReasons:         fd.get("descReasons")         as string,
      descRefundType:      fd.get("descRefundType")      as string,
      descConfirm:         fd.get("descConfirm")         as string,
      labelBackToStore:    fd.get("labelBackToStore")    as string,
      labelCantFind:       fd.get("labelCantFind")       as string,
      labelStartAnother:   fd.get("labelStartAnother")  as string,
      labelPoweredBy:      fd.get("labelPoweredBy")      as string,
      labelTrackingToggle: fd.get("labelTrackingToggle") as string,
    },
  });

  return { success: true };
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PortalEditorPage() {
  const { initial, shop, plan } = useLoaderData<typeof loader>();
  const isStarter = plan === 'starter' || plan === 'pro';
  const isPro = plan === 'pro';
  const submit        = useSubmit();
  const navigation    = useNavigation();
  const actionData    = useActionData<typeof action>();
  const toast         = useToast();

  const [s, setS]             = useState<EditorSettings>(initial);
  const [device, setDevice]   = useState<"desktop" | "mobile">("desktop");
  const [previewStep, setPreviewStep] = useState(1);
  const [openSection, setOpenSection] = useState("layout");
  const [pendingOpen, setPendingOpen] = useState(false);

  const isSaving = navigation.state === "submitting";
  const isDirty  = JSON.stringify(s) !== JSON.stringify(initial);

  const wasSaving = useRef(false);
  useEffect(() => {
    if (navigation.state === "submitting") wasSaving.current = true;
    if (navigation.state === "idle" && wasSaving.current) {
      wasSaving.current = false;
      if ((actionData as any)?.success) {
        toast({ kind: "success", title: "Portal updated & published!" });
        if (pendingOpen) {
          setPendingOpen(false);
          window.open(`/portal?shop=${shop}`, "_blank");
        }
      }
    }
  }, [navigation.state, actionData, pendingOpen, shop]);

  const set = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) =>
    setS(prev => ({ ...prev, [key]: value }));

  const doSave = () => {
    const fd = new FormData();
    (Object.entries(s) as [string, string][]).forEach(([k, v]) => fd.append(k, v));
    submit(fd, { method: "POST" });
  };

  const handleOpenPortal = () => {
    if (isDirty) {
      setPendingOpen(true);
      doSave();
    } else {
      window.open(`/portal?shop=${shop}`, "_blank");
    }
  };

  const toggle = (key: string) =>
    setOpenSection(prev => (prev === key ? "" : key));

  const STEPS = ["Find Order", "Select Items", "Reason", "Refund Type", "Confirm"];

  return (
    <div
      className="-mx-6 md:-mx-10 -my-8 flex flex-col bg-bg"
      style={{ height: "100vh" }}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface shrink-0 gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md grid place-content-center shrink-0"
               style={{ background: "rgba(108,99,255,0.15)", color: "#8B85FF" }}>
            <Icon name="Paintbrush2" size={15} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink leading-tight">Portal Editor</div>
            <div className="text-[11px] text-muted">Customize the customer-facing returns portal</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && !isSaving && (
            <span className="text-[11.5px] text-muted hidden sm:block">Unsaved changes</span>
          )}
          <button
            onClick={() => setS(initial)}
            disabled={!isDirty || isSaving || !isStarter}
            className="h-8 px-3 rounded-md text-[12.5px] font-medium border border-border bg-surface hover:bg-bg transition disabled:opacity-40"
          >
            Discard
          </button>
          <button
            onClick={doSave}
            disabled={!isDirty || isSaving || !isStarter}
            className="h-8 px-4 rounded-md text-[12.5px] font-semibold text-white transition disabled:opacity-40 flex items-center gap-1.5"
            style={{ background: "#6C63FF" }}
          >
            {isSaving
              ? <><Icon name="Loader2" size={13} className="animate-spin" /> Saving…</>
              : <><Icon name="Check" size={13} /> Save & Publish</>}
          </button>
        </div>
      </div>

      {/* ── Upgrade banner for Free plan ── */}
      {!isStarter && (
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[#F59E0B]/30 bg-[#F59E0B]/8 shrink-0">
          <Icon name="Lock" size={15} style={{ color: '#F59E0B' }} className="shrink-0" />
          <p className="text-[12.5px] text-ink flex-1">
            <span className="font-semibold">Portal Editor requires the Starter plan.</span>
            {" "}Upgrade to customize branding, colors, logo and portal texts.
          </p>
          <a href="/app/billing"
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#F59E0B' }}>
            Upgrade <Icon name="ArrowRight" size={12} />
          </a>
        </div>
      )}

      {/* ── Split pane ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left — controls */}
        <div className={`w-[320px] shrink-0 border-r border-border flex flex-col overflow-y-auto bg-surface relative ${!isStarter ? 'pointer-events-none select-none' : ''}`}>
          {!isStarter && (
            <div className="absolute inset-0 z-10 bg-surface/60 backdrop-blur-[1px]" />
          )}
          <div className="px-4 py-2.5 border-b border-divider">
            <span className="text-[10px] uppercase tracking-[0.08em] text-faint font-semibold">Controls</span>
          </div>

          {/* Layout picker */}
          <LayoutPicker
            value={s.portalLayout}
            brandColor={s.brandColor}
            onChange={v => set("portalLayout", v)}
          />

          {/* Theme */}
          <AccordionSection title="Theme" icon="Palette" open={openSection === "theme"} onToggle={() => toggle("theme")}>
            <ColorPicker
              label="Brand color"
              hint="Primary buttons, links, active states"
              value={s.brandColor}
              onChange={v => set("brandColor", v)}
            />
            <ColorPicker
              label="Header background"
              hint="Portal top bar color"
              value={s.bannerColor}
              onChange={v => set("bannerColor", v)}
            />
          </AccordionSection>

          {/* Header */}
          <AccordionSection title="Header" icon="Store" open={openSection === "header"} onToggle={() => toggle("header")}>
            <LabelField
              label="Store name"
              hint="Defaults to your Shopify domain name"
              value={s.portalStoreName}
              placeholder={shop.split(".")[0]}
              onChange={v => set("portalStoreName", v)}
            />
            <CloudinaryLogoUploader
              value={s.logoUrl}
              onUpload={url => set("logoUrl", url)}
              onRemove={() => set("logoUrl", "")}
            />
          </AccordionSection>

          {/* Footer */}
          <AccordionSection title="Footer" icon="AlignBottom" open={openSection === "footer"} onToggle={() => toggle("footer")}>
            <LabelField
              label="Contact email"
              hint='Shown in the "Need help?" footer link'
              value={s.footerContact}
              placeholder={`support@${shop.split(".")[0]}.com`}
              onChange={v => set("footerContact", v)}
            />
          </AccordionSection>

          {/* Texts */}
          <AccordionSection title="Texts" icon="Type" open={openSection === "texts"} onToggle={() => toggle("texts")}>
            <TextsSection s={s} set={set} isPro={isPro} />
          </AccordionSection>
        </div>

        {/* Right — preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "#eceef2" }}>

          {/* Preview toolbar */}
          <div className="flex items-center justify-between px-5 py-2 border-b border-border bg-surface shrink-0 gap-3 flex-wrap">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg border border-border">
              {(["desktop", "mobile"] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDevice(d)}
                  className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-medium transition ${
                    device === d ? "bg-surface shadow-sm text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon name={d === "desktop" ? "Monitor" : "Smartphone"} size={12} />
                  {d === "desktop" ? "Desktop" : "Mobile"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted mr-1">Step</span>
              {STEPS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setPreviewStep(i + 1)}
                  title={label}
                  className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition ${
                    previewStep === i + 1
                      ? "bg-surface shadow-sm text-ink border border-border"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <button
              onClick={handleOpenPortal}
              disabled={isSaving || pendingOpen}
              className="flex items-center gap-1.5 text-[12px] font-medium transition disabled:opacity-50"
              style={{ color: isDirty ? "#F59E0B" : undefined }}
              title={isDirty ? "Va sauvegarder puis ouvrir le portal" : "Ouvrir le portal live"}
            >
              {pendingOpen
                ? <><Icon name="Loader2" size={12} className="animate-spin" /> Ouverture…</>
                : isDirty
                  ? <><Icon name="Save" size={12} /> Sauvegarder & ouvrir</>
                  : <><Icon name="ExternalLink" size={12} /> Portal live</>}
            </button>
          </div>

          {isDirty && !isSaving && (
            <div className="px-5 py-2 flex items-center gap-2 text-[11.5px] font-medium shrink-0"
                 style={{ background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}>
              <Icon name="TriangleAlert" size={12} style={{ color: "#F59E0B" }} />
              <span>Modifications non sauvegardées — le portal live affiche encore l'ancienne version.</span>
              <button onClick={doSave} className="ml-auto font-semibold underline hover:no-underline" style={{ color: "#F59E0B" }}>
                Sauvegarder maintenant
              </button>
            </div>
          )}

          {/* Scrollable preview area */}
          <div className="flex-1 overflow-y-auto flex items-start justify-center p-6 pt-8">
            <div
              className="transition-all duration-300 w-full"
              style={{ maxWidth: device === "mobile" ? 390 : 680 }}
            >
              {/* Browser / phone chrome */}
              {device === "desktop" ? (
                <div className="bg-[#1e2028] rounded-t-xl px-3 py-2 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  <div className="flex-1 mx-3 h-5 rounded bg-[#2a2d38] text-[10px] text-[#555] flex items-center px-2.5">
                    {shop}/apps/returns
                  </div>
                </div>
              ) : (
                <div className="bg-[#1e2028] rounded-t-2xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-[#555]">9:41</span>
                  <div className="w-20 h-1.5 rounded-full bg-[#2a2d38]" />
                  <span className="text-[10px] text-[#555]">●●●</span>
                </div>
              )}

              <PortalPreview settings={s} step={previewStep} shop={shop} device={device} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Layout picker ────────────────────────────────────────────────────────────

const LAYOUTS = [
  { key: "classic", label: "Classic" },
  { key: "minimal", label: "Minimal" },
  { key: "bold",    label: "Bold"    },
  { key: "sidebar", label: "Sidebar" },
  { key: "compact", label: "Compact" },
] as const;

function LayoutPicker({ value, brandColor, onChange }: {
  value: string; brandColor: string; onChange: (v: string) => void;
}) {
  return (
    <div className="px-4 py-4 border-b border-divider">
      <div className="text-[12px] font-semibold text-ink mb-0.5">Layout</div>
      <div className="text-[11px] text-muted mb-3">Visual arrangement of your portal</div>
      <div className="grid grid-cols-5 gap-1.5">
        {LAYOUTS.map(layout => (
          <button
            key={layout.key}
            onClick={() => onChange(layout.key)}
            className={`flex flex-col items-center gap-1.5 py-2 px-1 rounded-lg border-2 transition ${
              value === layout.key
                ? "border-accent bg-accent/5"
                : "border-transparent hover:border-border"
            }`}
          >
            <LayoutThumb layout={layout.key} brandColor={brandColor} active={value === layout.key} />
            <span className={`text-[9.5px] font-semibold leading-tight text-center ${
              value === layout.key ? "text-accent" : "text-muted"
            }`}>
              {layout.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LayoutThumb({ layout, brandColor, active }: { layout: string; brandColor: string; active: boolean }) {
  const c = active ? brandColor : "#c4c4d0";

  if (layout === "classic") return (
    <div style={{ width: 40, height: 30, borderRadius: 5, overflow: "hidden", border: "1px solid #e6e6ec", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 7, background: "#fff", borderBottom: "1px solid #e6e6ec", flexShrink: 0 }} />
      <div style={{ height: 5, display: "flex", alignItems: "center", gap: 2, padding: "0 4px", borderBottom: "1px solid #e6e6ec", flexShrink: 0 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ flex: 1, height: 2, borderRadius: 99, background: i === 0 ? c : "#e6e6ec" }} />)}
      </div>
      <div style={{ flex: 1, margin: "2px 2px", borderRadius: 3, background: "#fff", border: "1px solid #e6e6ec" }} />
    </div>
  );

  if (layout === "minimal") return (
    <div style={{ width: 40, height: 30, borderRadius: 5, overflow: "hidden", border: "1px solid #e6e6ec", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 2, background: c, flexShrink: 0 }} />
      <div style={{ padding: "2px 3px", flexShrink: 0 }}>
        <div style={{ height: 3, width: 14, borderRadius: 99, background: c + "50", marginBottom: 2 }} />
        <div style={{ display: "flex", gap: 2 }}>
          {[0,1,2,3,4].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: i === 0 ? c : "#e6e6ec" }} />)}
        </div>
      </div>
      <div style={{ flex: 1, margin: "0 2px 2px", borderRadius: 3, background: "#f8fafc", border: "1px solid #e6e6ec" }} />
    </div>
  );

  if (layout === "bold") return (
    <div style={{ width: 40, height: 30, borderRadius: 5, overflow: "hidden", border: "1px solid #e6e6ec", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "2px 3px 4px", background: c, flexShrink: 0 }}>
        <div style={{ height: 3, width: 18, borderRadius: 99, background: "rgba(255,255,255,0.8)", marginBottom: 2 }} />
        <div style={{ display: "flex", gap: 1.5 }}>
          {[0,1,2,3,4].map(i => <div key={i} style={{ flex: 1, height: 1.5, borderRadius: 99, background: i === 0 ? "#fff" : "rgba(255,255,255,0.35)" }} />)}
        </div>
      </div>
      <div style={{ flex: 1, margin: "-2px 3px 2px", borderRadius: 4, background: "#fff", border: "1px solid #e6e6ec", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }} />
    </div>
  );

  if (layout === "sidebar") return (
    <div style={{ width: 40, height: 30, borderRadius: 5, overflow: "hidden", border: "1px solid #e6e6ec", background: "#f8fafc", display: "flex" }}>
      <div style={{ width: 12, flexShrink: 0, background: c + "18", borderRight: "1px solid #e6e6ec", padding: "3px 2px", display: "flex", flexDirection: "column", gap: 2 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ height: 2, borderRadius: 99, background: i === 0 ? c : "#d1d5db" }} />)}
      </div>
      <div style={{ flex: 1, padding: 2 }}>
        <div style={{ height: 4, borderRadius: 3, background: c + "40", marginBottom: 2 }} />
        <div style={{ flex: 1, borderRadius: 3, background: "#fff", border: "1px solid #e6e6ec", height: 18 }} />
      </div>
    </div>
  );

  if (layout === "compact") return (
    <div style={{ width: 40, height: 30, borderRadius: 5, overflow: "hidden", border: "1px solid #e6e6ec", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 6, background: "#fff", borderBottom: "1px solid #e6e6ec", flexShrink: 0 }} />
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2.5, padding: "2px 0", flexShrink: 0 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: 3.5, height: 3.5, borderRadius: "50%", background: i === 0 ? c : "#e6e6ec" }} />)}
      </div>
      <div style={{ flex: 1, margin: "0 3px 3px", borderRadius: 3, background: "#fff", border: "1px solid #e6e6ec" }} />
    </div>
  );

  return null;
}

// ─── Texts section (accordion content) ───────────────────────────────────────

type SetFn = <K extends keyof EditorSettings>(k: K, v: EditorSettings[K]) => void;

const STEP_DEFS = [
  { n: 1, titleKey: "labelFindOrder",  descKey: "descFindOrder",  extra: [{ key: "labelCta",    placeholder: "Find Order",            label: "CTA button" }] },
  { n: 2, titleKey: "labelSelectItems",descKey: "descSelectItems", extra: [] },
  { n: 3, titleKey: "labelReasons",    descKey: "descReasons",    extra: [] },
  { n: 4, titleKey: "labelRefundType", descKey: "descRefundType", extra: [] },
  { n: 5, titleKey: "labelConfirm",    descKey: "descConfirm",    extra: [{ key: "labelSubmit", placeholder: "Submit Return Request", label: "Submit button" }] },
] as const;

const TITLE_PLACEHOLDERS: Record<string,string> = {
  labelFindOrder:  "Find your order",
  labelSelectItems:"Select items to return",
  labelReasons:    "Tell us why",
  labelRefundType: "How would you like to be refunded?",
  labelConfirm:    "Review & submit",
};
const DESC_PLACEHOLDERS: Record<string,string> = {
  descFindOrder:   "Enter your order number and the email used at checkout.",
  descSelectItems: "Select the items you'd like to return.",
  descReasons:     "Help us understand why you're returning each item.",
  descRefundType:  "Choose the option that works best for you.",
  descConfirm:     "One last look before we send this.",
};

function TextsSection({ s, set, isPro }: { s: EditorSettings; set: SetFn; isPro: boolean }) {
  const [tab, setTab]           = useState<"steps" | "general">("steps");
  const [editStep, setEditStep] = useState(1);

  const def = STEP_DEFS[editStep - 1];

  return (
    <div>
      {/* Sub-tab toggle */}
      <div className="flex gap-0.5 p-0.5 rounded-lg bg-bg border border-border mb-4">
        {(["steps", "general"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-7 rounded-md text-[12px] font-semibold transition capitalize ${
              tab === t ? "bg-surface shadow-sm text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t === "steps" ? "Steps" : "General"}
          </button>
        ))}
      </div>

      {tab === "steps" && (
        <div>
          {/* Mini step selector */}
          <div className="flex gap-1 mb-4">
            {STEP_DEFS.map(d => (
              <button
                key={d.n}
                onClick={() => setEditStep(d.n)}
                className={`flex-1 h-7 rounded-md text-[11.5px] font-semibold border transition ${
                  editStep === d.n
                    ? "bg-surface border-border shadow-sm text-ink"
                    : "border-transparent text-muted hover:border-border/60 hover:text-ink"
                }`}
              >
                {d.n}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <LabelField
              label={`Step ${def.n} — Title`}
              value={(s as any)[def.titleKey]}
              placeholder={TITLE_PLACEHOLDERS[def.titleKey]}
              onChange={v => set(def.titleKey as keyof EditorSettings, v)}
            />
            <LabelField
              label={`Step ${def.n} — Description`}
              value={(s as any)[def.descKey]}
              placeholder={DESC_PLACEHOLDERS[def.descKey]}
              onChange={v => set(def.descKey as keyof EditorSettings, v)}
            />
            {def.extra.map(e => (
              <LabelField
                key={e.key}
                label={e.label}
                value={(s as any)[e.key]}
                placeholder={e.placeholder}
                onChange={v => set(e.key as keyof EditorSettings, v)}
              />
            ))}
          </div>
        </div>
      )}

      {tab === "general" && (
        <div className="space-y-3">
          <LabelField
            label="Back to store"
            hint="Link in the portal header"
            value={s.labelBackToStore}
            placeholder="Back to store"
            onChange={v => set("labelBackToStore", v)}
          />
          <LabelField
            label="Can't find your order?"
            hint="Link below the order form"
            value={s.labelCantFind}
            placeholder="Can't find your order?"
            onChange={v => set("labelCantFind", v)}
          />
          <LabelField
            label="Start another return"
            hint="Shown on the success screen"
            value={s.labelStartAnother}
            placeholder="Start another return"
            onChange={v => set("labelStartAnother", v)}
          />
          <LabelField
            label="Tracking toggle"
            hint="Collapsible section in step 1"
            value={s.labelTrackingToggle}
            placeholder="Already shipped your return? Submit tracking"
            onChange={v => set("labelTrackingToggle", v)}
          />
          <div className={`relative ${!isPro ? 'opacity-50' : ''}`}>
            <LabelField
              label="Powered-by text"
              hint={isPro ? "Leave empty to hide (white-label)" : "Pro plan required to customize or hide"}
              value={isPro ? s.labelPoweredBy : "Secured by ReturnFlow"}
              placeholder="Secured by ReturnFlow"
              onChange={v => isPro && set("labelPoweredBy", v)}
            />
            {!isPro && (
              <div className="absolute inset-0 cursor-not-allowed" title="Pro plan required" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Accordion section ────────────────────────────────────────────────────────

function AccordionSection({
  title, icon, open, onToggle, children,
}: {
  title: string; icon: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-b border-divider">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-bg/60 transition"
      >
        <div className="flex items-center gap-2.5">
          <Icon name={icon} size={14} className="text-muted" />
          <span className="text-[13px] font-semibold text-ink">{title}</span>
        </div>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} className="text-faint" />
      </button>
      {open && <div className="px-4 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

// ─── Label / text field ───────────────────────────────────────────────────────

function LabelField({ label, hint, value, placeholder, onChange }: {
  label: string; hint?: string; value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-ink mb-0.5">{label}</div>
      {hint && <div className="text-[11px] text-muted mb-1.5">{hint}</div>}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full h-8 px-2.5 rounded-md border border-border bg-bg text-[12.5px] text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

// ─── Portal preview (dispatcher) ─────────────────────────────────────────────

function PortalPreview({ settings: s, step, shop, device }: {
  settings: EditorSettings; step: number; shop: string; device: "desktop" | "mobile";
}) {
  const wrapStyle: React.CSSProperties = {
    borderLeft:   "1px solid #e6e6ec",
    borderRight:  "1px solid #e6e6ec",
    borderBottom: "1px solid #e6e6ec",
    borderRadius: device === "mobile" ? "0 0 1.5rem 1.5rem" : "0 0 0.625rem 0.625rem",
    overflow: "hidden",
    fontFamily: "sans-serif",
    color: "#0f1117",
  };

  const layouts: Record<string, React.FC<{ s: EditorSettings; step: number; shop: string }>> = {
    classic: PreviewClassic,
    minimal: PreviewMinimal,
    bold:    PreviewBold,
    sidebar: PreviewSidebar,
    compact: PreviewCompact,
  };

  const Layout = layouts[s.portalLayout] ?? PreviewClassic;

  return (
    <div style={wrapStyle}>
      <Layout s={s} step={step} shop={shop} />
    </div>
  );
}

// ── Shared step content ───────────────────────────────────────────────────────

function StepContent({ s, step }: { s: EditorSettings; step: number }) {
  return (
    <>
      {step === 1 && <PreviewStep1 s={s} />}
      {step === 2 && <PreviewStep2 s={s} />}
      {step === 3 && <PreviewStep3 s={s} />}
      {step === 4 && <PreviewStep4 s={s} />}
      {step === 5 && <PreviewStep5 s={s} />}
    </>
  );
}

// ── Stepper (horizontal) ──────────────────────────────────────────────────────

function HStepper({ s, step, labels, light = false }: { s: EditorSettings; step: number; labels: string[]; light?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {labels.map((label, i) => {
        const idx    = i + 1;
        const isDone = idx < step;
        const isCurr = idx === step;
        const dotBg  = isDone ? s.brandColor : isCurr ? (light ? "#fff" : "#0f1117") : "transparent";
        const dotBorder = isDone || isCurr ? "none" : `1.5px solid ${light ? "rgba(255,255,255,0.4)" : "#d8dce5"}`;
        const dotColor  = isDone || isCurr ? (light && !isDone ? s.brandColor : "#fff") : (light ? "rgba(255,255,255,0.5)" : "#aaa");
        return (
          <React.Fragment key={label}>
            <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeContent: "center", fontSize: 10, fontWeight: 700, background: dotBg, border: dotBorder, color: dotColor, flexShrink: 0 }}>
                {isDone ? "✓" : idx}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 500, color: light ? (isCurr || isDone ? "#fff" : "rgba(255,255,255,0.5)") : (isCurr || isDone ? "#0f1117" : "#aaa") }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ flex: 1, height: 1, minWidth: 8, background: light ? (idx < step ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)") : (idx < step ? s.brandColor : "#e6e6ec") }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Layout: Classic ───────────────────────────────────────────────────────────

const STEP_LABELS_DEFAULT = ["Find Order", "Select Items", "Reason", "Refund Type", "Confirm"];

function PreviewClassic({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#F8FAFC" }}>
      <header style={{ background: s.bannerColor, borderBottom: "1px solid #e6e6ec" }}>
        <div style={{ padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {s.logoUrl ? (
              <img src={s.logoUrl} alt="Logo" style={{ height: 32, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, background: s.brandColor, display: "grid", placeContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f1117" }}>{storeName}</div>
              <div style={{ fontSize: 10.5, color: "#888" }}>Return Center</div>
            </div>
          </div>
          <span style={{ fontSize: 11.5, color: "#888" }}>← {s.labelBackToStore || "Back to store"}</span>
        </div>
      </header>
      <div style={{ padding: "20px 20px 24px" }}>
        <HStepper s={s} step={step} labels={STEP_LABELS_DEFAULT} />
        <div style={{ marginTop: 16, background: "#fff", borderRadius: 16, border: "1px solid #e6e6ec", boxShadow: "0 4px 20px rgba(15,17,23,0.05)", padding: "20px 24px" }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#888", marginTop: 16 }}>
          Need help? <span style={{ textDecoration: "underline", color: s.brandColor }}>{s.footerContact || `support@${shop.split(".")[0]}.com`}</span>
          <div style={{ marginTop: 6, fontSize: 10.5, color: "#aaa" }}>🔒 {s.labelPoweredBy || "Secured by ReturnFlow"}</div>
        </div>
      </div>
    </div>
  );
}

// ── Layout: Minimal ───────────────────────────────────────────────────────────

function PreviewMinimal({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#fff" }}>
      <div style={{ height: 3, background: s.brandColor }} />
      <div style={{ padding: "14px 24px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="Logo" style={{ height: 24, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0f1117" }}>{storeName}</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#aaa" }}>← {s.labelBackToStore || "Back to store"}</span>
      </div>
      <div style={{ padding: "0 24px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STEP_LABELS_DEFAULT.map((_, i) => {
            const idx = i + 1;
            const done = idx < step;
            const curr = idx === step;
            return (
              <React.Fragment key={i}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeContent: "center", fontSize: 10, fontWeight: 700, background: done ? s.brandColor : curr ? "#0f1117" : "#f0f0f5", color: done || curr ? "#fff" : "#aaa" }}>
                  {done ? "✓" : idx}
                </div>
                {i < STEP_LABELS_DEFAULT.length - 1 && <div style={{ flex: 1, height: 1, background: done ? s.brandColor : "#e6e6ec" }} />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <div style={{ padding: "0 16px 20px" }}>
        <div style={{ background: "#fafbfc", borderRadius: 12, border: "1px solid #e6e6ec", padding: "16px 20px" }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: "#aaa", marginTop: 12 }}>
          {s.labelPoweredBy || "Secured by ReturnFlow"}
        </div>
      </div>
    </div>
  );
}

// ── Layout: Bold ──────────────────────────────────────────────────────────────

function PreviewBold({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#F8FAFC" }}>
      <div style={{ background: s.brandColor, padding: "16px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {s.logoUrl ? (
              <img src={s.logoUrl} alt="Logo" style={{ height: 28, width: "auto", objectFit: "contain", filter: "brightness(10)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div style={{ background: "rgba(255,255,255,0.25)", borderRadius: 8, width: 28, height: 28, display: "grid", placeContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{storeName}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>Return Center</div>
            </div>
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>← {s.labelBackToStore || "Back to store"}</span>
        </div>
        <HStepper s={s} step={step} labels={STEP_LABELS_DEFAULT} light />
      </div>
      <div style={{ padding: "0 16px 20px", marginTop: -14 }}>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e6e6ec", boxShadow: "0 8px 30px rgba(15,17,23,0.1)", padding: "20px 24px" }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#888", marginTop: 14 }}>
          Need help? <span style={{ textDecoration: "underline", color: s.brandColor }}>{s.footerContact || `support@${shop.split(".")[0]}.com`}</span>
          <div style={{ marginTop: 4, fontSize: 10.5, color: "#aaa" }}>🔒 {s.labelPoweredBy || "Secured by ReturnFlow"}</div>
        </div>
      </div>
    </div>
  );
}

// ── Layout: Sidebar ───────────────────────────────────────────────────────────

function PreviewSidebar({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#F8FAFC", display: "flex", minHeight: 420 }}>
      {/* Left sidebar */}
      <div style={{ width: 180, flexShrink: 0, background: "#fff", borderRight: "1px solid #e6e6ec", padding: "20px 16px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 20 }}>
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="Logo" style={{ height: 24, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: 6, background: s.brandColor, display: "grid", placeContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: "#0f1117", lineHeight: 1.2 }}>{storeName}</div>
        </div>
        <div style={{ flex: 1 }}>
          {STEP_LABELS_DEFAULT.map((label, i) => {
            const idx  = i + 1;
            const done = idx < step;
            const curr = idx === step;
            return (
              <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeContent: "center", fontSize: 9, fontWeight: 700, background: done ? s.brandColor : curr ? "#0f1117" : "#f0f0f5", color: done || curr ? "#fff" : "#aaa", flexShrink: 0 }}>
                    {done ? "✓" : idx}
                  </div>
                  {i < STEP_LABELS_DEFAULT.length - 1 && <div style={{ width: 1, height: 16, background: done ? s.brandColor : "#e6e6ec", marginTop: 3 }} />}
                </div>
                <span style={{ fontSize: 11, fontWeight: curr ? 600 : 400, color: curr || done ? "#0f1117" : "#aaa", paddingTop: 3 }}>{label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "#aaa", marginTop: "auto" }}>{s.labelPoweredBy || "Secured by ReturnFlow"}</div>
      </div>

      {/* Right content */}
      <div style={{ flex: 1, padding: 20 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e6e6ec", boxShadow: "0 2px 12px rgba(15,17,23,0.04)", padding: "20px 24px", height: "100%" }}>
          <StepContent s={s} step={step} />
        </div>
      </div>
    </div>
  );
}

// ── Layout: Compact ───────────────────────────────────────────────────────────

function PreviewCompact({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#F8FAFC" }}>
      <header style={{ background: s.bannerColor || "#fff", borderBottom: "1px solid #e6e6ec", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="Logo" style={{ height: 22, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 22, height: 22, borderRadius: 5, background: s.brandColor, display: "grid", placeContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: "#0f1117" }}>{storeName}</span>
        </div>
        <span style={{ fontSize: 10.5, color: "#aaa" }}>← {s.labelBackToStore || "Back to store"}</span>
      </header>
      {/* Dot stepper */}
      <div style={{ padding: "10px 16px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {STEP_LABELS_DEFAULT.map((_, i) => {
          const idx  = i + 1;
          const done = idx < step;
          const curr = idx === step;
          return (
            <React.Fragment key={i}>
              <div style={{ width: done || curr ? 20 : 8, height: 8, borderRadius: 99, transition: "all 0.2s", background: done ? s.brandColor : curr ? "#0f1117" : "#e6e6ec", display: "grid", placeContent: "center", fontSize: 8, color: "#fff", fontWeight: 700 }}>
                {done ? "✓" : curr ? idx : ""}
              </div>
              {i < STEP_LABELS_DEFAULT.length - 1 && <div style={{ flex: 1, height: 1, maxWidth: 20, background: done ? s.brandColor : "#e6e6ec" }} />}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ padding: "10px 12px 16px" }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e6e6ec", boxShadow: "0 2px 10px rgba(15,17,23,0.05)", padding: "16px 18px" }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 10.5, color: "#aaa", marginTop: 10 }}>
          🔒 {s.labelPoweredBy || "Secured by ReturnFlow"}
        </div>
      </div>
    </div>
  );
}

// ─── Step previews ────────────────────────────────────────────────────────────

function PreviewStep1({ s }: { s: EditorSettings }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4, fontWeight: 600 }}>Step 1</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.02em", marginBottom: 4 }}>
        {s.labelFindOrder || "Find your order"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
        {s.descFindOrder || "Enter your order number and the email used at checkout."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18, maxWidth: 340 }}>
        <div style={{ height: 40, borderRadius: 8, border: "1.5px solid #d8dce5", background: "#f8fafc", padding: "0 12px", fontSize: 12.5, color: "#aaa", display: "flex", alignItems: "center" }}>#1089</div>
        <div style={{ height: 40, borderRadius: 8, border: "1.5px solid #d8dce5", background: "#f8fafc", padding: "0 12px", fontSize: 12.5, color: "#aaa", display: "flex", alignItems: "center" }}>your@email.com</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, textDecoration: "underline", color: s.brandColor, cursor: "default" }}>{s.labelCantFind || "Can't find your order?"}</span>
        <button style={{ height: 40, padding: "0 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#fff", background: s.brandColor, border: "none", display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
          {s.labelCta || "Find Order"} →
        </button>
      </div>
    </div>
  );
}

function PreviewStep2({ s }: { s: EditorSettings }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4, fontWeight: 600 }}>Step 2</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.02em", marginBottom: 4 }}>
        {s.labelSelectItems || "Select items to return"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>
        {s.descSelectItems || "Select the items you'd like to return."} From order <strong style={{ color: "#0f1117" }}>#1089</strong> · Jan 15, 2026.
      </p>
      {[{ name: "Classic Tee", variant: "Black / M", price: "$42.00", selected: true }, { name: "Running Shorts", variant: "Navy / S", price: "$38.00", selected: false }].map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: `2px solid ${item.selected ? s.brandColor : "#e6e6ec"}`, background: item.selected ? s.brandColor + "08" : "#fff", marginBottom: 8 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, background: item.selected ? s.brandColor : "#fff", border: item.selected ? "none" : "1.5px solid #d8dce5", display: "grid", placeContent: "center", flexShrink: 0 }}>
            {item.selected && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
          </div>
          <div style={{ width: 44, height: 44, borderRadius: 8, background: "#f0f0f5", border: "1px solid #e6e6ec", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f1117" }}>{item.name}</div>
            <div style={{ fontSize: 11.5, color: "#666" }}>{item.variant}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{item.price}</div>
        </div>
      ))}
    </div>
  );
}

function PreviewStep3({ s }: { s: EditorSettings }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4, fontWeight: 600 }}>Step 3</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.02em", marginBottom: 4 }}>
        {s.labelReasons || "Tell us why"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>{s.descReasons || "Help us understand why you're returning each item."}</p>
      <div style={{ padding: 14, borderRadius: 12, border: "1px solid #e6e6ec", background: "#fafbfc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f0f0f5", border: "1px solid #e6e6ec", flexShrink: 0 }} />
          <div><div style={{ fontSize: 13, fontWeight: 600 }}>Classic Tee</div><div style={{ fontSize: 11.5, color: "#666" }}>Black / M</div></div>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: "#444", marginBottom: 5 }}>Select reason</div>
        <div style={{ height: 38, borderRadius: 8, border: "1.5px solid #d8dce5", background: "#fff", padding: "0 12px", fontSize: 12.5, color: "#aaa", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Choose a reason… <span>▾</span>
        </div>
      </div>
    </div>
  );
}

function PreviewStep4({ s }: { s: EditorSettings }) {
  const opts = [
    { icon: "CreditCard", label: "Refund to original payment", desc: "5–10 business days", sel: true },
    { icon: "Gift",       label: "Store credit",               desc: "Available instantly",         sel: false },
    { icon: "RefreshCw",  label: "Exchange for another item",  desc: "Once we receive your return", sel: false },
  ];
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4, fontWeight: 600 }}>Step 4</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.02em", marginBottom: 4 }}>
        {s.labelRefundType || "How would you like to be refunded?"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>{s.descRefundType || "Choose the option that works best for you."}</p>
      {opts.map((opt, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, border: `2px solid ${opt.sel ? s.brandColor : "#e6e6ec"}`, background: opt.sel ? s.brandColor + "08" : "#fff", marginBottom: 8 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, display: "grid", placeContent: "center", background: opt.sel ? s.brandColor : "#f0f0f5", flexShrink: 0, color: opt.sel ? "#fff" : "#555" }}>
            <Icon name={opt.icon} size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f1117" }}>{opt.label}</div>
            <div style={{ fontSize: 11.5, color: "#666" }}>{opt.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewStep5({ s }: { s: EditorSettings }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4, fontWeight: 600 }}>Step 5</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.02em", marginBottom: 4 }}>
        {s.labelConfirm || "Review & submit"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#666", marginBottom: 16 }}>{s.descConfirm || "One last look before we send this."}</p>
      <div style={{ display: "flex", gap: 10, padding: 14, borderRadius: 12, border: "1px solid #e6e6ec", marginBottom: 10 }}>
        <div style={{ width: 52, height: 52, borderRadius: 8, background: "#f0f0f5", border: "1px solid #e6e6ec", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Classic Tee</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>$42.00</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#666" }}>Black / M · Qty 1</div>
          <span style={{ display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 4, background: "#f0f0f5", fontSize: 11, color: "#444" }}>Does not fit</span>
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fafbfc", border: "1px solid #e6e6ec", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#666" }}><span>Subtotal</span><span>$42.00</span></div>
        <div style={{ borderTop: "1px solid #e6e6ec", margin: "8px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}><span>Estimated refund</span><span>$42.00</span></div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button style={{ height: 38, padding: "0 14px", borderRadius: 8, fontSize: 12.5, color: "#666", background: "transparent", border: "none", cursor: "default" }}>← Back</button>
        <button style={{ height: 38, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#fff", background: s.brandColor, border: "none", display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
          ✓ {s.labelSubmit || "Submit Return Request"}
        </button>
      </div>
    </div>
  );
}
