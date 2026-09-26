/**
 * Returns service — the ONLY place where a return is created, changes status
 * or gets refunded. Every entry point (portal, return detail page, bulk
 * actions, automations, cron) goes through here so that emails, Shopify
 * mirroring, the audit trail, outgoing webhooks and order tags stay
 * consistent.
 */
import type { ShopSettings } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import type { EmailType } from "./email-templates";
import type { Locale } from "./i18n";
import { payoutMethodLabel } from "./i18n";
import { formatMoney } from "./money";
import { notifyCustomer, notifyMerchantNewReturn } from "./notifications.server";
import { getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";
import {
  approveShopifyReturn,
  attachShippingToShopifyReturn,
  cancelShopifyReturn,
  closeShopifyReturn,
  createShopifyReturn,
  declineShopifyReturn,
} from "./returns-api.server";
import { assessRisk, round2, type Totals } from "./returns-logic";
import { addOrderTags, createGiftCard, type PortalOrder } from "./shopify-queries.server";
import { emitReturnEvent, type WebhookEvent } from "./webhooks-out.server";

export type AdminClient = { graphql: (query: string, opts?: any) => Promise<Response> };
export type EventSource = "merchant" | "customer" | "system" | "automation";
export type RefundMethod = "ORIGINAL_PAYMENT" | "STORE_CREDIT" | "GIFT_CARD" | "EXCHANGE" | "MANUAL";

type Result = { ok: true } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getOfflineAdmin(shop: string): Promise<AdminClient | null> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    return admin as unknown as AdminClient;
  } catch (e) {
    console.warn(`[returns] no offline session for ${shop}:`, (e as Error)?.message ?? e);
    return null;
  }
}

export async function recordEvent(
  returnRequestId: string,
  e: { type: string; title: string; detail?: string | null; meta?: unknown; source: EventSource },
) {
  try {
    await prisma.returnEvent.create({
      data: {
        returnRequestId,
        type: e.type,
        title: e.title,
        detail: e.detail ?? null,
        meta: e.meta === undefined ? null : JSON.stringify(e.meta),
        source: e.source,
      },
    });
  } catch (err) {
    console.error("[returns] recordEvent failed:", err);
  }
}

/** Global, year-scoped sequence: RMA-2026-000123. Callers retry on collision. */
async function nextRma(offset = 0): Promise<string> {
  const year = new Date().getFullYear();
  const last = await prisma.returnRequest.findFirst({
    where: { rma: { startsWith: `RMA-${year}-` } },
    orderBy: { rma: "desc" },
    select: { rma: true },
  });
  const lastSeq = last ? parseInt(last.rma.split("-")[2] || "0", 10) : 0;
  const next = (Number.isNaN(lastSeq) ? 0 : lastSeq) + 1 + offset;
  return `RMA-${year}-${String(next).padStart(6, "0")}`;
}

export async function createWithUniqueRma<T>(create: (rma: string) => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const rma = await nextRma(attempt);
    try {
      return await create(rma);
    } catch (e: any) {
      lastError = e;
      if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("rma")) continue;
      throw e;
    }
  }
  throw lastError ?? new Error("Could not allocate an RMA number");
}

// ─── Creation (portal) ──────────────────────────────────────────────────────

export interface NewReturnLine {
  lineItemId: string;
  productId: string;
  variantId: string;
  sku: string | null;
  name: string;
  variantName: string;
  image: string | null;
  unitPrice: number;
  qty: number;
  reason: string;
  note?: string | null;
  photos?: string[];
  exchange?: { variantId: string; productTitle: string; variantTitle: string; price: number } | null;
}

export interface NewReturnInput {
  admin: AdminClient | null;
  shop: string;
  plan: string;
  settings: ShopSettings;
  order: PortalOrder;
  requestType: "RETURN" | "WITHDRAWAL";
  locale: Locale;
  lines: NewReturnLine[];
  refundType: "ORIGINAL_PAYMENT" | "STORE_CREDIT" | "EXCHANGE";
  returnMethod: string;
  totals: Totals;
  keepItem: boolean;
  payout?: { method: string; account: string; name: string } | null;
  phone?: string | null;
  whatsappOptIn?: boolean;
  exchangeNote?: string | null;
  customerName?: string | null;
}

