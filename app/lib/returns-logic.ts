/**
 * Pure return-business rules shared by the portal, the admin and background
 * jobs: eligibility, fees & totals, green returns, risk and status
 * precedence. No I/O here — everything is unit-tested in tests/.
 */

// ─── Return methods ─────────────────────────────────────────────────────────

export const RETURN_METHOD_KEYS = ["ship", "label", "store", "pickup"] as const;
export type ReturnMethodKey = (typeof RETURN_METHOD_KEYS)[number];

export function parseList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Enabled return methods. `returnMethods` is the new comma list; when empty
 * we derive it from the legacy `returnShippingMethod` setting so existing
 * shops keep their behaviour.
 */
export function getReturnMethods(settings: {
  returnMethods?: string | null;
  returnShippingMethod?: string | null;
}): ReturnMethodKey[] {
  const explicit = parseList(settings.returnMethods).filter((m): m is ReturnMethodKey =>
    (RETURN_METHOD_KEYS as readonly string[]).includes(m),
  );
  if (explicit.length > 0) return Array.from(new Set(explicit));
  return [settings.returnShippingMethod === "merchant_provides_label" ? "label" : "ship"];
}

/** Methods for which the merchant bears the shipping (return fee may apply). */
export function methodHasShippingFee(method: string): boolean {
  return method === "label" || method === "pickup";
}

// ─── Eligibility ────────────────────────────────────────────────────────────

export type IneligibleReason =
  | "FINAL_SALE"
  | "NOT_FULFILLED"
  | "ALREADY_RETURNED"
  | "WINDOW_EXPIRED"
  | "DISCOUNTED"
  | "ONE_RETURN_PER_ORDER";

export interface EligibilitySettings {
  returnWindow: number;
  returnWindowBasis: string; // "order" | "fulfillment"
  blockedSkus: string;
  blockedTags: string;
  blockedProductTypes: string;
  blockDiscountedItems: boolean;
  oneReturnPerOrder: boolean;
}

export interface EligibilityLine {
  productId: string;
  variantId?: string | null;
  sku?: string | null;
  productTags?: string[];
  productType?: string | null;
  isDiscounted?: boolean;
  /** Quantity Shopify still considers returnable (fulfilled − already returned). */
  returnableQty: number;
  /** Quantity still on the order (used for withdrawals before delivery). */
  unfulfilledQty?: number;
  /** Quantity locked by local TrackBack requests that aren't in Shopify yet. */
  lockedQty?: number;
  fulfilledAt?: string | Date | null;
  deliveredAt?: string | Date | null;
}

