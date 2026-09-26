/**
 * Portal page shells — the five layouts merchants pick in the Portal Editor
 * (classic, minimal, bold, sidebar, compact) plus the "embedded" shell used
 * when the portal is rendered inside the store theme (app proxy iframe).
 */
import React, { useState } from "react";
import { Icon } from "../ui";
import { LOCALE_LABELS, type Locale } from "../../lib/i18n";
import { Sheet, usePortal } from "./kit";

type ShellProps = {
  children: React.ReactNode;
  steps?: string[];
  current?: number;
};

function initials(name: string) {
  return (name || "?").charAt(0).toUpperCase();
}

function langHref(locale: Locale) {
  if (typeof window === "undefined") return `?lang=${locale}`;
  const url = new URL(window.location.href);
  url.searchParams.set("lang", locale);
  return url.pathname + url.search;
}

export function LanguageSwitch({ light = false }: { light?: boolean }) {
  const { cfg, t } = usePortal();
  if (cfg.locales.length < 2) return null;
  return (
    <div className={`inline-flex items-center gap-0.5 p-0.5 rounded-full ${light ? "bg-white/15" : "bg-[rgba(15,23,42,0.05)]"}`} aria-label={t("language")}>
      {cfg.locales.map((l) => (
        <a
          key={l}
          href={langHref(l)}
          hrefLang={l}
          title={LOCALE_LABELS[l]}
          className={`px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide transition-colors ${
            l === cfg.locale
              ? light
                ? "bg-white text-[color:var(--brand)]"
                : "bg-white text-[#0f1117] shadow-sm"
              : light
                ? "text-white/80 hover:text-white"
                : "text-[#94a3b8] hover:text-[#0f1117]"
          }`}
        >
          {l}
        </a>
      ))}
    </div>
  );
}

function BackToStore({ className = "", light = false }: { className?: string; light?: boolean }) {
  const { cfg, t } = usePortal();
  if (cfg.embed) return null;
  return (
    <a
      href={cfg.storeUrl}
      target="_top"
      className={`flex items-center gap-1.5 transition-colors ${light ? "text-white/85 hover:text-white" : "text-[#475569] hover:text-[#0f1117]"} ${className}`}
    >
      <Icon name="ArrowLeft" size={13} /> {t("labelBackToStore")}
    </a>
  );
}

function Logo({ size = "md", light = false }: { size?: "sm" | "md"; light?: boolean }) {
  const { cfg } = usePortal();
  const h = size === "sm" ? "h-7" : "h-9";
  if (cfg.logoUrl) {
    return <img src={cfg.logoUrl} alt={cfg.storeName} className={`${h} w-auto object-contain ${light ? "brightness-[10]" : ""}`} />;
  }
  const dim = size === "sm" ? "w-7 h-7 text-[11px] rounded-[7px]" : "w-10 h-10 text-[15px] rounded-[10px]";
  return (
    <div
      className={`${dim} grid place-content-center font-extrabold`}
      style={
        light
          ? { background: "rgba(255,255,255,0.18)", color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)" }
          : {
              background: "#fff",
              color: "var(--brand)",
              boxShadow: "0 0 0 1px color-mix(in srgb, var(--brand) 22%, transparent), 0 6px 18px -6px color-mix(in srgb, var(--brand) 45%, transparent)",
            }
      }
    >
      {initials(cfg.storeName)}
    </div>
  );
}

