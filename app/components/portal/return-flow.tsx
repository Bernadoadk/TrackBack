/**
 * Customer return flow: find order → items → reasons (+photos) →
 * resolution (refund / store credit / exchange / shop now, payout details,
 * return method) → confirm → confirmation.
 * Totals shown here use the same pure `computeTotals` as the server, but the
 * server recomputes everything on submit.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Icon } from "../ui";
import { PAYOUT_METHODS, payoutMethodKind, type PortalKey } from "../../lib/i18n";
import type { ExchangeOption, FindOrderResponse, PortalLine, PortalOrderDTO, StatusView } from "../../lib/portal-types";
import { computeTotals, isGreenReturn, methodHasShippingFee, type IneligibleReason, type ReturnMethodKey } from "../../lib/returns-logic";
import {
  NavRow,
  Notice,
  PortalBtn,
  PortalInput,
  PortalSelect,
  PortalTextarea,
  Sheet,
  StepHeader,
  Stepper,
  Thumb,
  resizeImage,
  scrollPortalTop,
  usePortal,
} from "./kit";
import { PortalCard, PortalShell, showsTopStepper } from "./shells";
import { StatusDetails } from "./status-view";

type RefundChoice = "ORIGINAL_PAYMENT" | "STORE_CREDIT" | "EXCHANGE" | "SHOP_NOW";

const REASON_KEYS: Record<IneligibleReason, PortalKey> = {
  FINAL_SALE: "reasonFinalSale",
  NOT_FULFILLED: "reasonNotFulfilled",
  ALREADY_RETURNED: "reasonAlreadyReturned",
  WINDOW_EXPIRED: "reasonWindowExpired",
  DISCOUNTED: "reasonDiscounted",
  ONE_RETURN_PER_ORDER: "reasonOneReturn",
};

const METHOD_META: Record<ReturnMethodKey, { icon: string; title: PortalKey; desc: PortalKey }> = {
  ship: { icon: "Package", title: "methodShip", desc: "methodShipDesc" },
  label: { icon: "Tag", title: "methodLabel", desc: "methodLabelDesc" },
  store: { icon: "Store", title: "methodStore", desc: "methodStoreDesc" },
  pickup: { icon: "Truck", title: "methodPickup", desc: "methodPickupDesc" },
};

export function ReturnFlow({
  onTrack,
  onWithdraw,
  onIdentified,
}: {
  onTrack: () => void;
  onWithdraw: () => void;
  onIdentified: (id: { chatToken: string; email: string; name: string }) => void;
}) {
  const { cfg, t, api, money } = usePortal();

  // Step 1
  const [step, setStep] = useState(1);
  const [orderNum, setOrderNum] = useState("");
  const [email, setEmail] = useState("");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [order, setOrder] = useState<PortalOrderDTO | null>(null);
  const [token, setToken] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);

  // Steps 2-3
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Step 4
  const [refundType, setRefundType] = useState<RefundChoice>("ORIGINAL_PAYMENT");
  const [exchangeOptions, setExchangeOptions] = useState<Record<string, ExchangeOption[]>>({});
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [choice, setChoice] = useState<Record<string, ExchangeOption>>({});
  const [exchangeNote, setExchangeNote] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<string>(cfg.cod.methods[0] ?? "");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [payoutName, setPayoutName] = useState("");
  const [returnMethod, setReturnMethod] = useState<ReturnMethodKey>(cfg.returnMethods[0] ?? "ship");

  // Step 5
  const [phone, setPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rma: string; keepItem: boolean; view?: StatusView } | null>(null);
  const [view, setView] = useState<StatusView | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  const selectedLines: PortalLine[] = useMemo(
    () => (order?.lines ?? []).filter((l) => (qty[l.id] ?? 0) > 0),
    [order, qty],
  );

  const refundChoices: RefundChoice[] = useMemo(() => {
    const list: RefundChoice[] = ["ORIGINAL_PAYMENT"];
    if (cfg.refundOptions.storeCredit) list.push("STORE_CREDIT");
    if (cfg.refundOptions.exchange) list.push("EXCHANGE");
    if (cfg.refundOptions.shopNow) list.push("SHOP_NOW");
    return list;
  }, [cfg.refundOptions]);

  const offlinePayout = !!order?.isOfflinePayment && cfg.cod.enabled && refundType === "ORIGINAL_PAYMENT";
  const needsResolution =
    refundChoices.length > 1 || cfg.returnMethods.length > 1 || (!!order?.isOfflinePayment && cfg.cod.enabled);

  const steps = [t("stepFind"), t("stepItems"), t("stepReason"), ...(needsResolution ? [t("stepResolution")] : []), t("stepConfirm")];
  const confirmStep = steps.length;
  const displayStep = step; // steps are renumbered when resolution is skipped
  const serverRefund = refundType === "SHOP_NOW" ? "EXCHANGE" : refundType;

  const totalsArgs = {
    lines: selectedLines.map((l) => ({ price: l.unitPrice, qty: qty[l.id] ?? 0, reason: reasons[l.id] })),
    refundType: serverRefund,
    returnMethod,
    settings: cfg.fees,
    feesEnabled: cfg.fees.enabled,
    bonusEnabled: cfg.bonus.enabled,
  };
  const baseTotals = computeTotals(totalsArgs);
  const keepItem =
    serverRefund !== "EXCHANGE" && isGreenReturn({ enabled: cfg.green.enabled, maxAmount: cfg.green.maxAmount, itemsTotal: baseTotals.itemsTotal });
  const totals = keepItem ? computeTotals({ ...totalsArgs, keepItem: true }) : baseTotals;

  useEffect(() => {
    scrollPortalTop(cfg.embed);
  }, [step, result, cfg.embed]);

  // Load replacement variants when an exchange is chosen.
  useEffect(() => {
    if (refundType !== "EXCHANGE" || !token || selectedLines.length === 0) return;
    const missing = Array.from(new Set(selectedLines.map((l) => l.productId))).filter((p) => !exchangeOptions[p]);
    if (missing.length === 0) return;
    setLoadingOptions(true);
    api<{ options?: Record<string, ExchangeOption[]> }>("/portal-api/exchange-options", { token, productIds: missing }).then((res) => {
      setExchangeOptions((prev) => ({ ...prev, ...(res.options ?? {}) }));
      setLoadingOptions(false);
    });
  }, [refundType, token, selectedLines, exchangeOptions, api]);

  // ── Step 1: find order ──
  const findOrder = async () => {
    setFinding(true);
    setFindError(null);
    const res = await api<FindOrderResponse>("/portal-api/order", { orderNumber: orderNum, email, mode: "return" });
    setFinding(false);
    if (!res.order || !res.token) {
      setFindError(t(res.error ?? "errOrderNotFound"));
      return;
    }
    setOrder(res.order);
    setToken(res.token);
    setPhone(res.order.phone ?? "");
    setPayoutName(res.order.customerName);
    // Preselect the only eligible item for a quicker flow.
    const eligible = res.order.lines.filter((l) => l.eligible);
    setQty(eligible.length === 1 ? { [eligible[0].id]: 1 } : {});
    if (res.chatToken) onIdentified({ chatToken: res.chatToken, email: res.order.email, name: res.order.customerName });
    setStep(2);
  };

  // ── Photos ──
  const addPhoto = async (lineId: string, file: File) => {
    setPhotoError(null);
    setUploading((u) => ({ ...u, [lineId]: true }));
    try {
      const dataUrl = await resizeImage(file);
      const res = await api<{ url?: string; error?: PortalKey }>("/portal-api/photo", { token, dataUrl });
      if (res.url) setPhotos((p) => ({ ...p, [lineId]: [...(p[lineId] ?? []), res.url!].slice(0, 3) }));
      else setPhotoError(t(res.error ?? "photoError"));
    } catch {
      setPhotoError(t("photoError"));
    } finally {
      setUploading((u) => ({ ...u, [lineId]: false }));
    }
  };

  const reasonDef = (label: string | undefined) => cfg.reasons.find((r) => r.label === label);

  // ── Validation ──
  const step3Valid =
    selectedLines.length > 0 &&
    selectedLines.every((l) => {
      const r = reasons[l.id];
      if (!r) return false;
      if (reasonDef(r)?.requirePhoto && !(photos[l.id]?.length > 0)) return false;
      return !uploading[l.id];
    });
  const payoutKind = payoutMethodKind(payoutMethod);
  const step4Valid =
    (refundType !== "EXCHANGE" && refundType !== "SHOP_NOW"
      ? true
      : selectedLines.every((l) => !!choice[l.id])) &&
    (!offlinePayout || (!!payoutMethod && (payoutKind === "cash" || (payoutAccount.trim().length >= 4 && payoutName.trim().length >= 2)))) &&
    cfg.returnMethods.includes(returnMethod);

  const next = (from: number) => {
    if (from === 3) return needsResolution ? 4 : confirmStep;
    return from + 1;
  };
  const prev = (from: number) => {
    if (from === confirmStep) return needsResolution ? 4 : 3;
    return from - 1;
  };

  // ── Submit ──
  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const res = await api<{ rma?: string; keepItem?: boolean; view?: StatusView; error?: PortalKey }>("/portal-api/submit", {
      token,
      locale: cfg.locale,
      refundType,
      returnMethod,
      lines: selectedLines.map((l) => ({
        lineItemId: l.id,
        qty: qty[l.id],
        reason: reasons[l.id],
        note: notes[l.id] ?? "",
        photos: photos[l.id] ?? [],
        exchangeVariantId: choice[l.id]?.id ?? null,
      })),
      payout: offlinePayout ? { method: payoutMethod, account: payoutAccount, name: payoutName } : null,
      phone,
      whatsappOptIn,
      exchangeNote,
    });
    setSubmitting(false);
    if (res.rma) {
      setResult({ rma: res.rma, keepItem: !!res.keepItem, view: res.view });
      if (res.view) setView(res.view);
    } else {
      setSubmitError(t(res.error ?? "errGeneric"));
      if (res.error === "errSession") setStep(1);
    }
  };

  const reset = () => {
    setStep(1);
    setOrder(null);
    setToken("");
    setQty({});
    setReasons({});
    setNotes({});
    setPhotos({});
    setChoice({});
    setRefundType("ORIGINAL_PAYMENT");
    setResult(null);
    setView(null);
    setSubmitError(null);
  };

  // ── Confirmation ──
  if (result) {
    const approved = view?.status === "APPROVED";
    return (
      <PortalShell>
        <PortalCard>
          <div className="text-center max-w-md mx-auto py-2 animate-fadeIn">
            <div className="w-20 h-20 rounded-full grid place-content-center mx-auto mb-5 relative animate-popIn" style={{ background: "#22C55E15" }}>
              <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "#22C55E22" }} />
              <Icon name="Check" size={32} strokeWidth={3.5} style={{ color: "#22C55E" }} className="relative" />
            </div>
            <h2 className="text-[24px] font-bold text-[#0f1117] tracking-tight">{approved ? t("approvedTitle") : t("submittedTitle")}</h2>
            <p className="text-[13.5px] text-[#666] mt-2 leading-relaxed">{t("submittedDesc")}</p>
          </div>
          {view ? (
            <div className="mt-6">
              <StatusDetails view={view} onChange={setView} onNewReturn={reset} />
            </div>
          ) : (
            <div className="mt-6 text-center">
              <div className="text-[20px] font-bold font-mono">{result.rma}</div>
              <PortalBtn variant="outline" onClick={reset} icon="RotateCcw">
                {t("labelStartAnother")}
              </PortalBtn>
            </div>
          )}
          {view && !approved && !view.keepItem && view.status === "PENDING" && (
            <div className="mt-5">
              <Notice kind="info" icon="Clock">
                {t("stepReview")} {view.instructions.method === "ship" ? t("stepShipAfterApproval") : ""}
              </Notice>
            </div>
          )}
        </PortalCard>
      </PortalShell>
    );
  }

  const topStepper = showsTopStepper(cfg.layout, cfg.embed);

  return (
    <PortalShell steps={steps} current={displayStep}>
      {topStepper && <Stepper steps={steps} current={displayStep} onJump={(i) => i < step && setStep(i)} />}
      <div ref={cardRef}>
        <PortalCard key={step}>
          {step === 1 && (
            <div>
              <StepHeader eyebrow={t("step", { n: 1 })} title={t("labelFindOrder")} desc={t("descFindOrder")} />
              {findError && (
                <div className="mt-4">
                  <Notice>{findError}</Notice>
                </div>
              )}
              <div className="mt-6 space-y-4 max-w-md">
                <PortalInput label={t("orderNumber")} value={orderNum} onChange={setOrderNum} placeholder="#1089" maxLength={40} onEnter={findOrder} />
                <PortalInput label={t("emailAddress")} value={email} onChange={setEmail} placeholder="you@email.com" type="email" autoComplete="email" onEnter={findOrder} />
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
                {cfg.supportEmail ? (
                  <a href={`mailto:${cfg.supportEmail}`} className="text-[12.5px] hover:underline" style={{ color: "var(--brand)" }}>
                    {t("labelCantFind")}
                  </a>
                ) : (
                  <span />
                )}
                <PortalBtn onClick={findOrder} disabled={!orderNum.trim() || !email.includes("@")} loading={finding} iconRight="ArrowRight">
                  {finding ? t("searching") : t("labelCta")}
                </PortalBtn>
              </div>
              <div className="mt-8 pt-5 border-t border-[#e6e6ec] flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-[13px] font-medium">
                <button type="button" onClick={onTrack} className="flex items-center gap-2 text-[#444] hover:text-[#111] transition">
                  <Icon name="Search" size={15} /> {t("labelTrackingToggle")}
                </button>
                {cfg.policy.trim() && (
                  <button type="button" onClick={() => setPolicyOpen(true)} className="flex items-center gap-2 text-[#444] hover:text-[#111] transition">
                    <Icon name="FileText" size={15} /> {t("readPolicy")}
                  </button>
                )}
                {cfg.withdrawal && (
                  <button type="button" onClick={onWithdraw} className="flex items-center gap-2 font-semibold transition" style={{ color: "var(--brand)" }}>
                    <Icon name="FileX" size={15} /> {t("withdrawLink")}
                  </button>
                )}
              </div>
              <Sheet open={policyOpen} title={t("returnPolicy")} onClose={() => setPolicyOpen(false)}>
                {cfg.policy}
              </Sheet>
            </div>
          )}

          {step === 2 && order && (
            <div>
              <StepHeader
                eyebrow={t("step", { n: 2 })}
                title={t("labelSelectItems")}
                desc={
                  <>
                    {t("descSelectItems")} <span className="font-semibold text-[#0f1117]">{t("fromOrder", { order: order.name, date: new Date(order.createdAt).toLocaleDateString(cfg.locale === "fr" ? "fr-FR" : "en-US") })}</span>
                  </>
                }
              />
              {order.lines.every((l) => !l.eligible) && (
                <div className="mt-4">
                  <Notice kind="warn">{t("noEligibleItems")}</Notice>
                </div>
              )}
              <div className="mt-6 space-y-2">
                {order.lines.map((line) => {
                  const selected = (qty[line.id] ?? 0) > 0;
                  const disabled = !line.eligible;
                  const reasonText = line.reason
                    ? t(REASON_KEYS[line.reason], {
                        date: line.deadline ? new Date(line.deadline).toLocaleDateString(cfg.locale === "fr" ? "fr-FR" : "en-US") : "",
                      })
                    : "";
                  return (
                    <div
                      key={line.id}
                      role="checkbox"
                      aria-checked={selected}
                      aria-disabled={disabled}
                      tabIndex={disabled ? -1 : 0}
                      onClick={() => !disabled && setQty((q) => ({ ...q, [line.id]: selected ? 0 : 1 }))}
                      onKeyDown={(e) => {
                        if (!disabled && (e.key === " " || e.key === "Enter")) {
                          e.preventDefault();
                          setQty((q) => ({ ...q, [line.id]: selected ? 0 : 1 }));
                        }
                      }}
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-[border-color,background-color,box-shadow] duration-200 ${
                        disabled ? "border-[#e6e6ec] opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-[#cfd3dc] hover:bg-[#fafbfc]"
                      } ${!disabled && selected ? "shadow-[0_2px_12px_-4px_color-mix(in_srgb,var(--brand)_30%,transparent)]" : ""}`}
                      style={!disabled && selected ? { borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, white)" } : !disabled ? { borderColor: "#e6e6ec" } : {}}
                    >
                      <div
                        className="w-5 h-5 rounded-md grid place-content-center shrink-0 transition"
                        style={disabled ? { background: "#e6e6ec" } : selected ? { background: "var(--brand)" } : { background: "#fff", border: "2px solid #d8dce5" }}
                      >
                        {disabled ? <Icon name="Ban" size={11} className="text-[#999]" /> : selected && <Icon name="Check" size={12} className="text-white" strokeWidth={3.5} />}
                      </div>
                      <Thumb src={line.image} alt={line.title} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-[#0f1117] truncate">{line.title}</div>
                        {line.variantTitle && line.variantTitle !== "Default Title" && <div className="text-[12.5px] text-[#666] mt-0.5">{line.variantTitle}</div>}
                        {disabled ? (
                          <div className="text-[11.5px] text-red-500 mt-0.5 font-medium">{reasonText}</div>
                        ) : (
                          line.deadline && (
                            <div className="text-[11.5px] text-[#888] mt-0.5">
                              {t("returnBy", { date: new Date(line.deadline).toLocaleDateString(cfg.locale === "fr" ? "fr-FR" : "en-US") })}
                            </div>
                          )
                        )}
                      </div>
                      {selected && !disabled && line.maxQty > 1 && (
                        <div className="flex items-center bg-white rounded-md border border-[#e6e6ec] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setQty((q) => ({ ...q, [line.id]: Math.max(1, (q[line.id] ?? 1) - 1) }))}
                            className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]"
                            aria-label="-"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-[13px] font-semibold tabular-nums">{qty[line.id]}</span>
                          <button
                            type="button"
                            onClick={() => setQty((q) => ({ ...q, [line.id]: Math.min(line.maxQty, (q[line.id] ?? 1) + 1) }))}
                            className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]"
                            aria-label="+"
                          >
                            +
                          </button>
                        </div>
                      )}
                      <div className="text-[14px] font-semibold text-[#0f1117] tabular-nums text-right min-w-[64px]">{money(line.unitPrice)}</div>
                    </div>
                  );
                })}
              </div>
              <NavRow onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={selectedLines.length === 0} />
            </div>
          )}

          {step === 3 && order && (
            <div>
              <StepHeader eyebrow={t("stepOf", { n: 3, total: steps.length })} title={t("labelReasons")} desc={t("descReasons")} />
              {photoError && (
                <div className="mt-4">
                  <Notice>{photoError}</Notice>
                </div>
              )}
              <div className="mt-6 space-y-4">
                {selectedLines.map((line) => {
                  const def = reasonDef(reasons[line.id]);
                  const photosOn = cfg.photos.enabled || !!def?.requirePhoto;
                  const list = photos[line.id] ?? [];
                  return (
                    <div key={line.id} className="p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc] space-y-3">
                      <div className="flex items-center gap-3">
                        <Thumb src={line.image} alt={line.title} size={40} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-semibold text-[#0f1117] truncate">{line.title}</div>
                          <div className="text-[12px] text-[#666] truncate">
                            {line.variantTitle && line.variantTitle !== "Default Title" ? `${line.variantTitle} · ` : ""}
                            {t("qty")} {qty[line.id]}
                          </div>
                        </div>
                      </div>
                      <PortalSelect
                        label={t("selectReason")}
                        value={reasons[line.id] ?? ""}
                        placeholder={t("chooseReason")}
                        onChange={(v) => setReasons((r) => ({ ...r, [line.id]: v }))}
                        options={cfg.reasons.map((r) => ({ value: r.label, label: r.label }))}
                      />
                      <PortalTextarea
                        label={t("notes")}
                        optional
                        value={notes[line.id] ?? ""}
                        onChange={(v) => setNotes((n) => ({ ...n, [line.id]: v }))}
                        placeholder={t("notesPlaceholder")}
                      />
                      {photosOn && (
                        <div>
                          <div className="text-[12.5px] font-medium text-[#444] mb-1.5">
                            {t("photos")}
                            {!def?.requirePhoto && <span className="text-[#aaa] font-normal"> ({t("optional")})</span>}
                          </div>
                          {def?.requirePhoto && list.length === 0 && <div className="text-[12px] text-amber-700 mb-2">{t("photosRequired")}</div>}
                          <div className="flex items-center gap-2 flex-wrap">
                            {list.map((url) => (
                              <div key={url} className="relative">
                                <img src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-[#e6e6ec]" />
                                <button
                                  type="button"
                                  onClick={() => setPhotos((p) => ({ ...p, [line.id]: (p[line.id] ?? []).filter((u) => u !== url) }))}
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#0f1117] text-white grid place-content-center"
                                  aria-label="remove"
                                >
                                  <Icon name="X" size={10} />
                                </button>
                              </div>
                            ))}
                            {list.length < 3 && (
                              <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[#d8dce5] grid place-content-center cursor-pointer hover:border-[color:var(--brand)] transition text-[#888]">
                                {uploading[line.id] ? <Icon name="LoaderCircle" size={16} className="animate-spin" /> : <Icon name="Camera" size={18} />}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  disabled={!!uploading[line.id]}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) addPhoto(line.id, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          <div className="text-[11px] text-[#999] mt-1.5">{t("photoHint")}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <NavRow onBack={() => setStep(prev(3))} onNext={() => setStep(next(3))} nextDisabled={!step3Valid} />
            </div>
          )}

          {step === 4 && needsResolution && order && (
            <ResolutionStep
              stepsTotal={steps.length}
              refundChoices={refundChoices}
              refundType={refundType}
              setRefundType={setRefundType}
              isOffline={!!order.isOfflinePayment && cfg.cod.enabled}
              totals={totals}
              keepItem={keepItem}
              selectedLines={selectedLines}
              exchangeOptions={exchangeOptions}
              loadingOptions={loadingOptions}
              choice={choice}
              setChoice={setChoice}
              token={token}
              exchangeNote={exchangeNote}
              setExchangeNote={setExchangeNote}
              payout={{ method: payoutMethod, account: payoutAccount, name: payoutName }}
              setPayout={(p) => {
                if (p.method !== undefined) setPayoutMethod(p.method);
                if (p.account !== undefined) setPayoutAccount(p.account);
                if (p.name !== undefined) setPayoutName(p.name);
              }}
              returnMethod={returnMethod}
              setReturnMethod={setReturnMethod}
              onBack={() => setStep(3)}
              onNext={() => setStep(confirmStep)}
              canContinue={step4Valid}
            />
          )}

          {step === confirmStep && order && (
            <div>
              <StepHeader eyebrow={t("stepOf", { n: steps.length, total: steps.length })} title={t("labelConfirm")} desc={t("descConfirm")} />
              {submitError && (
                <div className="mt-4">
                  <Notice>{submitError}</Notice>
                </div>
              )}
              <div className="mt-6 space-y-3">
                {selectedLines.map((line) => (
                  <div key={line.id} className="flex gap-4 p-4 rounded-xl border border-[#e6e6ec] bg-white">
                    <Thumb src={line.image} alt={line.title} size={56} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-3">
                        <div className="text-[13.5px] font-semibold text-[#0f1117] truncate">{line.title}</div>
                        <div className="text-[13.5px] font-semibold tabular-nums">{money(line.unitPrice * (qty[line.id] ?? 0))}</div>
                      </div>
                      <div className="text-[12px] text-[#666] mt-0.5 truncate">
                        {line.variantTitle && line.variantTitle !== "Default Title" ? `${line.variantTitle} · ` : ""}
                        {t("qty")} {qty[line.id]}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
                        <span className="px-2 py-0.5 rounded bg-[#f0f0f5] text-[#444]">{reasons[line.id]}</span>
                        {notes[line.id] && <span className="px-2 py-0.5 rounded bg-[#fff7e6] text-[#a07300] italic truncate max-w-xs">"{notes[line.id]}"</span>}
                        {(photos[line.id]?.length ?? 0) > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#f0f0f5] text-[#444] inline-flex items-center gap-1">
                            <Icon name="Camera" size={11} /> {photos[line.id].length}
                          </span>
                        )}
                        {choice[line.id] && (
                          <span className="px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ background: "#3B82F615", color: "#3B82F6" }}>
                            <Icon name="RefreshCw" size={11} /> {choice[line.id].productTitle} — {choice[line.id].title}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <TotalsBox totals={totals} refundType={serverRefund} keepItem={keepItem} />

              {keepItem ? (
                <div className="mt-4">
                  <Notice kind="success" icon="Leaf">
                    <div className="font-semibold">{t("keepItemTitle")}</div>
                    <div className="font-normal mt-0.5">{t("keepItemDesc")}</div>
                  </Notice>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between gap-3 text-[12.5px] text-[#666]">
                  <span className="font-medium">{t("returnMethodLabel")}</span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0f1117]">
                    <Icon name={METHOD_META[returnMethod].icon} size={13} /> {t(METHOD_META[returnMethod].title)}
                  </span>
                </div>
              )}

              <div className="mt-5 space-y-3 max-w-md">
                <PortalInput label={t("phoneLabel")} optional value={phone} onChange={setPhone} type="tel" autoComplete="tel" inputMode="tel" maxLength={30} />
                {cfg.whatsapp.optIn && phone.trim().length >= 8 && (
                  <label className="flex items-center gap-2.5 text-[13px] text-[#444] cursor-pointer">
                    <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} className="w-4 h-4 accent-[color:var(--brand)]" />
                    <Icon name="MessageCircle" size={14} className="text-[#25D366]" /> {t("whatsappOptIn")}
                  </label>
                )}
              </div>

              <div className="mt-4 text-[11.5px] text-[#999]">{t("agreePolicy")}</div>
              <NavRow
                onBack={() => setStep(prev(confirmStep))}
                onNext={submit}
                nextLabel={submitting ? t("submitting") : t("labelSubmit")}
                nextLoading={submitting}
                nextIcon="CircleCheck"
              />
            </div>
          )}
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function TotalsBox({ totals, refundType, keepItem }: { totals: ReturnType<typeof computeTotals>; refundType: string; keepItem: boolean }) {
  const { t, money } = usePortal();
  const isCredit = refundType === "STORE_CREDIT";
  return (
    <div className="mt-5 p-4 rounded-xl bg-[#fafbfc] border border-[#e6e6ec] text-[13px]">
      <div className="flex justify-between text-[#666]">
        <span>{t("subtotal")}</span>
        <span className="tabular-nums">{money(totals.itemsTotal)}</span>
      </div>
      {!keepItem && totals.restockingFee > 0 && (
        <div className="flex justify-between text-[#666] mt-1">
          <span>{t("restockingFee")}</span>
          <span className="tabular-nums">−{money(totals.restockingFee)}</span>
        </div>
      )}
      {!keepItem && totals.shippingFee > 0 && (
        <div className="flex justify-between text-[#666] mt-1">
          <span>{t("shippingFee")}</span>
          <span className="tabular-nums">−{money(totals.shippingFee)}</span>
        </div>
      )}
      {totals.feesWaived && (
        <div className="flex justify-between mt-1" style={{ color: "#16a34a" }}>
          <span>
            {t("restockingFee")} / {t("shippingFee")}
          </span>
          <span className="font-semibold">{t("waived")}</span>
        </div>
      )}
      {totals.bonus > 0 && (
        <div className="flex justify-between mt-1" style={{ color: "var(--brand)" }}>
          <span className="flex items-center gap-1">
            <Icon name="Sparkles" size={11} /> {t("bonusCredit", { pct: totals.bonusPercent })}
          </span>
          <span className="tabular-nums">+{money(totals.bonus)}</span>
        </div>
      )}
      <div className="border-t border-[#e6e6ec] my-2.5" />
      <div className="flex justify-between text-[15px] font-bold text-[#0f1117]">
        <span>{refundType === "EXCHANGE" ? t("exchangeValue") : isCredit ? t("totalCredit") : t("estimatedRefund")}</span>
        <span className="tabular-nums">{money(totals.refundTotal)}</span>
      </div>
    </div>
  );
}

function ResolutionStep(props: {
  stepsTotal: number;
  refundChoices: RefundChoice[];
  refundType: RefundChoice;
  setRefundType: (r: RefundChoice) => void;
  isOffline: boolean;
  totals: ReturnType<typeof computeTotals>;
  keepItem: boolean;
  selectedLines: PortalLine[];
  exchangeOptions: Record<string, ExchangeOption[]>;
  loadingOptions: boolean;
  choice: Record<string, ExchangeOption>;
  setChoice: Dispatch<SetStateAction<Record<string, ExchangeOption>>>;
  token: string;
  exchangeNote: string;
  setExchangeNote: (v: string) => void;
  payout: { method: string; account: string; name: string };
  setPayout: (p: Partial<{ method: string; account: string; name: string }>) => void;
  returnMethod: ReturnMethodKey;
  setReturnMethod: (m: ReturnMethodKey) => void;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}) {
  const { cfg, t, money } = usePortal();
  const baseRefund = props.totals.baseRefund;
  const bonusPct = cfg.bonus.enabled ? cfg.bonus.percent : 0;

  const options: Record<RefundChoice, { icon: string; title: string; desc: string; badge?: { label: string; accent?: boolean }; extra?: string }> = {
    ORIGINAL_PAYMENT: props.isOffline
      ? { icon: "Smartphone", title: t("refundOfflineTitle"), desc: t("refundOfflineDesc") }
      : { icon: "CreditCard", title: t("refundOriginalTitle"), desc: t("refundOriginalDesc") },
    STORE_CREDIT: {
      icon: "Gift",
      title: t("storeCreditTitle"),
      desc: t("storeCreditDesc"),
      badge: bonusPct > 0 ? { label: t("bonusBadge", { pct: bonusPct }), accent: true } : { label: t("fastest"), accent: true },
      extra:
        bonusPct > 0 && baseRefund > 0
          ? t("bonusLine", { total: money(baseRefund * (1 + bonusPct / 100)), base: money(baseRefund) })
          : undefined,
    },
    EXCHANGE: { icon: "RefreshCw", title: t("exchangeTitle"), desc: t("exchangeDesc"), badge: { label: t("recommended") } },
    SHOP_NOW: { icon: "ShoppingBag", title: t("shopNowTitle"), desc: t("shopNowDesc") },
  };

  return (
    <div>
      <StepHeader eyebrow={t("stepOf", { n: 4, total: props.stepsTotal })} title={t("labelRefundType")} desc={t("descRefundType")} />

      {props.refundChoices.length > 1 || props.isOffline ? (
        <div className="mt-6 space-y-3" role="radiogroup">
          {props.refundChoices.map((key) => {
            const opt = options[key];
            const selected = props.refundType === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  props.setRefundType(key);
                  if (key === "EXCHANGE" || key === "SHOP_NOW") props.setChoice({});
                }}
                className={`w-full text-left p-4 rounded-xl border-2 relative transition-[border-color,background-color,transform,box-shadow] duration-200 active:scale-[0.995] hover:-translate-y-[1px] ${
                  selected ? "shadow-[0_4px_16px_-4px_color-mix(in_srgb,var(--brand)_30%,transparent)]" : "hover:border-[#cfd3dc] hover:bg-[#fafbfc]"
                }`}
                style={selected ? { borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, #fff)" } : { borderColor: "#e6e6ec", background: "#fff" }}
              >
                {selected && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full grid place-content-center" style={{ background: "var(--brand)" }}>
                    <Icon name="Check" size={13} strokeWidth={3.5} className="text-white" />
                  </div>
                )}
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-lg grid place-content-center shrink-0 transition-colors" style={{ background: selected ? "var(--brand)" : "#f0f0f5", color: selected ? "#fff" : "#444" }}>
                    <Icon name={opt.icon} size={18} />
                  </div>
                  <div className="flex-1 min-w-0 pr-8">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.5px] font-bold text-[#0f1117]">{opt.title}</span>
                      {opt.badge && (
                        <span
                          className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full tracking-wide"
                          style={opt.badge.accent ? { background: "var(--brand)", color: "white" } : { background: "#3B82F615", color: "#3B82F6" }}
                        >
                          {opt.badge.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] text-[#666] mt-1 leading-relaxed">{opt.desc}</div>
                    {opt.extra && (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold" style={{ background: "color-mix(in srgb, var(--brand) 10%, transparent)", color: "var(--brand)" }}>
                        <Icon name="Sparkles" size={11} /> {opt.extra}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {props.refundType === "ORIGINAL_PAYMENT" && props.isOffline && (
        <div className="mt-5 p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc] space-y-3">
          <div className="text-[13.5px] font-semibold text-[#0f1117]">{t("payoutTitle")}</div>
          <PortalSelect
            label={t("payoutMethod")}
            value={props.payout.method}
            onChange={(v) => props.setPayout({ method: v })}
            options={cfg.cod.methods.map((k) => ({ value: k, label: PAYOUT_METHODS.find((p) => p.key === k)?.label[cfg.locale] ?? k }))}
          />
          {payoutMethodKind(props.payout.method) === "cash" ? (
            <div className="text-[12.5px] text-[#666]">{t("payoutCashNote")}</div>
          ) : (
            <>
              <PortalInput
                label={
                  payoutMethodKind(props.payout.method) === "phone"
                    ? t("payoutAccountPhone")
                    : payoutMethodKind(props.payout.method) === "bank"
                      ? t("payoutAccountBank")
                      : t("payoutAccountOther")
                }
                value={props.payout.account}
                onChange={(v) => props.setPayout({ account: v })}
                inputMode={payoutMethodKind(props.payout.method) === "phone" ? "tel" : "text"}
                maxLength={60}
              />
              <PortalInput label={t("payoutName")} value={props.payout.name} onChange={(v) => props.setPayout({ name: v })} maxLength={80} />
            </>
          )}
        </div>
      )}

      {props.refundType === "EXCHANGE" && (
        <div className="mt-5 space-y-3">
          {props.selectedLines.map((line) => {
            const options = (props.exchangeOptions[line.productId] ?? []).filter((o) => o.id !== line.variantId);
            return (
              <div key={line.id} className="p-4 rounded-xl border border-[#3B82F630] bg-[#3B82F608]">
                <div className="flex items-center gap-3 mb-3">
                  <Thumb src={line.image} alt={line.title} size={36} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#0f1117] truncate">{line.title}</div>
                    <div className="text-[12px] text-[#666]">{t("chooseReplacement")}</div>
                  </div>
                </div>
                {props.loadingOptions && options.length === 0 ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-[#888]">
                    <Icon name="LoaderCircle" size={13} className="animate-spin" /> …
                  </div>
                ) : options.length === 0 ? (
                  <div className="text-[12.5px] text-[#888]">{t("noVariants")}</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {options.map((o) => {
                      const sel = props.choice[line.id]?.id === o.id;
                      const diff = o.price - line.unitPrice;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={!o.available}
                          onClick={() => props.setChoice((c) => ({ ...c, [line.id]: o }))}
                          className={`px-3 py-2 rounded-lg border-2 text-left text-[12.5px] transition ${!o.available ? "opacity-40 cursor-not-allowed" : "hover:border-[#9db6f5]"}`}
                          style={sel ? { borderColor: "#3B82F6", background: "#fff" } : { borderColor: "#e2e5ec", background: "#fff" }}
                        >
                          <div className="font-semibold text-[#0f1117]">{o.title}</div>
                          <div className="text-[11px] text-[#888]">
                            {!o.available
                              ? t("outOfStock")
                              : Math.abs(diff) < 0.01
                                ? money(o.price)
                                : diff > 0
                                  ? t("priceDiffMore", { amount: money(diff) })
                                  : t("priceDiffLess", { amount: money(-diff) })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <PortalTextarea label={t("notes")} optional value={props.exchangeNote} onChange={props.setExchangeNote} maxLength={500} />
        </div>
      )}

      {props.refundType === "SHOP_NOW" && (
        <div className="mt-5 space-y-3">
          {props.selectedLines.map((line) => (
            <ShopNowPicker key={line.id} line={line} token={props.token} value={props.choice[line.id]} onPick={(o) => props.setChoice((c) => ({ ...c, [line.id]: o }))} />
          ))}
        </div>
      )}

      {!props.keepItem && cfg.returnMethods.length > 1 && (
        <div className="mt-7">
          <div className="text-[14.5px] font-bold text-[#0f1117] mb-3">{t("returnMethodTitle")}</div>
          <div className="grid sm:grid-cols-2 gap-2.5" role="radiogroup">
            {cfg.returnMethods.map((m) => {
              const meta = METHOD_META[m];
              const sel = props.returnMethod === m;
              const fee = cfg.fees.enabled && methodHasShippingFee(m) ? cfg.fees.returnShippingFee : 0;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => props.setReturnMethod(m)}
                  className="text-left p-3.5 rounded-xl border-2 transition hover:-translate-y-[1px]"
                  style={sel ? { borderColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 5%, #fff)" } : { borderColor: "#e6e6ec", background: "#fff" }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name={meta.icon} size={15} style={{ color: sel ? "var(--brand)" : "#666" }} />
                    <span className="text-[13.5px] font-bold text-[#0f1117]">{t(meta.title)}</span>
                  </div>
                  <div className="text-[12px] text-[#666] mt-1">{t(meta.desc)}</div>
                  {fee > 0 && <div className="text-[11px] font-semibold text-[#a07300] mt-1">{t("fee", { amount: money(fee) })}</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {props.keepItem && (
        <div className="mt-5">
          <Notice kind="success" icon="Leaf">
            <div className="font-semibold">{t("keepItemTitle")}</div>
            <div className="font-normal mt-0.5">{t("keepItemDesc")}</div>
          </Notice>
        </div>
      )}

      <NavRow onBack={props.onBack} onNext={props.onNext} nextDisabled={!props.canContinue} />
    </div>
  );
}

function ShopNowPicker({ line, token, value, onPick }: { line: PortalLine; token: string; value?: ExchangeOption; onPick: (o: ExchangeOption) => void }) {
  const { t, api, money } = usePortal();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ExchangeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(!value);

  const search = async () => {
    setLoading(true);
    const res = await api<{ results?: ExchangeOption[] }>("/portal-api/products", { token, q });
    setResults(res.results ?? []);
    setLoading(false);
  };

  return (
    <div className="p-4 rounded-xl border border-[#e6e6ec] bg-white">
      <div className="flex items-center gap-3">
        <Thumb src={line.image} alt={line.title} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#0f1117] truncate">{line.title}</div>
          <div className="text-[12px] text-[#666] truncate">
            {value ? `→ ${value.productTitle} — ${value.title} (${money(value.price)})` : t("chooseReplacement")}
          </div>
        </div>
        {value && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold" style={{ color: "var(--brand)" }}>
            {t("selectOption")}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder={t("searchProducts")}
              className="flex-1 h-10 px-3 rounded-lg border border-[#e2e5ec] text-[13px] focus:outline-none focus:border-[color:var(--brand)]"
              maxLength={80}
            />
            <PortalBtn variant="outline" onClick={search} loading={loading} icon="Search">
              {t("lookUp")}
            </PortalBtn>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {!loading && results.length === 0 && q && <div className="text-[12.5px] text-[#888] col-span-full">{t("noProducts")}</div>}
            {results.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={!o.available}
                onClick={() => {
                  onPick(o);
                  setOpen(false);
                }}
                className="text-left p-2 rounded-lg border border-[#e6e6ec] hover:border-[color:var(--brand)] transition disabled:opacity-40"
              >
                {o.image && <img src={o.image} alt="" className="w-full h-20 object-cover rounded-md mb-1.5" loading="lazy" />}
                <div className="text-[12px] font-semibold text-[#0f1117] truncate">{o.productTitle}</div>
                <div className="text-[11px] text-[#666] truncate">{o.title !== "Default Title" ? o.title : ""}</div>
                <div className="text-[11.5px] font-semibold mt-0.5">{o.available ? money(o.price) : t("outOfStock")}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

