import { useState } from "react";
import { Icon } from "../ui";
import { payoutMethodLabel, type PortalKey } from "../../lib/i18n";
import type { StatusView } from "../../lib/portal-types";
import { CarrierField, CopyButton, Notice, PortalBtn, PortalInput, StepHeader, Thumb, WhatsAppButton, usePortal } from "./kit";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#F59E0B",
  APPROVED: "#3B82F6",
  SHIPPED: "#10B981",
  RECEIVED: "#8B5CF6",
  REFUNDED: "#22C55E",
  REJECTED: "#EF4444",
  EXPIRED: "#6B7280",
};

const TIMELINE_ICONS: Record<string, string> = {
  tlRequested: "PackagePlus",
  tlApproved: "CircleCheck",
  tlShipped: "Truck",
  tlReceived: "PackageCheck",
  tlRefunded: "BadgeCheck",
  tlRejected: "CircleX",
  tlExpired: "Clock",
};

export function StatusBadgePortal({ status }: { status: string }) {
  const { t } = usePortal();
  const color = STATUS_COLORS[status] ?? "#6B7280";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold"
      style={{ background: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {t(`status_${status}` as PortalKey)}
    </span>
  );
}

/** What the customer must do next, depending on the return method. */
export function InstructionsBlock({ view }: { view: StatusView }) {
  const { t } = usePortal();
  if (view.keepItem) {
    return (
      <Notice kind="success" icon="Leaf">
        <div className="font-semibold">{t("keepItemTitle")}</div>
        <div className="font-normal mt-0.5">{t("keepItemDesc")}</div>
      </Notice>
    );
  }
  const ins = view.instructions;
  const approved = view.status === "APPROVED";
  if (ins.method === "label") {
    return ins.labelUrl ? (
      <a
        href={ins.labelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 rounded-xl border-2 transition hover:-translate-y-[1px]"
        style={{ borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, white)" }}
      >
        <Icon name="Download" size={18} style={{ color: "var(--brand)" }} />
        <div className="text-[13.5px] font-semibold text-[#0f1117]">{t("methodLabel")}</div>
        <Icon name="ArrowRight" size={14} className="ml-auto text-[#888]" />
      </a>
    ) : (
      <Notice kind="info" icon="Tag">{t("stepLabel")}</Notice>
    );
  }
  if (ins.method === "store") {
    return (
      <div className="p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc]">
        <div className="text-[12.5px] font-semibold text-[#444] mb-1 flex items-center gap-1.5">
          <Icon name="Store" size={13} /> {t("stepStore")}
        </div>
        <div className="text-[13.5px] text-[#0f1117] whitespace-pre-line">{ins.storeInfo || ins.address}</div>
        <div className="text-[12px] text-[#666] mt-2">{t("writeRma", { rma: view.rma })}</div>
      </div>
    );
  }
  if (ins.method === "pickup") {
    return (
      <Notice kind="info" icon="Truck">
        <div>{t("stepPickup")}</div>
        {ins.pickupInfo && <div className="font-normal mt-1 whitespace-pre-line">{ins.pickupInfo}</div>}
      </Notice>
    );
  }
  // Ship it yourself
  if (!approved || !ins.address) {
    return <Notice kind="info" icon="Mail">{t("stepShipAfterApproval")}</Notice>;
  }
  return (
    <div className="p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc]">
      <div className="text-[12.5px] font-semibold text-[#444] mb-1 flex items-center gap-1.5">
        <Icon name="MapPin" size={13} /> {t("stepShipTo")}
      </div>
      <div className="flex items-start gap-2">
        <div className="text-[13.5px] text-[#0f1117] whitespace-pre-line flex-1">{ins.address}</div>
        <CopyButton value={ins.address} />
      </div>
      <div className="text-[12px] text-[#666] mt-2">{t("writeRma", { rma: view.rma })}</div>
    </div>
  );
}

function TrackingForm({ view, onUpdated }: { view: StatusView; onUpdated: (v: StatusView) => void }) {
  const { t, api } = usePortal();
  const [carrier, setCarrier] = useState(view.tracking.carrier ?? "");
  const [number, setNumber] = useState(view.tracking.number ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await api<{ view?: StatusView; error?: PortalKey }>("/portal-api/tracking", {
      statusToken: view.statusToken,
      carrier,
      trackingNumber: number,
    });
    setLoading(false);
    if (res.view) onUpdated(res.view);
    else setError(t(res.error ?? "errGeneric"));
  };

  return (
    <div className="p-4 rounded-xl border border-[#e6e6ec] bg-white space-y-3">
      <div className="text-[13.5px] font-semibold text-[#0f1117] flex items-center gap-1.5">
        <Icon name="Truck" size={14} /> {t("addTracking")}
      </div>
      {error && <Notice>{error}</Notice>}
      <CarrierField value={carrier} onChange={setCarrier} />
      <PortalInput label={t("trackingNumber")} value={number} onChange={setNumber} maxLength={80} />
      <PortalBtn onClick={submit} disabled={!carrier.trim() || !number.trim()} loading={loading} icon="Check">
        {t("saveTracking")}
      </PortalBtn>
    </div>
  );
}

export function StatusDetails({ view, onChange, onNewReturn }: { view: StatusView; onChange: (v: StatusView) => void; onNewReturn: () => void }) {
  const { t, money, date, cfg } = usePortal();
  const [justTracked, setJustTracked] = useState(false);
  const methodPhrase: Record<string, PortalKey> = {
    STORE_CREDIT: "storeCreditTitle",
    GIFT_CARD: "storeCreditTitle",
    EXCHANGE: "exchangeTitle",
    MANUAL: "refundOfflineTitle",
    ORIGINAL_PAYMENT: "refundOriginalTitle",
  };
  const doneMethod = view.payout?.method
    ? `${payoutMethodLabel(view.payout.method, cfg.locale)}${view.payout.account ? ` ${view.payout.account}` : ""}`
    : t(methodPhrase[view.refundType] ?? "refundOriginalTitle");

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1 font-semibold">{t("yourRma")}</div>
          <div className="flex items-center gap-2">
            <div className="text-[20px] font-bold text-[#0f1117] font-mono">{view.rma}</div>
            <CopyButton value={view.rma} />
          </div>
          <div className="text-[12.5px] text-[#666] mt-0.5">
            {view.orderName} · {date(view.createdAt)}
          </div>
        </div>
        <StatusBadgePortal status={view.status} />
      </div>

      {view.status === "REJECTED" && view.rejectionReason && (
        <div className="mt-4">
          <Notice>{t("rejectionReason", { reason: view.rejectionReason })}</Notice>
        </div>
      )}

      {(view.status === "APPROVED" || view.keepItem) && view.status !== "REFUNDED" && view.status !== "REJECTED" && (
        <div className="mt-5 space-y-3">
          <div className="text-[12px] uppercase tracking-wider text-[#888] font-semibold">{t("returnInstructions")}</div>
          <InstructionsBlock view={view} />
          {view.canSubmitTracking && <TrackingForm view={view} onUpdated={(v) => { setJustTracked(true); onChange(v); }} />}
        </div>
      )}

      {justTracked && view.status === "SHIPPED" && (
        <div className="mt-4">
          <Notice kind="success">{t("trackingSaved")}</Notice>
        </div>
      )}

      {view.tracking.url && (view.status === "SHIPPED" || view.status === "RECEIVED") && (
        <a href={view.tracking.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-4 text-[13px] font-semibold" style={{ color: "var(--brand)" }}>
          <Icon name="ExternalLink" size={13} /> {t("trackParcel")}
        </a>
      )}

      {view.status === "REFUNDED" && (
        <div className="mt-4">
          <Notice kind="success" icon="BadgeCheck">
            {t("refundDone", { method: doneMethod, amount: money(view.refundAmount) })}
          </Notice>
        </div>
      )}

      <div className="mt-6 relative">
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[#e6e6ec]" />
        <div className="space-y-3.5">
          {view.timeline.map((ev) => (
            <div key={ev.key} className="flex items-center gap-3 relative">
              <div className="w-[22px] h-[22px] rounded-full grid place-content-center shrink-0 relative z-10 border-[3px] border-white text-white" style={{ background: "var(--brand)" }}>
                <Icon name={TIMELINE_ICONS[ev.key] ?? "Circle"} size={10} strokeWidth={2.5} />
              </div>
              <div className="text-[13px] font-semibold text-[#0f1117]">{t(ev.key as PortalKey)}</div>
              <div className="text-[12px] text-[#888]">· {date(ev.date)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {view.items.map((it, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-[#eef0f4]">
            <Thumb src={it.image} alt={it.name} size={44} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[#0f1117] truncate">{it.name}</div>
              <div className="text-[12px] text-[#666] truncate">
                {it.variant ? `${it.variant} · ` : ""}
                {t("qty")} {it.quantity}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <PortalBtn variant="outline" onClick={onNewReturn} icon="RotateCcw">
          {t("newReturn")}
        </PortalBtn>
        <WhatsAppButton text={t("whatsappHello", { rma: view.rma })} />
      </div>
    </div>
  );
}

export function StatusLookup({ onFound, onBack }: { onFound: (v: StatusView) => void; onBack: () => void }) {
  const { t, api } = usePortal();
  const [rma, setRma] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await api<{ view?: StatusView; error?: PortalKey }>("/portal-api/status", { rma, email });
    setLoading(false);
    if (res.view) onFound(res.view);
    else setError(t(res.error ?? "statusNotFound"));
  };

  return (
    <div>
      <StepHeader title={t("statusTitle")} desc={t("statusDesc")} />
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      <div className="mt-6 space-y-4 max-w-md">
        <PortalInput label={t("rmaNumber")} value={rma} onChange={setRma} placeholder="RMA-2026-000001" maxLength={40} onEnter={submit} />
        <PortalInput label={t("emailAddress")} value={email} onChange={setEmail} placeholder="you@email.com" type="email" autoComplete="email" onEnter={submit} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">
          {t("back")}
        </PortalBtn>
        <PortalBtn onClick={submit} disabled={!rma.trim() || !email.includes("@")} loading={loading} iconRight="ArrowRight">
          {t("lookUp")}
        </PortalBtn>
      </div>
    </div>
  );
}

export function StatusScreen({
  initial,
  onNewReturn,
}: {
  initial: StatusView | null;
  onNewReturn: () => void;
}) {
  const [view, setView] = useState<StatusView | null>(initial);
  return view ? (
    <StatusDetails view={view} onChange={setView} onNewReturn={onNewReturn} />
  ) : (
    <StatusLookup onFound={setView} onBack={onNewReturn} />
  );
}
