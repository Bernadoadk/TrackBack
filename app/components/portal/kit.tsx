/**
 * Customer portal UI kit — shared context + atoms. Visual language matches
 * the original portal: white cards, 12px radius inputs, brand color through
 * the `--brand` CSS variable.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "../ui";
import { formatMoney } from "../../lib/money";
import { makeT, type PortalKey } from "../../lib/i18n";
import type { PortalConfig } from "../../lib/portal-types";
import { CARRIER_OPTIONS, OTHER_CARRIER } from "../../lib/carriers";

type Ctx = {
  cfg: PortalConfig;
  t: (key: PortalKey, vars?: Record<string, string | number>) => string;
  money: (n: number) => string;
  date: (iso: string) => string;
  api: <T = any>(path: string, body: Record<string, unknown>) => Promise<T>;
};

const PortalCtx = createContext<Ctx | null>(null);

export function PortalProvider({ cfg, children }: { cfg: PortalConfig; children: React.ReactNode }) {
  const value = useMemo<Ctx>(() => {
    const t = makeT(cfg.texts);
    const intlLocale = cfg.locale === "fr" ? "fr-FR" : "en-US";
    return {
      cfg,
      t,
      money: (n: number) => formatMoney(n, cfg.currency, intlLocale),
      date: (iso: string) =>
        new Date(iso).toLocaleDateString(intlLocale, { year: "numeric", month: "long", day: "numeric" }),
      api: async <T,>(path: string, body: Record<string, unknown>) => {
        try {
          const res = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ ...body, shop: cfg.shop }),
          });
          return (await res.json()) as T;
        } catch {
          return { error: "errGeneric" } as T;
        }
      },
    };
  }, [cfg]);
  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>;
}

export function usePortal(): Ctx {
  const ctx = useContext(PortalCtx);
  if (!ctx) throw new Error("usePortal must be used inside PortalProvider");
  return ctx;
}

/** In the storefront iframe, keep the parent's iframe height in sync. */
export function useEmbedAutoHeight(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || window.parent === window) return;
    // Measure the body (height:auto on portal pages) so the frame can also shrink.
    const post = () =>
      window.parent.postMessage({ type: "trackback:height", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [enabled]);
}

export function scrollPortalTop(embed: boolean) {
  if (typeof window === "undefined") return;
  if (embed && window.parent !== window) window.parent.postMessage({ type: "trackback:scrollTop" }, "*");
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Buttons & fields ───────────────────────────────────────────────────────

export function PortalBtn({
  variant = "primary",
  children,
  full,
  onClick,
  disabled,
  icon,
  iconRight,
  loading,
  type = "button",
}: {
  variant?: "primary" | "ghost" | "outline";
  children: React.ReactNode;
  full?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  type?: "button" | "submit";
}) {
  const base =
    "group inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-[13.5px] font-semibold " +
    "transition-[transform,box-shadow,background-color,color] duration-200 ease-out " +
    "disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]";
  const map: Record<string, string> = {
    primary:
      "text-white shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_22px_-6px_color-mix(in_srgb,var(--brand)_55%,transparent)] " +
      "hover:shadow-[0_1px_0_rgba(255,255,255,0.3)_inset,0_14px_30px_-6px_color-mix(in_srgb,var(--brand)_65%,transparent)] hover:-translate-y-[1px]",
    ghost: "text-[#555] hover:text-[#111] bg-transparent hover:bg-[#f3f4f8]",
    outline: "border border-[#e2e5ec] bg-white text-[#111] hover:bg-[#f8fafc] hover:border-[#c8cdd6]",
  };
  const style =
    variant === "primary"
      ? { background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 92%, white), var(--brand))" }
      : {};
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} style={style} className={`${base} ${map[variant]} ${full ? "w-full" : ""}`}>
      {loading ? (
        <Icon name="LoaderCircle" size={14} className="animate-spin" />
      ) : (
        icon && <Icon name={icon} size={14} className="transition-transform group-hover:-translate-x-[1px]" />
      )}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={14} className="transition-transform group-hover:translate-x-[2px]" />}
    </button>
  );
}