export async function createReturnRequest(input: NewReturnInput) {
  const { shop, plan, settings, order } = input;
  const email = order.email.trim().toLowerCase();

  // Risk signals (Pro)
  let riskLevel = "";
  let riskReasons = "";
  if (hasFeature(plan, "fraud")) {
    const since90 = new Date(Date.now() - 90 * DAY_MS);
    const [recent, total] = await Promise.all([
      prisma.returnRequest.count({
        where: { shop, customerEmail: { equals: email, mode: "insensitive" }, createdAt: { gte: since90 } },
      }),
      prisma.returnRequest.count({ where: { shop, customerEmail: { equals: email, mode: "insensitive" } } }),
    ]);
    const risk = assessRisk({
      returnsLast90Days: recent + 1,
      customerOrders: order.customerOrders,
      customerReturns: total + 1,
      threshold: settings.riskReturnThreshold,
    });
    riskLevel = risk.level;
    riskReasons = risk.reasons.join(",");
  }

  const rr = await createWithUniqueRma((rma) =>
    prisma.returnRequest.create({
      data: {
        shop,
        rma,
        orderId: order.id,
        orderName: order.name,
        customerEmail: email,
        customerName: (input.customerName || order.customerName || email.split("@")[0]).slice(0, 120),
        customerPhone: input.phone || order.phone || null,
        customerId: order.customerId,
        orderDate: new Date(order.createdAt),
        orderTotal: order.totalPrice,
        refundType: input.refundType,
        refundAmount: input.totals.refundTotal,
        itemsTotal: input.totals.itemsTotal,
        feeAmount: input.totals.feeTotal,
        storeCreditBonus: input.totals.bonus,
        exchangeNote: input.exchangeNote || null,
        requestType: input.requestType,
        locale: input.locale,
        returnMethod: input.returnMethod,
        keepItem: input.keepItem,
        whatsappOptIn: !!input.whatsappOptIn && hasFeature(plan, "whatsapp"),
        isOfflinePayment: order.isOfflinePayment,
        payoutMethod: input.payout?.method ?? null,
        payoutAccount: input.payout?.account ?? null,
        payoutName: input.payout?.name ?? null,
        riskLevel,
        riskReasons,
        items: {
          create: input.lines.map((l) => ({
            lineItemId: l.lineItemId,
            productId: l.productId,
            variantId: l.variantId,
            sku: l.sku,
            name: l.name,
            variantName: l.variantName,
            quantity: l.qty,
            price: l.unitPrice,
            reason: l.reason,
            note: l.note || "",
            imageUrl: l.image,
            photos: JSON.stringify(l.photos ?? []),
            exchangeVariantId: l.exchange?.variantId ?? null,
            exchangeProductTitle: l.exchange?.productTitle ?? null,
            exchangeVariantTitle: l.exchange?.variantTitle ?? null,
            exchangeVariantPrice: l.exchange?.price ?? null,
          })),
        },
      },
    }),
  );

  await recordEvent(rr.id, {
    type: input.requestType === "WITHDRAWAL" ? "WITHDRAWAL_REQUESTED" : "REQUESTED",
    title: input.requestType === "WITHDRAWAL" ? "Withdrawal received" : "Return requested",
    detail: `${input.lines.length} item(s) · ${input.refundType}${input.keepItem ? " · keep item" : ""}`,
    source: "customer",
  });

  // Mirror into Shopify's native Returns (non-fatal; retried on fulfillment).
  if (input.admin) {
    try {
      const result = await createShopifyReturn(
        input.admin,
        order.id,
        input.lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.qty, reason: l.reason, note: l.note || "" })),
      );
      if (result.shopifyReturnId) {
        await prisma.returnRequest.update({ where: { id: rr.id }, data: { shopifyReturnId: result.shopifyReturnId } });
      } else {
        await recordEvent(rr.id, {
          type: "SHOPIFY_MIRROR_FAILED",
          title: "Not synced to Shopify Admin",
          detail: result.userErrors.map((e: any) => e.message).join("; "),
          source: "system",
        });
      }
    } catch (e: any) {
      if (e?.code === "P2002") {
        // The returns/request webhook already created the mirror row — harmless.
        console.warn("[returns] shopifyReturnId already linked by webhook");
      } else {
        await recordEvent(rr.id, {
          type: "SHOPIFY_MIRROR_FAILED",
          title: "Not synced to Shopify Admin",
          detail: `Unhandled error: ${e?.message ?? String(e)}`,
          source: "system",
        });
      }
    }
  }

  if (input.admin && hasFeature(plan, "orderTags") && settings.orderTagsEnabled) {
    const tags = [input.requestType === "WITHDRAWAL" ? "trackback-withdrawal" : "trackback-return"];
    if (input.refundType === "EXCHANGE") tags.push("trackback-exchange");
    await addOrderTags(input.admin, order.id, tags);
  }

  await emitReturnEvent(shop, "return.created", rr.id);
  await notifyMerchantNewReturn(rr.id);

  // Auto-approval (all plans) with Pro conditions (amount cap, risky customers).
  const pro = hasFeature(plan, "automations");
  const autoApprove =
    settings.autoApprove &&
    (!pro ||
      ((settings.autoApproveMaxAmount <= 0 || input.totals.itemsTotal <= settings.autoApproveMaxAmount) &&
        !(settings.autoApproveSkipRisky && riskLevel === "high")));

  if (input.requestType === "WITHDRAWAL") {
    // Legal acknowledgment on a durable medium, sent immediately.
    await notifyCustomer("Withdrawal Received", rr.id);
  }
  if (autoApprove) {
    const res = await transitionStatus({
      admin: input.admin,
      shop,
      rma: rr.rma,
      to: "APPROVED",
      source: "automation",
    });
    if (!res.ok && input.requestType !== "WITHDRAWAL") await notifyCustomer("Request Received", rr.id);
  } else if (input.requestType !== "WITHDRAWAL") {
    await notifyCustomer("Request Received", rr.id);
  }

  const fresh = await prisma.returnRequest.findUnique({ where: { id: rr.id }, select: { status: true } });
  return { id: rr.id, rma: rr.rma, status: fresh?.status ?? rr.status };
}

