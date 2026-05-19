import React, { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { uploadToCloudinary, deleteFromCloudinary, isCloudinaryUrl } from "../lib/cloudinary.server";
import { getShopPlan, planAtLeast, syncBillingFromShopify } from "../lib/plan.server";
import { Icon, useToast, ColorPicker, CloudinaryLogoUploader, Toggle } from "../components/ui";

// ─── Constants ───────────────────────────────────────────────────────────────

// Lucide icon names available for the chat bubble. Picked for visual variety
// (round, square, with dots, mail, headphones, lifebuoy).
const CHAT_ICON_CHOICES = [
  "MessageCircle",
  "MessageSquare",
  "MessageCircleMore",
  "Mail",
  "Headphones",
  "LifeBuoy",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type EditorSettings = {
  portalLayout: string;
  brandColor: string;
  bannerColor: string;
  logoUrl: string;
  portalStoreName: string;
  footerContact: string;
  labelFindOrder: string;
  labelSelectItems: string;
  labelReasons: string;
  labelRefundType: string;
  labelConfirm: string;
  labelCta: string;
  labelSubmit: string;
  descFindOrder: string;
  descSelectItems: string;
  descReasons: string;
  descRefundType: string;
  descConfirm: string;
  labelBackToStore: string;
  labelCantFind: string;
  labelStartAnother: string;
  labelPoweredBy: string;
  labelTrackingToggle: string;
  liveChatEnabled: boolean;
  liveChatIcon: string;
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Sync directly here (instead of just reading via getShopPlan) so we don't
  // race with the parent app.tsx loader on direct/refresh loads of this page.
  const [s, plan] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }).then(r => r ?? prisma.shopSettings.create({ data: { shop } })),
    syncBillingFromShopify(admin, shop),
  ]);

  return {
    shop,
    plan,
    initial: {
      portalLayout: s.portalLayout,
      brandColor: s.brandColor,
      bannerColor: s.bannerColor,
      logoUrl: s.logoUrl ?? "",
      portalStoreName: s.portalStoreName,
      footerContact: s.footerContact,
      labelFindOrder: s.labelFindOrder,
      labelSelectItems: s.labelSelectItems,
      labelReasons: s.labelReasons,
      labelRefundType: s.labelRefundType,
      labelConfirm: s.labelConfirm,
      labelCta: s.labelCta,
      labelSubmit: s.labelSubmit,
      descFindOrder: s.descFindOrder,
      descSelectItems: s.descSelectItems,
      descReasons: s.descReasons,
      descRefundType: s.descRefundType,
      descConfirm: s.descConfirm,
      labelBackToStore: s.labelBackToStore,
      labelCantFind: s.labelCantFind,
      labelStartAnother: s.labelStartAnother,
      labelPoweredBy: s.labelPoweredBy,
      labelTrackingToggle: s.labelTrackingToggle,
      liveChatEnabled: (s as any).liveChatEnabled ?? true,
      liveChatIcon: (s as any).liveChatIcon ?? "MessageCircle",
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
      await deleteFromCloudinary(previousUrl).catch(() => { });
    }
    const { url } = await uploadToCloudinary(base64);
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: url } });
    return { logoUrl: url };
  }

  if (intent === "remove_logo") {
    const logoUrl = fd.get("logoUrl") as string;
    if (isCloudinaryUrl(logoUrl)) {
      await deleteFromCloudinary(logoUrl).catch(() => { });
    }
    await prisma.shopSettings.update({ where: { shop }, data: { logoUrl: null } });
    return { removed: true };
  }

  await prisma.shopSettings.update({
    where: { shop },
    data: {
      portalLayout: fd.get("portalLayout") as string,
      brandColor: fd.get("brandColor") as string,
      bannerColor: fd.get("bannerColor") as string,
      logoUrl: (fd.get("logoUrl") as string) || null,
      portalStoreName: fd.get("portalStoreName") as string,
      footerContact: fd.get("footerContact") as string,
      labelFindOrder: fd.get("labelFindOrder") as string,
      labelSelectItems: fd.get("labelSelectItems") as string,
      labelReasons: fd.get("labelReasons") as string,
      labelRefundType: fd.get("labelRefundType") as string,
      labelConfirm: fd.get("labelConfirm") as string,
      labelCta: fd.get("labelCta") as string,
      labelSubmit: fd.get("labelSubmit") as string,
      descFindOrder: fd.get("descFindOrder") as string,
      descSelectItems: fd.get("descSelectItems") as string,
      descReasons: fd.get("descReasons") as string,
      descRefundType: fd.get("descRefundType") as string,
      descConfirm: fd.get("descConfirm") as string,
      labelBackToStore: fd.get("labelBackToStore") as string,
      labelCantFind: fd.get("labelCantFind") as string,
      labelStartAnother: fd.get("labelStartAnother") as string,
      labelPoweredBy: fd.get("labelPoweredBy") as string,
      labelTrackingToggle: fd.get("labelTrackingToggle") as string,
      liveChatEnabled: fd.get("liveChatEnabled") === "true",
      liveChatIcon: (fd.get("liveChatIcon") as string) || "MessageCircle",
    } as any,
  });

  return { success: true };
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PortalEditorPage() {
  const { initial, shop, plan } = useLoaderData<typeof loader>();
  const isStarter = plan === 'starter' || plan === 'pro';
  const isPro = plan === 'pro';
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const toast = useToast();
  const location = useLocation();
  const billingHref = `/app/billing${location.search}`;

  const [s, setS] = useState<EditorSettings>(initial);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewStep, setPreviewStep] = useState(1);
  const [openSection, setOpenSection] = useState("layout");
  const [pendingOpen, setPendingOpen] = useState(false);

  const isSaving = navigation.state === "submitting";
  const isDirty = JSON.stringify(s) !== JSON.stringify(initial);

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
          <Link to={billingHref}
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#F59E0B' }}>
            Upgrade <Icon name="ArrowRight" size={12} />
          </Link>
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

          {/* Live chat */}
          <AccordionSection
            title="Live chat"
            icon="MessageCircle"
            open={openSection === "livechat"}
            onToggle={() => toggle("livechat")}
            badge={!isPro ? "Pro" : undefined}
          >
            <div className={`relative ${!isPro ? 'opacity-60' : ''}`}>
              <Toggle
                checked={isPro && s.liveChatEnabled}
                onChange={(v: boolean) => isPro && set("liveChatEnabled", v)}
                label="Enable live chat on portal"
                description={isPro
                  ? "Show a floating chat button so customers can message you directly from the return portal."
                  : "Show a floating chat button so customers can message you directly from the return portal. Pro plan required."}
              />
              {!isPro && (
                <div className="absolute inset-0 cursor-not-allowed" title="Pro plan required" />
              )}
            </div>

            {/* Icon picker — only meaningful when chat is enabled */}
            {isPro && s.liveChatEnabled && (
              <div className="mt-4">
                <div className="text-[12px] font-semibold text-ink mb-0.5">Bubble icon</div>
                <div className="text-[11px] text-muted mb-2">Shown on the floating chat button</div>
                <div className="grid grid-cols-6 gap-1.5">
                  {CHAT_ICON_CHOICES.map(name => {
                    const selected = s.liveChatIcon === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => set("liveChatIcon", name)}
                        title={name}
                        className={`h-10 grid place-content-center rounded-md border-2 transition ${selected
                            ? "border-accent bg-accent/10 text-accent2"
                            : "border-transparent bg-bg/40 hover:bg-bg/80 text-ink"
                          }`}
                      >
                        <Icon name={name} size={16} strokeWidth={2.25} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isPro && (
              <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-md border border-divider bg-bg/40">
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <Icon name="Lock" size={13} className="text-faint" />
                  Live chat with customers is a Pro feature.
                </div>
                <Link to={billingHref}
                  className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[12px] font-semibold text-white"
                  style={{ background: 'linear-gradient(90deg,#6C63FF,#8B5CF6)' }}>
                  Upgrade <Icon name="ArrowRight" size={12} />
                </Link>
              </div>
            )}
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
                  className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-medium transition ${device === d ? "bg-surface shadow-sm text-ink" : "text-muted hover:text-ink"
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
                  className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition ${previewStep === i + 1
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

              <PortalPreview settings={s} step={previewStep} shop={shop} device={device} chatEnabled={isPro && s.liveChatEnabled} />
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
  { key: "bold", label: "Bold" },
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
            className={`flex flex-col items-center gap-1.5 py-2 px-1 rounded-lg border-2 transition ${value === layout.key
                ? "border-accent bg-accent/5"
                : "border-transparent hover:border-border"
              }`}
          >
            <LayoutThumb layout={layout.key} brandColor={brandColor} active={value === layout.key} />
            <span className={`text-[9.5px] font-semibold leading-tight text-center ${value === layout.key ? "text-accent" : "text-muted"
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
  const surface = "#f4f6fa";

  if (layout === "classic") return (
    <div style={{ width: 42, height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #e6e6ec", background: surface, display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(15,17,23,0.04)" }}>
      <div style={{ height: 8, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", paddingLeft: 3, gap: 2 }}>
        <div style={{ width: 4, height: 4, borderRadius: 1.5, background: c }} />
        <div style={{ width: 8, height: 2, borderRadius: 99, background: "#d8dce5" }} />
      </div>
      <div style={{ height: 1, background: c, opacity: 0.55 }} />
      <div style={{ height: 5, display: "flex", alignItems: "center", gap: 1.5, padding: "0 4px", flexShrink: 0, marginTop: 1.5 }}>
        <div style={{ width: 3, height: 3, borderRadius: "50%", background: c }} />
        <div style={{ flex: 1, height: 1.5, borderRadius: 99, background: c, opacity: 0.5 }} />
        <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#0f1117" }} />
        <div style={{ flex: 1, height: 1.5, borderRadius: 99, background: "#e6e6ec" }} />
        <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#e6e6ec" }} />
      </div>
      <div style={{ flex: 1, margin: "2px 3px 3px", borderRadius: 3, background: "#fff", border: "1px solid #e6e6ec", boxShadow: "0 1px 2px rgba(15,17,23,0.03)" }} />
    </div>
  );

  if (layout === "minimal") return (
    <div style={{ width: 42, height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #e6e6ec", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 1.5, background: c, flexShrink: 0 }} />
      <div style={{ padding: "3px 4px 0", flexShrink: 0 }}>
        <div style={{ height: 2, width: 12, borderRadius: 99, background: "#0f1117", marginBottom: 3 }} />
        <div style={{ height: 1.5, borderRadius: 99, background: "#eef0f4", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, width: "22%", background: c, borderRadius: 99 }} />
        </div>
      </div>
      <div style={{ flex: 1, padding: "3px 4px 4px", display: "flex", flexDirection: "column", gap: 1.5, justifyContent: "center" }}>
        <div style={{ height: 2.5, width: "60%", borderRadius: 99, background: "#0f1117" }} />
        <div style={{ height: 1.5, width: "85%", borderRadius: 99, background: "#d8dce5" }} />
        <div style={{ height: 1.5, width: "70%", borderRadius: 99, background: "#d8dce5" }} />
      </div>
    </div>
  );

  if (layout === "bold") return (
    <div style={{ width: 42, height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #e6e6ec", background: surface, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "3px 4px 5px", background: `linear-gradient(135deg, ${c}, ${c}cc)`, flexShrink: 0, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -3, right: -3, width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
        <div style={{ height: 2.5, width: 14, borderRadius: 99, background: "rgba(255,255,255,0.95)", marginBottom: 2.5, position: "relative" }} />
        <div style={{ display: "flex", gap: 1.5, position: "relative" }}>
          {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ flex: 1, height: 1.5, borderRadius: 99, background: i === 0 ? "#fff" : "rgba(255,255,255,0.4)" }} />)}
        </div>
      </div>
      <div style={{ flex: 1, margin: "-3px 3px 3px", borderRadius: 4, background: "#fff", border: "1px solid #e6e6ec", boxShadow: `0 2px 8px -2px ${c}40` }} />
    </div>
  );

  if (layout === "sidebar") return (
    <div style={{ width: 42, height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #e6e6ec", background: surface, display: "flex" }}>
      <div style={{ width: 14, flexShrink: 0, background: "#fff", borderRight: "1px solid #e6e6ec", padding: "3px 2px", display: "flex", flexDirection: "column", gap: 1.5 }}>
        <div style={{ width: 4, height: 4, borderRadius: 1.5, background: c, marginBottom: 1 }} />
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 1.5, height: 2.5, paddingLeft: 1, background: i === 0 ? `${c}25` : "transparent", borderRadius: 1.5 }}>
            <div style={{ width: 1.5, height: 1.5, borderRadius: "50%", background: i === 0 ? c : "#d8dce5" }} />
            <div style={{ flex: 1, height: 1, borderRadius: 99, background: i === 0 ? c : "#d8dce5", opacity: i === 0 ? 1 : 0.6 }} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: 2.5 }}>
        <div style={{ height: 1.5, width: "50%", borderRadius: 99, background: "#d8dce5", marginBottom: 2 }} />
        <div style={{ height: 20, borderRadius: 3, background: "#fff", border: "1px solid #e6e6ec", boxShadow: "0 1px 2px rgba(15,17,23,0.04)" }} />
      </div>
    </div>
  );

  if (layout === "compact") return (
    <div style={{ width: 42, height: 32, borderRadius: 6, overflow: "hidden", border: "1px solid #e6e6ec", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 1.5, background: "#eef0f4", position: "relative", flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0, width: "40%", background: c }} />
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.85)", borderBottom: "1px solid #eef0f4", flexShrink: 0, display: "flex", alignItems: "center", padding: "0 3px", gap: 2 }}>
        <div style={{ width: 3, height: 3, borderRadius: 1, background: c }} />
        <div style={{ width: 6, height: 1.5, borderRadius: 99, background: "#d8dce5" }} />
      </div>
      <div style={{ flex: 1, margin: 3, borderRadius: 3, background: "#fafbfc", border: "1px solid #e6e6ec" }} />
    </div>
  );

  return null;
}

// ─── Texts section (accordion content) ───────────────────────────────────────

type SetFn = <K extends keyof EditorSettings>(k: K, v: EditorSettings[K]) => void;

const STEP_DEFS = [
  { n: 1, titleKey: "labelFindOrder", descKey: "descFindOrder", extra: [{ key: "labelCta", placeholder: "Find Order", label: "CTA button" }] },
  { n: 2, titleKey: "labelSelectItems", descKey: "descSelectItems", extra: [] },
  { n: 3, titleKey: "labelReasons", descKey: "descReasons", extra: [] },
  { n: 4, titleKey: "labelRefundType", descKey: "descRefundType", extra: [] },
  { n: 5, titleKey: "labelConfirm", descKey: "descConfirm", extra: [{ key: "labelSubmit", placeholder: "Submit Return Request", label: "Submit button" }] },
] as const;

const TITLE_PLACEHOLDERS: Record<string, string> = {
  labelFindOrder: "Find your order",
  labelSelectItems: "Select items to return",
  labelReasons: "Tell us why",
  labelRefundType: "How would you like to be refunded?",
  labelConfirm: "Review & submit",
};
const DESC_PLACEHOLDERS: Record<string, string> = {
  descFindOrder: "Enter your order number and the email used at checkout.",
  descSelectItems: "Select the items you'd like to return.",
  descReasons: "Help us understand why you're returning each item.",
  descRefundType: "Choose the option that works best for you.",
  descConfirm: "One last look before we send this.",
};

function TextsSection({ s, set, isPro }: { s: EditorSettings; set: SetFn; isPro: boolean }) {
  const [tab, setTab] = useState<"steps" | "general">("steps");
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
            className={`flex-1 h-7 rounded-md text-[12px] font-semibold transition capitalize ${tab === t ? "bg-surface shadow-sm text-ink" : "text-muted hover:text-ink"
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
                className={`flex-1 h-7 rounded-md text-[11.5px] font-semibold border transition ${editStep === d.n
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
              value={isPro ? s.labelPoweredBy : "Secured by TrackBack"}
              placeholder="Secured by TrackBack"
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
  title, icon, open, onToggle, children, badge,
}: {
  title: string; icon: string; open: boolean; onToggle: () => void; children: React.ReactNode; badge?: string;
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
          {badge && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset"
              style={{ background: 'rgba(108,99,255,0.14)', color: '#8B85FF', borderColor: 'rgba(108,99,255,0.25)' }}>
              {badge}
            </span>
          )}
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

function PortalPreview({ settings: s, step, shop, device, chatEnabled }: {
  settings: EditorSettings; step: number; shop: string; device: "desktop" | "mobile"; chatEnabled: boolean;
}) {
  const wrapStyle: React.CSSProperties = {
    position: "relative", // anchor for the chat bubble overlay
    borderLeft: "1px solid #e6e6ec",
    borderRight: "1px solid #e6e6ec",
    borderBottom: "1px solid #e6e6ec",
    borderRadius: device === "mobile" ? "0 0 1.5rem 1.5rem" : "0 0 0.625rem 0.625rem",
    overflow: "hidden",
    fontFamily: "sans-serif",
    color: "#0f1117",
  };

  const layouts: Record<string, React.FC<{ s: EditorSettings; step: number; shop: string }>> = {
    classic: PreviewClassic,
    minimal: PreviewMinimal,
    bold: PreviewBold,
    sidebar: PreviewSidebar,
    compact: PreviewCompact,
  };

  const Layout = layouts[s.portalLayout] ?? PreviewClassic;

  return (
    <div style={wrapStyle}>
      <Layout s={s} step={step} shop={shop} />
      {chatEnabled && (
        <PreviewChatBubble brandColor={s.brandColor} iconName={s.liveChatIcon} />
      )}
    </div>
  );
}

// Static visual stand-in for the live ChatWidget — appears in the preview
// canvas so merchants can see exactly what their customers will get.
function PreviewChatBubble({ brandColor, iconName }: { brandColor: string; iconName: string }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 14,
        bottom: 14,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: brandColor,
        display: "grid",
        placeContent: "center",
        color: "#fff",
        boxShadow: `0 10px 24px -6px ${brandColor}80, 0 0 0 1px rgba(255,255,255,0.08) inset`,
        pointerEvents: "none", // the preview is non-interactive
        zIndex: 5,
      }}
    >
      <Icon name={iconName} size={18} strokeWidth={2.25} />
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
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {labels.map((label, i) => {
        const idx = i + 1;
        const isDone = idx < step;
        const isCurr = idx === step;

        const dotBg = isDone
          ? s.brandColor
          : isCurr
            ? (light ? "#fff" : "#0f1117")
            : (light ? "rgba(255,255,255,0.10)" : "#fff");
        const dotBorder = !isDone && !isCurr
          ? (light ? "1.5px solid rgba(255,255,255,0.3)" : "1.5px solid #e2e5ec")
          : "none";
        const dotColor = isDone
          ? "#fff"
          : isCurr
            ? (light ? s.brandColor : "#fff")
            : (light ? "rgba(255,255,255,0.55)" : "#94a3b8");
        const dotShadow = isCurr
          ? (light
            ? "0 0 0 4px rgba(255,255,255,0.18), 0 4px 12px -2px rgba(0,0,0,0.15)"
            : `0 0 0 4px ${s.brandColor}24, 0 4px 12px -2px rgba(15,17,23,0.18)`)
          : isDone
            ? `0 2px 6px -2px ${s.brandColor}55`
            : "none";
        const labelColor = light
          ? (isCurr || isDone ? "#fff" : "rgba(255,255,255,0.55)")
          : (isCurr ? "#0f1117" : isDone ? "#475569" : "#94a3b8");

        const lineColor = light
          ? (idx < step ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.18)")
          : (idx < step ? s.brandColor : "#eef0f4");

        return (
          <React.Fragment key={label}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <div style={{
                width: isCurr ? 22 : 20,
                height: isCurr ? 22 : 20,
                borderRadius: "50%",
                display: "grid",
                placeContent: "center",
                fontSize: 10,
                fontWeight: 700,
                background: dotBg,
                border: dotBorder,
                color: dotColor,
                boxShadow: dotShadow,
                flexShrink: 0,
                transition: "all 0.25s ease",
              }}>
                {isDone ? "✓" : idx}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: isCurr ? 700 : 500, color: labelColor, letterSpacing: "-0.005em" }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ flex: 1, height: 2, minWidth: 10, borderRadius: 99, background: lineColor, transition: "background 0.3s ease" }} />
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
    <div style={{ background: "#F7F8FB" }}>
      <header style={{ position: "relative", background: s.bannerColor || "#fff", borderBottom: "1px solid #eef0f4" }}>
        <div style={{ padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {s.logoUrl ? (
              <img src={s.logoUrl} alt="Logo" style={{ height: 34, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#fff",
                display: "grid", placeContent: "center",
                color: s.brandColor, fontSize: 14, fontWeight: 800,
                boxShadow: `0 0 0 1px ${s.brandColor}33, 0 6px 16px -4px ${s.brandColor}40`,
              }}>
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.01em", lineHeight: 1.15 }}>{storeName}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginTop: 1 }}>Return Center</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#475569", padding: "6px 11px", borderRadius: 99, background: "rgba(15,23,42,0.04)" }}>
            <span style={{ fontSize: 11 }}>←</span> {s.labelBackToStore || "Back to store"}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${s.brandColor}, transparent)`, opacity: 0.55 }} />
      </header>
      <div style={{ padding: "24px 24px 28px" }}>
        <HStepper s={s} step={step} labels={STEP_LABELS_DEFAULT} />
        <div style={{
          marginTop: 20,
          background: "#fff",
          borderRadius: 18,
          border: "1px solid #eef0f4",
          boxShadow: "0 1px 2px rgba(15,17,23,0.04), 0 10px 28px -10px rgba(15,17,23,0.10)",
          padding: "24px 26px",
        }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#94a3b8", marginTop: 18 }}>
          Need help? <span style={{ textDecoration: "underline", color: s.brandColor, fontWeight: 500 }}>{s.footerContact || `support@${shop.split(".")[0]}.com`}</span>
          <div style={{ marginTop: 5, fontSize: 10.5, color: "#cbd5e1", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span>🔒</span> {s.labelPoweredBy || "Secured by TrackBack"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout: Minimal ───────────────────────────────────────────────────────────

function PreviewMinimal({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  const total = STEP_LABELS_DEFAULT.length;
  const pct = ((step - 1) / (total - 1)) * 100;
  return (
    <div style={{ background: "#fff" }}>
      <div style={{ height: 2, background: `linear-gradient(90deg, ${s.brandColor}, ${s.brandColor}55, transparent)` }} />
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "22px 28px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {s.logoUrl ? (
          <img src={s.logoUrl} alt="Logo" style={{ height: 26, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <span style={{ fontSize: 15.5, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.025em" }}>{storeName}</span>
        )}
        <span style={{ fontSize: 11, color: "#94a3b8" }}>← {s.labelBackToStore || "Back to store"}</span>
      </div>
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "12px 28px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#0f1117", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            Step {step} <span style={{ color: "#cbd5e1" }}> / {total}</span>
          </span>
          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>{STEP_LABELS_DEFAULT[step - 1]}</span>
        </div>
        <div style={{ height: 3, borderRadius: 99, background: "#eef0f4", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${s.brandColor}, ${s.brandColor}aa)`, borderRadius: 99, transition: "width 0.4s ease" }} />
        </div>
      </div>
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "0 28px 32px" }}>
        <StepContent s={s} step={step} />
        <div style={{ textAlign: "center", fontSize: 10, color: "#cbd5e1", marginTop: 26, letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <span>🔒</span> {s.labelPoweredBy || "Secured by TrackBack"}
        </div>
      </div>
    </div>
  );
}

// ── Layout: Bold ──────────────────────────────────────────────────────────────

function PreviewBold({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#F7F8FB" }}>
      <div style={{
        position: "relative",
        background: `linear-gradient(135deg, ${s.brandColor} 0%, color-mix(in srgb, ${s.brandColor} 75%, #000) 100%)`,
        padding: "22px 24px 48px",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -50, right: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.10)", filter: "blur(8px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -40, left: -30, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.06)", filter: "blur(4px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {s.logoUrl ? (
              <img src={s.logoUrl} alt="Logo" style={{ height: 30, width: "auto", objectFit: "contain", filter: "brightness(10)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div style={{
                background: "rgba(255,255,255,0.18)",
                borderRadius: 10, width: 34, height: 34,
                display: "grid", placeContent: "center",
                color: "#fff", fontSize: 14, fontWeight: 800,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25), 0 4px 14px -2px rgba(0,0,0,0.2)",
              }}>
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.15 }}>{storeName}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginTop: 1 }}>Return Center</div>
            </div>
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", padding: "5px 11px", borderRadius: 99, background: "rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)" }}>← {s.labelBackToStore || "Back to store"}</span>
        </div>
        <div style={{ position: "relative" }}>
          <HStepper s={s} step={step} labels={STEP_LABELS_DEFAULT} light />
        </div>
      </div>
      <div style={{ padding: "0 18px 24px", marginTop: -28 }}>
        <div style={{
          background: "#fff",
          borderRadius: 20,
          border: "1px solid rgba(15,17,23,0.04)",
          boxShadow: `0 24px 48px -16px ${s.brandColor}33, 0 4px 12px -4px rgba(15,17,23,0.08)`,
          padding: "24px 26px",
        }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#94a3b8", marginTop: 18 }}>
          Need help? <span style={{ textDecoration: "underline", color: s.brandColor, fontWeight: 500 }}>{s.footerContact || `support@${shop.split(".")[0]}.com`}</span>
          <div style={{ marginTop: 5, fontSize: 10.5, color: "#cbd5e1" }}>🔒 {s.labelPoweredBy || "Secured by TrackBack"}</div>
        </div>
      </div>
    </div>
  );
}

// ── Layout: Sidebar ───────────────────────────────────────────────────────────

function PreviewSidebar({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  return (
    <div style={{ background: "#FAFBFD", display: "flex", minHeight: 460 }}>
      {/* Left sidebar */}
      <div style={{
        width: 210, flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid #eef0f4",
        padding: "22px 14px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 24, padding: "0 4px" }}>
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="Logo" style={{ height: 26, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: s.brandColor,
              display: "grid", placeContent: "center",
              color: "#fff", fontSize: 13, fontWeight: 800, flexShrink: 0,
              boxShadow: `0 4px 12px -2px ${s.brandColor}50`,
            }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f1117", lineHeight: 1.15 }}>{storeName}</div>
            <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, marginTop: 1 }}>Returns</div>
          </div>
        </div>

        <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8, paddingLeft: 8 }}>
          Your return
        </div>
        <div style={{ flex: 1 }}>
          {STEP_LABELS_DEFAULT.map((label, i) => {
            const idx = i + 1;
            const done = idx < step;
            const curr = idx === step;
            return (
              <div key={label} style={{
                position: "relative",
                display: "flex", alignItems: "center", gap: 9,
                padding: "7px 8px",
                borderRadius: 8,
                background: curr ? `${s.brandColor}10` : "transparent",
                marginBottom: 2,
              }}>
                {curr && (
                  <div style={{ position: "absolute", left: 0, top: "22%", bottom: "22%", width: 2.5, borderRadius: 99, background: s.brandColor }} />
                )}
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  display: "grid", placeContent: "center",
                  fontSize: 9.5, fontWeight: 700,
                  background: done ? s.brandColor : curr ? "#0f1117" : "#f1f5f9",
                  color: done || curr ? "#fff" : "#94a3b8",
                  flexShrink: 0,
                  boxShadow: done ? `0 2px 6px -2px ${s.brandColor}66` : "none",
                }}>
                  {done ? "✓" : idx}
                </div>
                <span style={{ fontSize: 11, fontWeight: curr ? 700 : 500, color: curr ? "#0f1117" : done ? "#475569" : "#94a3b8", letterSpacing: "-0.005em" }}>{label}</span>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid #eef0f4", marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 10.5, color: "#475569", display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span>←</span> {s.labelBackToStore || "Back to store"}
          </div>
          <div style={{ fontSize: 9.5, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 4 }}>
            <span>🔒</span> {s.labelPoweredBy || "Secured by TrackBack"}
          </div>
        </div>
      </div>

      {/* Right content */}
      <div style={{ flex: 1, padding: "24px 26px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>
          <span>Returns</span>
          <span style={{ color: "#cbd5e1" }}>/</span>
          <span style={{ color: "#0f1117", fontWeight: 600 }}>{STEP_LABELS_DEFAULT[step - 1]}</span>
        </div>
        <div style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #eef0f4",
          boxShadow: "0 1px 2px rgba(15,17,23,0.04), 0 10px 28px -12px rgba(15,17,23,0.08)",
          padding: "22px 24px",
        }}>
          <StepContent s={s} step={step} />
        </div>
      </div>
    </div>
  );
}

// ── Layout: Compact ───────────────────────────────────────────────────────────

function PreviewCompact({ s, step, shop }: { s: EditorSettings; step: number; shop: string }) {
  const storeName = s.portalStoreName || shop.split(".")[0];
  const total = STEP_LABELS_DEFAULT.length;
  const pct = (step / total) * 100;
  return (
    <div style={{ background: "#fff", position: "relative" }}>
      {/* Slim brand progress bar at very top */}
      <div style={{ height: 2.5, background: "#eef0f4", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, width: `${pct}%`,
          background: `linear-gradient(90deg, ${s.brandColor}, ${s.brandColor}aa)`,
          transition: "width 0.4s ease",
        }} />
      </div>
      <header style={{
        background: s.bannerColor || "rgba(255,255,255,0.85)",
        borderBottom: "1px solid #eef0f4",
        padding: "0 18px",
        height: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        backdropFilter: "blur(10px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="Logo" style={{ height: 24, width: "auto", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: s.brandColor,
              display: "grid", placeContent: "center",
              color: "#fff", fontSize: 11.5, fontWeight: 800,
              boxShadow: `0 3px 8px -2px ${s.brandColor}66`,
            }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f1117", letterSpacing: "-0.01em" }}>{storeName}</span>
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.04em" }}>Step {step}/{total}</span>
          </div>
        </div>
        <span style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 3 }}>
          <span>←</span> {s.labelBackToStore || "Back to store"}
        </span>
      </header>
      <div style={{ padding: "16px 14px 18px" }}>
        <div style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #eef0f4",
          padding: "18px 20px",
          boxShadow: "0 1px 2px rgba(15,17,23,0.03)",
        }}>
          <StepContent s={s} step={step} />
        </div>
        <div style={{ textAlign: "center", fontSize: 10, color: "#cbd5e1", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <span>🔒</span> {s.labelPoweredBy || "Secured by TrackBack"}
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
    { icon: "Gift", label: "Store credit", desc: "Available instantly", sel: false },
    { icon: "RefreshCw", label: "Exchange for another item", desc: "Once we receive your return", sel: false },
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