export const FIELD_CLASS =
  "w-full h-11 px-3.5 rounded-xl border border-[#e2e5ec] bg-white text-[14px] text-[#111] placeholder:text-[#b8bcc7] " +
  "hover:border-[#c8cdd6] focus:outline-none focus:border-[color:var(--brand)] " +
  "focus:ring-4 focus:ring-[color-mix(in_srgb,var(--brand)_18%,transparent)] " +
  "transition-[border-color,box-shadow,background-color] duration-200";

export function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  const { t } = usePortal();
  return (
    <span className="block text-[12.5px] font-medium text-[#444] mb-1.5 transition-colors group-focus-within:text-[color:var(--brand)]">
      {children}
      {optional && <span className="text-[#aaa] font-normal"> ({t("optional")})</span>}
    </span>
  );
}

export function PortalInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  optional,
  autoComplete,
  inputMode,
  maxLength = 254,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  onEnter?: () => void;
}) {
  return (
    <label className="group block">
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        className={FIELD_CLASS}
      />
    </label>
  );
}

export function PortalTextarea({
  label,
  value,
  onChange,
  placeholder,
  optional,
  rows = 2,
  maxLength = 1000,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  optional?: boolean;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <label className="group block">
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <textarea
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${FIELD_CLASS} h-auto py-2.5 resize-none text-[13px]`}
      />
    </label>
  );
}

export function PortalSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}) {
  return (
    <label className="group block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_CLASS} appearance-none pr-9 cursor-pointer ${value ? "text-[#111]" : "text-[#b8bcc7]"}`}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]">
          <Icon name="ChevronDown" size={14} />
        </div>
      </div>
    </label>
  );
}