// ─── Status transitions ─────────────────────────────────────────────────────

export type TransitionTarget = "APPROVED" | "REJECTED" | "SHIPPED" | "RECEIVED" | "EXPIRED";

const ALLOWED_FROM: Record<TransitionTarget, string[]> = {
  APPROVED: ["PENDING"],
  REJECTED: ["PENDING", "APPROVED"],
  SHIPPED: ["APPROVED"],
  RECEIVED: ["APPROVED", "SHIPPED"],
  EXPIRED: ["APPROVED"],
};

const EVENT_TITLE: Record<TransitionTarget, string> = {
  APPROVED: "Return approved",
  REJECTED: "Return rejected",
  SHIPPED: "Items shipped",
  RECEIVED: "Items received",
  EXPIRED: "Return expired",
};

const EMAIL_FOR: Record<TransitionTarget, EmailType> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SHIPPED: "Shipped",
  RECEIVED: "Received",
  EXPIRED: "Expired",
};

const WEBHOOK_FOR: Record<TransitionTarget, WebhookEvent> = {
  APPROVED: "return.approved",
  REJECTED: "return.rejected",
  SHIPPED: "return.shipped",
  RECEIVED: "return.received",
  EXPIRED: "return.expired",
};

export async function transitionStatus(args: {
  admin: AdminClient | null;
  shop: string;
  rma: string;
  to: TransitionTarget;
  reason?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  source: EventSource;
  notify?: boolean;
}): Promise<Result> {
  const rr = await prisma.returnRequest.findFirst({ where: { rma: args.rma, shop: args.shop } });
  if (!rr) return { ok: false, error: "Return not found." };
  if (!ALLOWED_FROM[args.to].includes(rr.status)) {
    return { ok: false, error: `A ${rr.status.toLowerCase()} return can't be moved to ${args.to.toLowerCase()}.` };
  }
  if (args.to === "SHIPPED" && rr.keepItem) {
    return { ok: false, error: "This is a green return: the customer keeps the item." };
  }

  const now = new Date();
  const data: Record<string, unknown> = { status: args.to };
  if (args.to === "APPROVED") data.approvedAt = rr.approvedAt ?? now;
  if (args.to === "SHIPPED") data.shippedAt = rr.shippedAt ?? now;
  if (args.to === "RECEIVED") data.receivedAt = rr.receivedAt ?? now;
  if (args.to === "REJECTED") {
    data.rejectedAt = rr.rejectedAt ?? now;
    if (args.reason) data.rejectionReason = args.reason.slice(0, 1000);
  }
  if (args.to === "EXPIRED") data.expiredAt = now;
  if (args.carrier) data.carrier = args.carrier.slice(0, 80);
  if (args.trackingNumber) data.trackingNumber = args.trackingNumber.slice(0, 80);
  if (args.trackingUrl) data.trackingUrl = args.trackingUrl;
  if (args.labelUrl && /^https:\/\//i.test(args.labelUrl)) data.labelUrl = args.labelUrl;

  // Optimistic concurrency: only apply if nobody changed the status meanwhile.
  const updated = await prisma.returnRequest.updateMany({ where: { id: rr.id, status: rr.status }, data });
  if (updated.count === 0) return { ok: false, error: "This return was just updated. Refresh and try again." };

  if (args.admin && rr.shopifyReturnId) {
    try {
      if (args.to === "APPROVED") await approveShopifyReturn(args.admin, rr.shopifyReturnId);
      else if (args.to === "REJECTED") {
        if (rr.status === "PENDING") await declineShopifyReturn(args.admin, rr.shopifyReturnId, "OTHER");
        else await cancelShopifyReturn(args.admin, rr.shopifyReturnId);
      } else if (args.to === "SHIPPED") {
        await attachShippingToShopifyReturn(args.admin, rr.shopifyReturnId, {
          number: args.trackingNumber ?? rr.trackingNumber,
          url: args.trackingUrl ?? rr.trackingUrl,
        });
      } else if (args.to === "EXPIRED") await cancelShopifyReturn(args.admin, rr.shopifyReturnId);
    } catch (e) {
      console.error("[returns] Shopify mirror update failed:", e);
    }
  }

  await recordEvent(rr.id, {
    type: args.to,
    title: EVENT_TITLE[args.to],
    detail:
      args.to === "REJECTED"
        ? args.reason || null
        : args.to === "SHIPPED" && args.trackingNumber
          ? `${args.carrier ?? ""} · ${args.trackingNumber}`.trim()
          : null,
    meta:
      args.carrier || args.trackingNumber || args.labelUrl
        ? { carrier: args.carrier, trackingNumber: args.trackingNumber, trackingUrl: args.trackingUrl, labelUrl: args.labelUrl }
        : undefined,
    source: args.source,
  });

  if (args.notify !== false) {
    await notifyCustomer(EMAIL_FOR[args.to], rr.id, { trackingUrl: args.trackingUrl ?? null });
  }
  await emitReturnEvent(args.shop, WEBHOOK_FOR[args.to], rr.id);

  if (args.to === "RECEIVED") await maybeAutoRefund(args.admin, args.shop, rr.rma);
  return { ok: true };
}

/** Pro automation: refund automatically once items are received. */
async function maybeAutoRefund(admin: AdminClient | null, shop: string, rma: string) {
  try {
    const rr = await prisma.returnRequest.findFirst({ where: { rma, shop }, include: { settings: true } });
    if (!rr || !admin || !rr.settings.autoRefundOnReceive) return;
    const plan = await getShopPlan(shop);
    if (!hasFeature(plan, "automations")) return;

    let method: RefundMethod | null = null;
    if (rr.refundType === "STORE_CREDIT") method = "STORE_CREDIT";
    else if (rr.refundType === "EXCHANGE") method = "EXCHANGE";
    else if (rr.refundType === "ORIGINAL_PAYMENT" && !rr.isOfflinePayment && rr.settings.autoRefundOriginal) {
      method = "ORIGINAL_PAYMENT";
    }
    if (!method) return;

    const res = await processRefund({
      admin,
      shop,
      rma,
      method,
      amount: rr.refundAmount || rr.itemsTotal,
      currency: rr.settings.currency || "USD",
      source: "automation",
    });
    if (!res.ok) {
      await recordEvent(rr.id, { type: "AUTO_REFUND_FAILED", title: "Automatic refund failed", detail: res.error, source: "automation" });
    }
  } catch (e) {
    console.error("[returns] auto-refund failed:", e);
  }
}

// ─── Refunds ────────────────────────────────────────────────────────────────

async function gqlJson(admin: AdminClient, query: string, variables?: Record<string, unknown>) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  return (await res.json()) as any;
}

