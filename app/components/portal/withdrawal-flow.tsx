/**
 * EU withdrawal function (Directive 2023/2673, in force since 19 June 2026):
 * a two-step flow reachable without logging in — identify the contract,
 * then "Confirm withdrawal". The acknowledgment email is sent immediately.
 */
import { useEffect, useState } from "react";
import { Icon } from "../ui";
import type { PortalKey } from "../../lib/i18n";
import type { FindOrderResponse, PortalOrderDTO, StatusView } from "../../lib/portal-types";
import { NavRow, Notice, PortalBtn, PortalInput, PortalTextarea, StepHeader, Stepper, Thumb, scrollPortalTop, usePortal } from "./kit";
import { PortalCard, PortalShell, showsTopStepper } from "./shells";

export function WithdrawalFlow({ onExit, onTrack }: { onExit: () => void; onTrack: (view: StatusView) => void }) {
  const { cfg, t, api, money } = usePortal();
  const [step, setStep] = useState(1);
  const [orderNum, setOrderNum] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PortalOrderDTO | null>(null);
  const [token, setToken] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<{ receivedAt: string; view?: StatusView } | null>(null);

  useEffect(() => scrollPortalTop(cfg.embed), [step, done, cfg.embed]);

  const steps = [t("stepFind"), t("withdrawConfirm")];

  const find = async () => {
    setLoading(true);
    setError(null);
    const res = await api<FindOrderResponse>("/portal-api/order", { orderNumber: orderNum, email, mode: "withdrawal" });
    setLoading(false);
    if (!res.order || !res.token) {
      setError(t(res.error ?? "errOrderNotFound"));
      return;
    }
    const eligible = res.order.lines.filter((l) => l.eligible);
    if (eligible.length === 0) {
      setError(t("withdrawNotEligible"));
      return;
    }
    setOrder(res.order);
    setToken(res.token);
    if (!name) setName(res.order.customerName);
    setQty(Object.fromEntries(eligible.map((l) => [l.id, l.maxQty])));
    setStep(2);
  };

  const confirm = async () => {
    if (!order) return;
    setLoading(true);
    setError(null);
    const lines = order.lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ lineItemId: l.id, qty: qty[l.id] }));
    const res = await api<{ rma?: string; receivedAt?: string; view?: StatusView; error?: PortalKey }>("/portal-api/withdraw", {
      token,
      locale: cfg.locale,
      lines,
      name,
      comment,
    });
    setLoading(false);
    if (res.rma && res.receivedAt) setDone({ receivedAt: res.receivedAt, view: res.view });
    else setError(t(res.error ?? "errGeneric"));
  };

  if (done) {
    const when = new Date(done.receivedAt).toLocaleString(cfg.locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "long", timeStyle: "short" });
    return (
      <PortalShell>
        <PortalCard>
          <div className="text-center max-w-md mx-auto py-4 animate-fadeIn">
            <div className="w-16 h-16 rounded-full grid place-content-center mx-auto mb-4" style={{ background: "#22C55E15" }}>
              <Icon name="Check" size={28} strokeWidth={3.5} style={{ color: "#22C55E" }} />
            </div>
            <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">{t("withdrawDoneTitle")}</h2>
            <p className="text-[13.5px] text-[#666] mt-2 leading-relaxed">{t("withdrawDoneDesc", { date: when, email: order?.email ?? email })}</p>
            {done.view && (
              <div className="mt-5 flex items-center justify-center gap-2">
                <span className="text-[18px] font-bold font-mono">{done.view.rma}</span>
              </div>
            )}
            <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
              {done.view && (
                <PortalBtn onClick={() => onTrack(done.view!)} icon="Search">
                  {t("trackThisReturn")}
                </PortalBtn>
              )}
              <PortalBtn variant="outline" onClick={onExit} icon="ArrowLeft">
                {t("back")}
              </PortalBtn>
            </div>
          </div>
        </PortalCard>
      </PortalShell>
    );
  }

  return (
    <PortalShell steps={steps} current={step}>
      {showsTopStepper(cfg.layout, cfg.embed) && <Stepper steps={steps} current={step} onJump={(i) => i < step && setStep(i)} />}
      <PortalCard key={step}>
        {step === 1 && (
          <div>
            <StepHeader title={t("withdrawTitle")} desc={t("withdrawDesc")} />
            {error && (
              <div className="mt-4">
                <Notice>{error}</Notice>
              </div>
            )}
            <div className="mt-6 space-y-4 max-w-md">
              <PortalInput label={t("withdrawName")} value={name} onChange={setName} autoComplete="name" maxLength={120} />
              <PortalInput label={t("orderNumber")} value={orderNum} onChange={setOrderNum} placeholder="#1089" maxLength={40} onEnter={find} />
              <PortalInput label={t("emailAddress")} value={email} onChange={setEmail} type="email" autoComplete="email" onEnter={find} />
            </div>
            <NavRow onBack={onExit} onNext={find} nextDisabled={!orderNum.trim() || !email.includes("@") || !name.trim()} nextLoading={loading} />
          </div>
        )}

        {step === 2 && order && (
          <div>
            <StepHeader title={t("withdrawItems")} desc={`${order.name}`} />
            {error && (
              <div className="mt-4">
                <Notice>{error}</Notice>
              </div>
            )}
            <div className="mt-5 space-y-2">
              {order.lines.map((l) => {
                const on = (qty[l.id] ?? 0) > 0;
                return (
                  <label
                    key={l.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${l.eligible ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                    style={on ? { borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, white)" } : { borderColor: "#e6e6ec" }}
                  >
                    <input
                      type="checkbox"
                      disabled={!l.eligible}
                      checked={on}
                      onChange={() => setQty((q) => ({ ...q, [l.id]: on ? 0 : l.maxQty }))}
                      className="w-4 h-4 accent-[color:var(--brand)]"
                    />
                    <Thumb src={l.image} alt={l.title} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-[#0f1117] truncate">{l.title}</div>
                      <div className="text-[12px] text-[#666]">
                        {l.variantTitle && l.variantTitle !== "Default Title" ? `${l.variantTitle} · ` : ""}
                        {t("qty")} {l.eligible ? l.maxQty : l.quantity}
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">{money(l.unitPrice)}</div>
                  </label>
                );
              })}
            </div>
            <div className="mt-4">
              <PortalTextarea label={t("withdrawComment")} optional value={comment} onChange={setComment} />
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <PortalBtn variant="ghost" onClick={() => setStep(1)} icon="ArrowLeft">
                {t("back")}
              </PortalBtn>
              {/* Statutory label: "Confirm withdrawal" / « Confirmer la rétractation » */}
              <PortalBtn onClick={confirm} loading={loading} disabled={!Object.values(qty).some((v) => v > 0)} icon="FileCheck">
                {t("withdrawConfirm")}
              </PortalBtn>
            </div>
          </div>
        )}
      </PortalCard>
    </PortalShell>
  );
}