export function Notice({
  kind = "error",
  children,
  icon,
}: {
  kind?: "error" | "info" | "warn" | "success";
  children: React.ReactNode;
  icon?: string;
}) {
  const styles: Record<string, string> = {
    error: "bg-red-50 border-red-200 text-red-600",
    info: "bg-[#f5f7ff] border-[#e0e4fb] text-[#3b4476]",
    warn: "bg-amber-50 border-amber-200 text-amber-700",
    success: "bg-emerald-50 border-emerald-200 text-emerald-700",
  };
  const icons: Record<string, string> = { error: "TriangleAlert", info: "Info", warn: "TriangleAlert", success: "CircleCheck" };
  return (
    <div className={`p-3 rounded-xl border text-[13px] font-medium flex items-start gap-2 ${styles[kind]}`} role={kind === "error" ? "alert" : undefined}>
      <Icon name={icon ?? icons[kind]} size={14} className="mt-[2px] shrink-0" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

export function StepHeader({ eyebrow, title, desc }: { eyebrow?: string; title: string; desc?: React.ReactNode }) {
  return (
    <div>
      {eyebrow && <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">{eyebrow}</div>}
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">{title}</h2>
      {desc && <p className="text-[13.5px] text-[#666] mt-1.5 leading-relaxed">{desc}</p>}
    </div>
  );
}

export function NavRow({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
  nextIcon = "ArrowRight",
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  nextIcon?: string;
}) {
  const { t } = usePortal();
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {onBack ? (
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">
          {t("back")}
        </PortalBtn>
      ) : (
        <span />
      )}
      {onNext && (
        <PortalBtn onClick={onNext} disabled={nextDisabled} loading={nextLoading} iconRight={nextIcon}>
          {nextLabel ?? t("continue")}
        </PortalBtn>
      )}
    </div>
  );
}

export function Thumb({ src, alt, size = 64 }: { src: string | null; alt: string; size?: number }) {
  return (
    <div
      className="rounded-lg grid place-content-center shrink-0 border border-[#e6e6ec] bg-[#f8fafc] overflow-hidden"
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt={alt} className="w-full h-full object-cover" loading="lazy" /> : <Icon name="Shirt" size={Math.round(size / 3)} className="text-[#ccc]" />}
    </div>
  );
}

export function Stepper({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (idx: number) => void }) {
  return (
    <div className="flex items-center gap-2" aria-label="progress">
      {steps.map((s, i) => {
        const idx = i + 1;
        const isDone = idx < current;
        const isCurr = idx === current;
        return (
          <React.Fragment key={s}>
            <button
              type="button"
              onClick={() => isDone && onJump?.(idx)}
              className={`flex items-center gap-2 group ${isDone ? "cursor-pointer" : "cursor-default"}`}
              aria-current={isCurr ? "step" : undefined}
            >
              <div
                className={`relative w-7 h-7 rounded-full grid place-content-center text-[12px] font-semibold transition-[background-color,color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                  isDone ? "text-white" : isCurr ? "text-white scale-110" : "text-[#aaa]"
                }`}
                style={{
                  background: isDone ? "var(--brand)" : isCurr ? "#0f1117" : "#fff",
                  border: isDone || isCurr ? "none" : "1.5px solid #e2e5ec",
                  boxShadow: isCurr
                    ? "0 0 0 4px color-mix(in srgb, var(--brand) 18%, transparent), 0 4px 14px -2px rgba(15,17,23,0.25)"
                    : isDone
                      ? "0 2px 8px -2px color-mix(in srgb, var(--brand) 40%, transparent)"
                      : "none",
                }}
              >
                {isDone ? <Icon name="Check" size={13} strokeWidth={3} className="animate-popIn" /> : idx}
              </div>
              <span className={`text-[12.5px] font-medium hidden sm:inline transition-colors ${isCurr || isDone ? "text-[#0f1117]" : "text-[#aaa]"}`}>{s}</span>
            </button>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px relative overflow-hidden rounded-full" style={{ background: "#e6e6ec" }}>
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: idx < current ? "100%" : "0%",
                    background: "linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 70%, white))",
                  }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function CarrierField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = usePortal();
  const presetValues = CARRIER_OPTIONS.map((o) => o.value).filter((v) => v !== OTHER_CARRIER);
  const isPreset = !!value && presetValues.includes(value);
  const [otherMode, setOtherMode] = useState(!!value && !isPreset);
  const dropdownValue = otherMode ? OTHER_CARRIER : isPreset ? value : "";
  return (
    <div className="space-y-2">
      <PortalSelect
        label={t("carrier")}
        value={dropdownValue}
        placeholder={t("selectCarrier")}
        onChange={(v) => {
          if (v === OTHER_CARRIER) {
            setOtherMode(true);
            onChange("");
          } else {
            setOtherMode(false);
            onChange(v);
          }
        }}
        options={[
          ...CARRIER_OPTIONS.filter((o) => o.value !== OTHER_CARRIER).map((o) => ({ value: o.value, label: o.label })),
          { value: OTHER_CARRIER, label: t("otherCarrierOption") },
        ]}
      />
      {otherMode && <PortalInput label={t("otherCarrier")} value={value} onChange={onChange} maxLength={80} />}
    </div>
  );
}

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = usePortal();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 animate-fadeIn" style={{ background: "rgba(15,17,23,0.45)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-2xl animate-scaleIn flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#eef0f4] flex items-center justify-between">
          <div className="text-[15px] font-bold text-[#0f1117]">{title}</div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[#888] hover:text-[#111] hover:bg-[#f3f4f8]" aria-label={t("close")}>
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto text-[13.5px] text-[#444] leading-relaxed whitespace-pre-line">{children}</div>
      </div>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const { t } = usePortal();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [value]);
  return (
    <button onClick={copy} className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 text-[11.5px] font-medium text-[#888] hover:text-[#0f1117] hover:bg-[#f3f4f8] rounded-md transition-colors" title={t("copy")}>
      <Icon name={copied ? "Check" : "Copy"} size={13} /> {copied ? t("copied") : t("copy")}
    </button>
  );
}

export function WhatsAppButton({ text }: { text: string }) {
  const { cfg, t } = usePortal();
  if (!cfg.whatsapp.number) return null;
  const digits = cfg.whatsapp.number.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return (
    <a
      href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-[13.5px] font-semibold text-white transition-transform hover:-translate-y-[1px] active:scale-[0.97]"
      style={{ background: "#25D366", boxShadow: "0 8px 22px -8px rgba(37,211,102,0.6)" }}
    >
      <Icon name="MessageCircle" size={15} /> {t("contactWhatsapp")}
    </a>
  );
}

/** Resizes an image client-side (max 1600px, JPEG) before upload. */
export async function resizeImage(file: File, maxSize = 1600, quality = 0.82): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl; // formats the browser can't decode (e.g. HEIC) are sent as-is
  }
}