async function fetchRefundContext(admin: AdminClient, orderId: string) {
  const json = await gqlJson(
    admin,
    `#graphql
      query OrderForRefund($id: ID!) {
        order(id: $id) {
          id
          currencyCode
          customer { id }
          transactions(first: 50) {
            id
            kind
            status
            gateway
            manualPaymentGateway
            amountSet { shopMoney { amount currencyCode } }
          }
          lineItems(first: 100) {
            nodes { id variant { id } quantity }
          }
        }
      }`,
    { id: orderId },
  );
  return json?.data?.order ?? null;
}

async function firstActiveLocationId(admin: AdminClient): Promise<string | null> {
  try {
    const json = await gqlJson(
      admin,
      `#graphql
        query RestockLocation {
          locations(first: 10) { nodes { id isActive } }
        }`,
    );
    const nodes: any[] = json?.data?.locations?.nodes ?? [];
    return nodes.find((n) => n.isActive)?.id ?? nodes[0]?.id ?? null;
  } catch {
    return null;
  }
}

function refundLineItemsFor(
  items: Array<{ lineItemId: string | null; variantId: string; quantity: number }>,
  order: any,
  locationId: string | null,
  restock: boolean,
) {
  const lines: any[] = order?.lineItems?.nodes ?? [];
  return items
    .map((it) => {
      const li = it.lineItemId ? lines.find((l) => l.id === it.lineItemId) : lines.find((l) => l.variant?.id === it.variantId);
      if (!li) return null;
      return restock && locationId
        ? { lineItemId: li.id, quantity: it.quantity, restockType: "RETURN", locationId }
        : { lineItemId: li.id, quantity: it.quantity, restockType: "NO_RESTOCK" };
    })
    .filter(Boolean);
}