export interface EligibilityResult {
  eligible: boolean;
  maxQty: number;
  reason?: IneligibleReason;
  deadline?: string; // ISO
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** EU statutory withdrawal period (days after delivery). */
export const EU_WITHDRAWAL_DAYS = 14;

function numericId(gid: string | null | undefined): string {
  return String(gid ?? "").split("/").pop() ?? "";
}

/** Exact, case-insensitive match against SKU, numeric product id or full GID. */
export function isBlocked(line: EligibilityLine, settings: EligibilitySettings): boolean {
  const blockedIds = parseList(settings.blockedSkus).map((s) => s.toLowerCase());
  if (blockedIds.length > 0) {
    const sku = String(line.sku ?? "").toLowerCase();
    const pid = String(line.productId ?? "").toLowerCase();
    const pnum = numericId(line.productId).toLowerCase();
    const vnum = numericId(line.variantId).toLowerCase();
    if (blockedIds.some((b) => (sku && b === sku) || b === pid || (pnum && b === pnum) || (vnum && b === vnum))) {
      return true;
    }
  }
  const blockedTags = parseList(settings.blockedTags).map((s) => s.toLowerCase());
  if (blockedTags.length > 0 && (line.productTags ?? []).some((t) => blockedTags.includes(t.toLowerCase()))) {
    return true;
  }
  const blockedTypes = parseList(settings.blockedProductTypes).map((s) => s.toLowerCase());
  if (blockedTypes.length > 0 && line.productType && blockedTypes.includes(line.productType.toLowerCase())) {
    return true;
  }
  return false;
}

export function returnDeadline(args: {
  line: EligibilityLine;
  orderCreatedAt: string | Date;
  settings: Pick<EligibilitySettings, "returnWindow" | "returnWindowBasis">;
  mode?: "return" | "withdrawal";
}): Date {
  const mode = args.mode ?? "return";
  const windowDays =
    mode === "withdrawal"
      ? Math.max(EU_WITHDRAWAL_DAYS, Number(args.settings.returnWindow) || 0)
      : Math.max(0, Number(args.settings.returnWindow) || 0);
  const useOrderDate = mode !== "withdrawal" && args.settings.returnWindowBasis === "order";
  const start = useOrderDate
    ? new Date(args.orderCreatedAt)
    : new Date(args.line.deliveredAt ?? args.line.fulfilledAt ?? args.orderCreatedAt);
  // Deadline is the end of the last allowed day.
  const end = new Date(start.getTime() + windowDays * DAY_MS);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function evaluateLine(
  line: EligibilityLine,
  ctx: {
    settings: EligibilitySettings;
    orderCreatedAt: string | Date;
    now?: Date;
    hasOpenReturnOnOrder?: boolean;
    mode?: "return" | "withdrawal";
  },
): EligibilityResult {
  const now = ctx.now ?? new Date();
  const mode = ctx.mode ?? "return";
  const locked = Math.max(0, line.lockedQty ?? 0);
  // A withdrawal (EU) can also cover items that haven't shipped yet.
  const available =
    (line.returnableQty ?? 0) + (mode === "withdrawal" ? Math.max(0, line.unfulfilledQty ?? 0) : 0);
  const maxQty = Math.max(0, available - locked);

  if (isBlocked(line, ctx.settings)) return { eligible: false, maxQty: 0, reason: "FINAL_SALE" };
  if (mode === "withdrawal" && maxQty > 0 && !line.fulfilledAt && !line.deliveredAt) {
    return { eligible: true, maxQty };
  }
  if (mode === "return" && ctx.settings.blockDiscountedItems && line.isDiscounted) {
    return { eligible: false, maxQty: 0, reason: "DISCOUNTED" };
  }
  if (mode === "return" && ctx.settings.oneReturnPerOrder && ctx.hasOpenReturnOnOrder) {
    return { eligible: false, maxQty: 0, reason: "ONE_RETURN_PER_ORDER" };
  }
  if (!line.fulfilledAt && !line.deliveredAt && (line.returnableQty ?? 0) <= 0) {
    return { eligible: false, maxQty: 0, reason: "NOT_FULFILLED" };
  }
  if (maxQty <= 0) {
    return { eligible: false, maxQty: 0, reason: line.fulfilledAt || line.deliveredAt ? "ALREADY_RETURNED" : "NOT_FULFILLED" };
  }

  const deadline = returnDeadline({ line, orderCreatedAt: ctx.orderCreatedAt, settings: ctx.settings, mode });
  if (now.getTime() > deadline.getTime()) {
    return { eligible: false, maxQty: 0, reason: "WINDOW_EXPIRED", deadline: deadline.toISOString() };
  }
  return { eligible: true, maxQty, deadline: deadline.toISOString() };
}

// ─── Fees, bonus & totals ───────────────────────────────────────────────────

export interface FeeSettings {
  restockingFeePercent: number;
  returnShippingFee: number;
  feeWaivedForStoreCredit: boolean;
  feeWaivedForExchange: boolean;
  feeExemptReasons: string;
  storeCreditBonusPercent: number;
  incentivizeStoreCredit: boolean;
}

export interface TotalsLine {
  price: number;
  qty: number;
  reason?: string | null;
}

export interface Totals {
  itemsTotal: number;
  restockingFee: number;
  shippingFee: number;
  feeTotal: number;
  feesWaived: boolean;
  bonus: number;
  bonusPercent: number;
  /** Amount due to the customer before bonus (items − fees). */
  baseRefund: number;
  /** What the customer receives (base + bonus for store credit). */
  refundTotal: number;
}

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function computeTotals(args: {
  lines: TotalsLine[];
  refundType: string;
  returnMethod: string;
  keepItem?: boolean;
  settings: FeeSettings;
  /** Plan allows fees (Starter+). */
  feesEnabled: boolean;
  /** Plan allows the store-credit bonus (Starter+). */
  bonusEnabled: boolean;
}): Totals {
  const exempt = parseList(args.settings.feeExemptReasons).map((r) => r.toLowerCase());
  const isExempt = (reason?: string | null) => !!reason && exempt.includes(reason.toLowerCase());

  let itemsTotal = 0;
  let restockBase = 0;
  for (const l of args.lines) {
    const lineTotal = (Number(l.price) || 0) * Math.max(0, Math.floor(Number(l.qty) || 0));
    itemsTotal += lineTotal;
    if (!isExempt(l.reason)) restockBase += lineTotal;
  }
  itemsTotal = round2(itemsTotal);

  const waived =
    (args.refundType === "STORE_CREDIT" && args.settings.feeWaivedForStoreCredit) ||
    (args.refundType === "EXCHANGE" && args.settings.feeWaivedForExchange);

  let restockingFee = 0;
  let shippingFee = 0;
  if (args.feesEnabled && !args.keepItem) {
    const pct = Math.min(100, Math.max(0, Number(args.settings.restockingFeePercent) || 0));
    restockingFee = round2((restockBase * pct) / 100);
    const allExempt = args.lines.length > 0 && args.lines.every((l) => isExempt(l.reason));
    if (methodHasShippingFee(args.returnMethod) && !allExempt) {
      shippingFee = round2(Math.max(0, Number(args.settings.returnShippingFee) || 0));
    }
  }
  const rawFees = restockingFee + shippingFee;
  const feesWaived = waived && rawFees > 0;
  if (waived) {
    restockingFee = 0;
    shippingFee = 0;
  }
  const feeTotal = round2(Math.min(itemsTotal, restockingFee + shippingFee));
  const baseRefund = round2(Math.max(0, itemsTotal - feeTotal));

  const bonusPercent =
    args.bonusEnabled && args.refundType === "STORE_CREDIT" && args.settings.incentivizeStoreCredit
      ? Math.max(0, Number(args.settings.storeCreditBonusPercent) || 0)
      : 0;
  const bonus = round2((baseRefund * bonusPercent) / 100);

  return {
    itemsTotal,
    restockingFee,
    shippingFee,
    feeTotal,
    feesWaived,
    bonus,
    bonusPercent,
    baseRefund,
    refundTotal: round2(baseRefund + bonus),
  };
}

/** Green return: the customer keeps low-value items, no shipping needed. */
export function isGreenReturn(args: { enabled: boolean; maxAmount: number; itemsTotal: number }): boolean {
  return !!args.enabled && Number(args.maxAmount) > 0 && args.itemsTotal > 0 && args.itemsTotal <= Number(args.maxAmount);
}

// ─── Risk ───────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export function assessRisk(args: {
  returnsLast90Days: number;
  customerOrders?: number | null;
  customerReturns?: number;
  threshold: number;
}): { level: RiskLevel; reasons: string[] } {
  const threshold = Math.max(1, Number(args.threshold) || 3);
  const reasons: string[] = [];
  let score = 0;

  if (args.returnsLast90Days >= threshold + 2) {
    score += 2;
    reasons.push("frequent_returner");
  } else if (args.returnsLast90Days >= threshold) {
    score += 1;
    reasons.push("frequent_returner");
  }

  const orders = Number(args.customerOrders) || 0;
  const returns = Number(args.customerReturns) || 0;
  if (orders >= 2 && returns >= 2) {
    const rate = returns / orders;
    if (rate >= 0.6 && returns >= 3) {
      score += 2;
      reasons.push("high_return_rate");
    } else if (rate >= 0.5) {
      score += 1;
      reasons.push("high_return_rate");
    }
  }

  const level: RiskLevel = score >= 2 ? "high" : score === 1 ? "medium" : "low";
  return { level, reasons: Array.from(new Set(reasons)) };
}