/** Footer: help contact, return policy, attribution. */
export function PortalFooter({ compact = false }: { compact?: boolean }) {
  const { cfg, t } = usePortal();
  const [policyOpen, setPolicyOpen] = useState(false);
  return (
    <div className={`text-center ${compact ? "text-[11px] mt-3" : "text-[12px] mt-5"} text-[#94a3b8]`}>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {cfg.supportEmail && (
          <span>
            {t("needHelp")}{" "}
            <a href={`mailto:${cfg.supportEmail}`} className="underline font-medium" style={{ color: "var(--brand)" }}>
              {cfg.supportEmail}
            </a>
          </span>
        )}
        {cfg.policy.trim() && (
          <button type="button" onClick={() => setPolicyOpen(true)} className="underline font-medium" style={{ color: "var(--brand)" }}>
            {t("returnPolicy")}
          </button>
        )}
      </div>
      {cfg.poweredBy && (
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-[#cbd5e1]">
          <Icon name="Lock" size={11} /> {cfg.poweredBy}
        </div>
      )}
      <Sheet open={policyOpen} title={t("returnPolicy")} onClose={() => setPolicyOpen(false)}>
        {cfg.policy}
      </Sheet>
    </div>
  );
}

function ShellEmbedded({ children }: ShellProps) {
  return (
    <div className="w-full font-sans" style={{ color: "#0f1117" }}>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6">
        <div className="flex justify-end mb-3">
          <LanguageSwitch />
        </div>
        {children}
        <PortalFooter />
      </div>
    </div>
  );
}

function ShellClassic({ children }: ShellProps) {
  const { cfg, t } = usePortal();
  return (
    <div className="min-h-screen w-full font-sans" style={{ background: "#F7F8FB", color: "#0f1117" }}>
      <header className="relative" style={{ background: cfg.bannerColor || "#ffffff", borderBottom: "1px solid #eef0f4" }}>
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo />
            <div className="min-w-0">
              <div className="text-[15px] font-bold leading-tight tracking-[-0.01em] truncate">{cfg.storeName}</div>
              <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#94a3b8] mt-0.5">{t("returnCenter")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <BackToStore className="text-[12.5px] px-3 py-1.5 rounded-full bg-[rgba(15,23,42,0.04)] hover:bg-[rgba(15,23,42,0.07)]" />
          </div>
        </div>
        <div className="absolute left-0 right-0 -bottom-px h-px" style={{ background: "linear-gradient(90deg, transparent, var(--brand), transparent)", opacity: 0.55 }} />
      </header>
      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        {children}
        <PortalFooter />
      </main>
    </div>
  );
}

function ShellMinimal({ children }: ShellProps) {
  const { cfg } = usePortal();
  return (
    <div className="min-h-screen w-full font-sans" style={{ background: "#fff", color: "#0f1117" }}>
      <div style={{ height: 2, background: "linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 35%, transparent), transparent)" }} />
      <div className="max-w-xl mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between pt-6 pb-3 gap-3">
          {cfg.logoUrl ? <Logo size="sm" /> : <span className="text-[16px] font-bold tracking-[-0.025em]">{cfg.storeName}</span>}
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <BackToStore className="text-[12px]" />
          </div>
        </div>
        <main className="pb-10">
          {children}
          <PortalFooter compact />
        </main>
      </div>
    </div>
  );
}

function ShellBold({ children }: ShellProps) {
  const { cfg, t } = usePortal();
  return (
    <div className="min-h-screen w-full font-sans" style={{ background: "#F7F8FB", color: "#0f1117" }}>
      <div
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, var(--brand) 0%, color-mix(in srgb, var(--brand) 75%, #000) 100%)", padding: "24px 24px 52px" }}
      >
        <div className="absolute pointer-events-none" style={{ top: -80, right: -60, width: 260, height: 260, borderRadius: "50%", background: "rgba(255,255,255,0.10)", filter: "blur(20px)" }} />
        <div className="absolute pointer-events-none" style={{ bottom: -70, left: -50, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)", filter: "blur(12px)" }} />
        <div className="relative max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo light />
            <div className="min-w-0">
              <div className="text-[16px] font-bold text-white leading-tight tracking-[-0.02em] truncate">{cfg.storeName}</div>
              <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-white/70 mt-0.5">{t("returnCenter")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitch light />
            <BackToStore light className="text-[12px] px-3 py-1.5 rounded-full bg-white/15" />
          </div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 sm:px-8" style={{ marginTop: -28 }}>
        <main className="pb-10">
          {children}
          <PortalFooter />
        </main>
      </div>
    </div>
  );
}

function ShellSidebar({ children, steps, current = 1 }: ShellProps) {
  const { cfg, t } = usePortal();
  const allSteps = steps && steps.length ? steps : [];
  return (
    <div className="min-h-screen w-full font-sans flex" style={{ color: "#0f1117" }}>
      <aside className="w-64 shrink-0 hidden sm:flex flex-col border-r border-[#eef0f4]" style={{ background: "#fff" }}>
        <div className="p-6">
          <div className="flex items-center gap-2.5 mb-7">
            <Logo />
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold leading-tight tracking-[-0.01em] truncate">{cfg.storeName}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-[#94a3b8] mt-0.5">{t("returns")}</div>
            </div>
          </div>
          {allSteps.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-[0.14em] text-[#94a3b8] font-bold mb-3 pl-2">{t("yourReturn")}</div>
              <div className="space-y-0.5">
                {allSteps.map((label, i) => {
                  const idx = i + 1;
                  const done = idx < current;
                  const curr = idx === current;
                  return (
                    <div
                      key={label}
                      className="relative flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                      style={{ background: curr ? "color-mix(in srgb, var(--brand) 9%, transparent)" : "transparent" }}
                    >
                      {curr && <span className="absolute left-0 top-[22%] bottom-[22%] w-[2.5px] rounded-full" style={{ background: "var(--brand)" }} />}
                      <div
                        className="w-6 h-6 rounded-full grid place-content-center text-[10.5px] font-bold shrink-0"
                        style={{ background: done ? "var(--brand)" : curr ? "#0f1117" : "#f1f5f9", color: done || curr ? "#fff" : "#94a3b8" }}
                      >
                        {done ? <Icon name="Check" size={11} strokeWidth={3} /> : idx}
                      </div>
                      <span className={`text-[12.5px] ${curr ? "font-bold text-[#0f1117]" : done ? "font-medium text-[#475569]" : "font-medium text-[#94a3b8]"}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="mt-auto p-6 border-t border-[#eef0f4] space-y-3">
          <LanguageSwitch />
          <BackToStore className="text-[12px]" />
        </div>
      </aside>
      <div className="flex-1 min-w-0" style={{ background: "#FAFBFD" }}>
        <div className="sm:hidden flex items-center justify-between px-5 h-14 border-b border-[#eef0f4] bg-white gap-2">
          <div className="text-[14px] font-bold tracking-[-0.01em] truncate">{cfg.storeName}</div>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <BackToStore className="text-[12px]" />
          </div>
        </div>
        <main className="px-6 sm:px-10 pt-6 pb-10 max-w-2xl">
          {children}
          <PortalFooter />
        </main>
      </div>
    </div>
  );
}

function ShellCompact({ children, steps, current = 1 }: ShellProps) {
  const { cfg, t } = usePortal();
  const total = steps?.length || 1;
  const pct = Math.min(100, Math.max(0, (current / total) * 100));
  return (
    <div className="min-h-screen w-full font-sans" style={{ background: "#fff", color: "#0f1117" }}>
      <div className="h-[3px] relative overflow-hidden" style={{ background: "#eef0f4" }}>
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${steps?.length ? pct : 100}%`, background: "linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 65%, white))" }}
        />
      </div>
      <header
        className="sticky top-0 z-10"
        style={{ background: cfg.bannerColor || "rgba(255,255,255,0.85)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderBottom: "1px solid #eef0f4" }}
      >
        <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo size="sm" />
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[13px] font-bold tracking-[-0.01em] truncate">{cfg.storeName}</span>
              {steps?.length ? (
                <span className="text-[10.5px] font-semibold text-[#94a3b8]">{t("stepOf", { n: current, total })}</span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <BackToStore className="text-[11.5px]" />
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {children}
        <PortalFooter compact />
      </main>
    </div>
  );
}

export function PortalShell(props: ShellProps) {
  const { cfg } = usePortal();
  const style = { "--brand": cfg.brandColor } as React.CSSProperties;
  let Shell: React.FC<ShellProps> = ShellClassic;
  if (cfg.embed) Shell = ShellEmbedded;
  else if (cfg.layout === "minimal") Shell = ShellMinimal;
  else if (cfg.layout === "bold") Shell = ShellBold;
  else if (cfg.layout === "sidebar") Shell = ShellSidebar;
  else if (cfg.layout === "compact") Shell = ShellCompact;
  return (
    <div style={style} lang={cfg.locale}>
      <Shell {...props} />
    </div>
  );
}

/** Card wrapper whose look depends on the layout. */
export function PortalCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { cfg } = usePortal();
  const layout = cfg.embed ? "embed" : cfg.layout;
  const cls =
    layout === "minimal"
      ? "mt-6 animate-slideUp"
      : layout === "compact"
        ? "bg-white rounded-[14px] border border-[#eef0f4] p-5 sm:p-6 mt-4 animate-slideUp"
        : layout === "bold"
          ? "bg-white rounded-[20px] p-6 sm:p-8 mt-6 animate-slideUp"
          : "bg-white rounded-[18px] border border-[#eef0f4] p-6 sm:p-8 mt-6 animate-slideUp";
  const style: React.CSSProperties =
    layout === "minimal"
      ? {}
      : layout === "compact"
        ? { boxShadow: "0 1px 2px rgba(15,17,23,0.04)" }
        : layout === "bold"
          ? {
              boxShadow: "0 24px 48px -16px color-mix(in srgb, var(--brand) 22%, transparent), 0 4px 12px -4px rgba(15,17,23,0.08)",
              border: "1px solid rgba(15,17,23,0.04)",
            }
          : { boxShadow: "0 1px 2px rgba(15,17,23,0.04), 0 10px 28px -10px rgba(15,17,23,0.10)" };
  return (
    <div className={`${cls} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Stepper placement follows the layout (hidden where the shell renders its own). */
export function showsTopStepper(layout: string, embed: boolean) {
  if (embed) return true;
  return layout !== "sidebar" && layout !== "compact";
}