async function refundCreate(admin: AdminClient, input: Record<string, unknown>) {
  const json = await gqlJson(
    admin,
    `#graphql
      mutation RefundCreate($input: RefundInput!) {
        refundCreate(input: $input) {
          refund { id }
          userErrors { field message }
        }
      }`,
    { input },
  );
  const errors: any[] = json?.data?.refundCreate?.userErrors ?? [];
  return {
    id: (json?.data?.refundCreate?.refund?.id as string | undefined) ?? null,
    error: errors.length ? errors.map((e) => e.message).join(", ") : json?.errors ? "Shopify refund failed" : null,
  };
}

export interface ProcessRefundArgs {
  admin: AdminClient;
  shop: string;
  rma: string;
  method: RefundMethod;
  amount: number;
  currency: string;
  source: EventSource;
  exchange?: {
    lines?: Array<{ variantId: string; quantity: number; price: number; title?: string }>;
    diffSettlement?: string;
  } | null;
  payout?: { method?: string; account?: string; name?: string; reference?: string } | null;
}

export async function processRefund(args: ProcessRefundArgs): Promise<Result> {
  const rr = await prisma.returnRequest.findFirst({
    where: { rma: args.rma, shop: args.shop },
    include: { items: true, settings: true },
  });
  if (!rr) return { ok: false, error: "Return not found." };
  if (rr.refundedAt || rr.status === "REFUNDED") return { ok: false, error: "This return has already been refunded." };
  const refundable =
    rr.status === "RECEIVED" || rr.status === "SHIPPED" || (rr.status === "APPROVED" && rr.keepItem);
  if (!refundable) return { ok: false, error: "Mark the items as received before issuing the refund." };

  const plan = await getShopPlan(args.shop);
  let method = args.method;
  if ((method === "STORE_CREDIT" || method === "GIFT_CARD") && !hasFeature(plan, "storeCredit")) {
    return { ok: false, error: "Store credit and gift cards require the Starter plan." };
  }
  if (method === "EXCHANGE" && !hasFeature(plan, "variantExchange")) {
    return { ok: false, error: "Exchanges require the Starter plan." };
  }

  const itemsValue = round2(rr.items.reduce((s, it) => s + it.price * it.quantity, 0));
  const amount = round2(args.amount);
  if (method !== "EXCHANGE") {
    if (!(amount > 0)) return { ok: false, error: "Refund amount must be greater than zero." };
    const bonusPct =
      method === "STORE_CREDIT" || method === "GIFT_CARD" ? Math.max(0, rr.settings.storeCreditBonusPercent || 0) : 0;
    const cap = round2(itemsValue * (1 + bonusPct / 100)) + 0.01;
    if (itemsValue > 0 && amount > cap) {
      return { ok: false, error: `Amount exceeds the value of the returned items (${formatMoney(cap - 0.01, args.currency)}).` };
    }
  }

  // Lock against double refunds (double clicks, concurrent automation).
  const staleLock = new Date(Date.now() - 5 * 60 * 1000);
  const lock = await prisma.returnRequest.updateMany({
    where: {
      id: rr.id,
      refundedAt: null,
      OR: [{ refundProcessingAt: null }, { refundProcessingAt: { lt: staleLock } }],
    },
    data: { refundProcessingAt: new Date() },
  });
  if (lock.count === 0) return { ok: false, error: "A refund is already being processed for this return." };

  const release = () => prisma.returnRequest.update({ where: { id: rr.id }, data: { refundProcessingAt: null } });

  try {
    const order = await fetchRefundContext(args.admin, rr.orderId);
    if (!order) {
      await release();
      return { ok: false, error: "Order not found in Shopify." };
    }
    const restock = !rr.keepItem;
    const locationId = restock ? await firstActiveLocationId(args.admin) : null;
    const refundLines = refundLineItemsFor(rr.items, order, locationId, restock);
    const txs: any[] = Array.isArray(order.transactions) ? order.transactions : order.transactions?.nodes ?? [];
    const onlineSale = txs.find(
      (t) => (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS" && !t.manualPaymentGateway,
    );
    const manualSale = txs.find(
      (t) => (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS" && t.manualPaymentGateway,
    );
    const customerId: string | null = order.customer?.id ?? null;

    // STORE_CREDIT without a customer account → gift card when allowed.
    if (method === "STORE_CREDIT") {
      const mechanism = rr.settings.storeCreditMethod || "auto";
      if (mechanism === "gift_card" || (mechanism === "auto" && !customerId)) method = "GIFT_CARD";
    }

    const update: Record<string, unknown> = {};
    let refundId: string | null = null;
    let giftCardCode: string | undefined;
    let exchangeUrl: string | undefined;
    let recordedAmount = amount;
    const note = `TrackBack ${rr.rma}`;

    if (method === "ORIGINAL_PAYMENT") {
      if (!onlineSale) {
        await release();
        return {
          ok: false,
          error: manualSale
            ? "This order was paid offline (cash on delivery or manual payment). Use “Manual payout” to record the refund you send."
            : "No successful online payment found on this order. Use “Manual payout” instead.",
        };
      }
      if (refundLines.length === 0) {
        await release();
        return { ok: false, error: "Could not match the returned items to the Shopify order. Refund manually in Shopify." };
      }
      const r = await refundCreate(args.admin, {
        orderId: rr.orderId,
        refundLineItems: refundLines,
        transactions: [
          { orderId: rr.orderId, parentId: onlineSale.id, amount: amount.toFixed(2), kind: "REFUND", gateway: onlineSale.gateway },
        ],
        notify: true,
        note,
      });
      if (r.error) {
        await release();
        return { ok: false, error: `Shopify refund error: ${r.error}` };
      }
      refundId = r.id;
    } else if (method === "MANUAL") {
      const payoutMethod = args.payout?.method || rr.payoutMethod || "other";
      const reference = (args.payout?.reference || "").slice(0, 120);
      const label = payoutMethodLabel(payoutMethod, "en");
      const base = {
        orderId: rr.orderId,
        refundLineItems: refundLines,
        notify: false,
        note: `${note} — ${label} payout${reference ? ` (ref ${reference})` : ""}`,
      };
      let r = manualSale
        ? await refundCreate(args.admin, {
            ...base,
            transactions: [
              { orderId: rr.orderId, parentId: manualSale.id, amount: amount.toFixed(2), kind: "REFUND", gateway: manualSale.gateway },
            ],
          })
        : { id: null as string | null, error: null as string | null };
      if (!manualSale || r.error) {
        // Unpaid COD order or refused manual transaction: still record the restock.
        r = refundLines.length ? await refundCreate(args.admin, base) : { id: null, error: null };
      }
      refundId = r.id;
      update.payoutMethod = payoutMethod;
      update.payoutReference = reference || null;
      if (args.payout?.account) update.payoutAccount = args.payout.account.slice(0, 120);
      if (args.payout?.name) update.payoutName = args.payout.name.slice(0, 120);
    } else if (method === "STORE_CREDIT") {
      const orderCurrency = order.currencyCode || args.currency;
      const json = await gqlJson(
        args.admin,
        `#graphql
          mutation IssueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
            storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
              storeCreditAccountTransaction { id }
              userErrors { field message code }
            }
          }`,
        { id: customerId, creditInput: { creditAmount: { amount: amount.toFixed(2), currencyCode: orderCurrency } } },
      );
      const errs: any[] = json?.data?.storeCreditAccountCredit?.userErrors ?? [];
      if (errs.length || json?.errors) {
        await release();
        return { ok: false, error: `Failed to issue store credit: ${errs.map((e) => e.message).join(", ") || "Shopify error"}` };
      }
      update.storeCreditTxId = json?.data?.storeCreditAccountCredit?.storeCreditAccountTransaction?.id ?? null;
      update.storeCreditCode = `${formatMoney(amount, orderCurrency)} store credit`;
      if (refundLines.length) refundId = (await refundCreate(args.admin, { orderId: rr.orderId, refundLineItems: refundLines, notify: false, note })).id;
    } else if (method === "GIFT_CARD") {
      const gc = await createGiftCard(args.admin, { amount, customerId, note });
      if (gc.error || !gc.id) {
        await release();
        return { ok: false, error: `Failed to create the gift card: ${gc.error ?? "unknown error"}` };
      }
      giftCardCode = gc.code ?? undefined;
      update.giftCardId = gc.id;
      update.giftCardLastChars = gc.lastCharacters;
      update.storeCreditCode = `Gift card •••• ${gc.lastCharacters ?? ""}`.trim();
      if (refundLines.length) refundId = (await refundCreate(args.admin, { orderId: rr.orderId, refundLineItems: refundLines, notify: false, note })).id;
    } else if (method === "EXCHANGE") {
      const lines =
        args.exchange?.lines?.filter((l) => l.variantId && l.quantity > 0) ??
        rr.items
          .filter((it) => it.exchangeVariantId)
          .map((it) => ({ variantId: it.exchangeVariantId!, quantity: it.quantity, price: it.exchangeVariantPrice ?? it.price }));
      if (!lines || lines.length === 0) {
        await release();
        return { ok: false, error: "Pick a replacement product before creating the exchange." };
      }
      const returnedCredit = round2(Math.max(0, itemsValue - (rr.feeAmount || 0)));
      const replacementTotal = round2(lines.reduce((s, l) => s + (Number(l.price) || 0) * l.quantity, 0));
      const diff = round2(replacementTotal - returnedCredit);
      const discountValue = round2(Math.min(returnedCredit, replacementTotal));
      const settlement = args.exchange?.diffSettlement || "INVOICE_DIFFERENCE";

      const draftJson = await gqlJson(
        args.admin,
        `#graphql
          mutation DraftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id name invoiceUrl }
              userErrors { field message }
            }
          }`,
        {
          input: {
            email: rr.customerEmail,
            note: rr.exchangeNote ? `Exchange for ${rr.rma}: ${rr.exchangeNote}` : `Exchange for return ${rr.rma}`,
            lineItems: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
            ...(discountValue > 0
              ? {
                  appliedDiscount: {
                    value: discountValue,
                    amount: discountValue,
                    valueType: "FIXED_AMOUNT",
                    title: `Return credit ${rr.rma}`,
                  },
                }
              : {}),
            tags: ["exchange", `return-${rr.rma}`, "trackback-exchange"],
          },
        },
      );
      const draftErrors: any[] = draftJson?.data?.draftOrderCreate?.userErrors ?? [];
      const draft = draftJson?.data?.draftOrderCreate?.draftOrder;
      if (draftErrors.length || !draft) {
        await release();
        return { ok: false, error: `Failed to create the exchange order: ${draftErrors.map((e) => e.message).join(", ") || "Shopify error"}` };
      }
      update.exchangeOrderId = draft.id;
      update.exchangeOrderUrl = draft.invoiceUrl;
      exchangeUrl = draft.invoiceUrl;

      if (diff > 0.001 || settlement === "INVOICE_DIFFERENCE") {
        const sendJson = await gqlJson(
          args.admin,
          `#graphql
            mutation SendInvoice($id: ID!) {
              draftOrderInvoiceSend(id: $id) {
                draftOrder { id }
                userErrors { field message }
              }
            }`,
          { id: draft.id },
        );
        const sendErrors: any[] = sendJson?.data?.draftOrderInvoiceSend?.userErrors ?? [];
        if (sendErrors.length) console.warn("[returns] draftOrderInvoiceSend errors:", sendErrors);
      }

      if (diff < -0.001) {
        const diffAbs = -diff;
        if (settlement === "REFUND_DIFFERENCE" && onlineSale) {
          const r = await refundCreate(args.admin, {
            orderId: rr.orderId,
            transactions: [
              { orderId: rr.orderId, parentId: onlineSale.id, amount: diffAbs.toFixed(2), kind: "REFUND", gateway: onlineSale.gateway },
            ],
            notify: true,
            note: `${note} — exchange difference`,
          });
          refundId = r.id ?? refundId;
        } else if (settlement === "STORE_CREDIT_DIFFERENCE" && customerId) {
          const creditJson = await gqlJson(
            args.admin,
            `#graphql
              mutation IssueDiffCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
                storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
                  storeCreditAccountTransaction { id }
                  userErrors { field message code }
                }
              }`,
            {
              id: customerId,
              creditInput: { creditAmount: { amount: diffAbs.toFixed(2), currencyCode: order.currencyCode || args.currency } },
            },
          );
          update.storeCreditTxId = creditJson?.data?.storeCreditAccountCredit?.storeCreditAccountTransaction?.id ?? null;
          update.storeCreditCode = `${formatMoney(diffAbs, order.currencyCode || args.currency)} store credit (exchange difference)`;
        }
      }
      // Restock the returned items (zero-amount refund = inventory only).
      if (refundLines.length) {
        const r = await refundCreate(args.admin, { orderId: rr.orderId, refundLineItems: refundLines, notify: false, note: `${note} — exchange` });
        refundId = refundId ?? r.id;
      }
      recordedAmount = returnedCredit;
    }

    await prisma.returnRequest.update({
      where: { id: rr.id },
      data: {
        ...update,
        status: "REFUNDED",
        refundType: method,
        refundAmount: recordedAmount,
        refundedAt: new Date(),
        refundProcessingAt: null,
        ...(refundId ? { refundId } : {}),
        ...(customerId ? { customerId } : {}),
      },
    });

    if (rr.shopifyReturnId) {
      try {
        await closeShopifyReturn(args.admin, rr.shopifyReturnId);
      } catch (e) {
        console.error("[returns] closeShopifyReturn failed:", e);
      }
    }

    const titles: Record<RefundMethod, string> = {
      ORIGINAL_PAYMENT: "Refund issued",
      STORE_CREDIT: "Store credit issued",
      GIFT_CARD: "Gift card issued",
      EXCHANGE: "Exchange order created",
      MANUAL: "Manual payout recorded",
    };
    await recordEvent(rr.id, {
      type: method === "EXCHANGE" ? "EXCHANGE_CREATED" : "REFUNDED",
      title: titles[method],
      detail: `${formatMoney(recordedAmount, args.currency)} · ${method}`,
      meta: { refundId, exchangeOrderId: update.exchangeOrderId ?? null, giftCardId: update.giftCardId ?? null },
      source: args.source,
    });

    if (hasFeature(plan, "orderTags") && rr.settings.orderTagsEnabled) {
      await addOrderTags(args.admin, rr.orderId, [method === "EXCHANGE" ? "trackback-exchanged" : "trackback-refunded"]);
    }
    await notifyCustomer("Refunded", rr.id, { giftCardCode, exchangeUrl });
    await emitReturnEvent(args.shop, "return.refunded", rr.id);
    return { ok: true };
  } catch (e: any) {
    console.error("[returns] processRefund failed:", e);
    await release().catch(() => {});
    return { ok: false, error: `Refund failed: ${e?.message ?? "unknown error"}` };
  }
}

// ─── Maintenance (cron + lazy fallback) ─────────────────────────────────────

const MAINTENANCE_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Expires approved returns that were never shipped. Runs from the daily cron
 * and, as a fallback, lazily (at most once per ~day) from the admin.
 */
export async function runShopMaintenance(shop: string, opts: { force?: boolean; admin?: AdminClient | null } = {}) {
  const now = new Date();
  if (!opts.force) {
    const claim = await prisma.shopSettings.updateMany({
      where: {
        shop,
        OR: [{ lastMaintenanceAt: null }, { lastMaintenanceAt: { lt: new Date(now.getTime() - MAINTENANCE_INTERVAL_MS) } }],
      },
      data: { lastMaintenanceAt: now },
    });
    if (claim.count === 0) return { expired: 0 };
  } else {
    await prisma.shopSettings.updateMany({ where: { shop }, data: { lastMaintenanceAt: now } });
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { autoExpireDays: true } });
  if (!settings) return { expired: 0 };
  const cutoff = new Date(now.getTime() - Math.max(1, settings.autoExpireDays || 7) * DAY_MS);
  const candidates = await prisma.returnRequest.findMany({
    where: {
      shop,
      status: "APPROVED",
      shippedAt: null,
      keepItem: false,
      OR: [{ approvedAt: { lt: cutoff } }, { approvedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { rma: true },
    take: 200,
  });
  if (candidates.length === 0) return { expired: 0 };

  const admin = opts.admin ?? (await getOfflineAdmin(shop));
  let expired = 0;
  for (const c of candidates) {
    const res = await transitionStatus({ admin, shop, rma: c.rma, to: "EXPIRED", source: "system" });
    if (res.ok) expired++;
  }
  return { expired };
}

export function describePayout(rr: { payoutMethod: string | null; payoutAccount: string | null }, locale: Locale) {
  if (!rr.payoutMethod) return "";
  return `${payoutMethodLabel(rr.payoutMethod, locale)}${rr.payoutAccount ? ` · ${rr.payoutAccount}` : ""}`;
}