// ─── Status precedence (Shopify ⇄ TrackBack sync) ───────────────────────────

export const RETURN_STATUSES = ["PENDING", "APPROVED", "SHIPPED", "RECEIVED", "REFUNDED", "REJECTED", "EXPIRED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  APPROVED: 1,
  SHIPPED: 2,
  RECEIVED: 3,
  REFUNDED: 4,
};
const TERMINAL = new Set(["REFUNDED", "REJECTED", "EXPIRED"]);

/** Maps a Shopify Return.status to TrackBack's (coarser) vocabulary. */
export function mapShopifyReturnStatus(status: string | null | undefined): ReturnStatus {
  switch (String(status ?? "").toUpperCase()) {
    case "OPEN":
      return "APPROVED";
    case "CLOSED":
      return "RECEIVED";
    case "DECLINED":
    case "CANCELED":
      return "REJECTED";
    default:
      return "PENDING";
  }
}

/**
 * Decides whether an incoming Shopify status may overwrite the local one.
 * Shopify's lifecycle is coarser (REQUESTED → OPEN → CLOSED) than ours, so a
 * sync must never move a return backwards (e.g. REFUNDED → RECEIVED after
 * our own `returnClose`, or SHIPPED → APPROVED). Returns the new status, or
 * null when the local status must be kept.
 */
export function mergeShopifyStatus(local: string, incoming: string): ReturnStatus | null {
  if (local === incoming) return null;
  if (TERMINAL.has(local)) return null;
  if (incoming === "REJECTED") {
    return local === "PENDING" || local === "APPROVED" ? "REJECTED" : null;
  }
  const lr = STATUS_RANK[local];
  const ir = STATUS_RANK[incoming];
  if (lr === undefined || ir === undefined) return null;
  return ir > lr ? (incoming as ReturnStatus) : null;
}

// ─── Misc helpers ───────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@"'()<>,;:\\*]+@[^\s@"'()<>,;:\\*]+\.[^\s@"'()<>,;:\\*]{2,}$/;

/** Strict email check — also rejects characters that are meaningful in Shopify search syntax. */
export function isValidEmail(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/** "#1089", "1089", "  #SHOP-1089 " → "1089" / "SHOP-1089". */
export function normalizeOrderNumber(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^#/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
}

/** Normalizes a phone number to digits for wa.me links (keeps country code). */
export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}
