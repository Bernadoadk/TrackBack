/**
 * Outgoing webhooks (Pro): POSTs return lifecycle events to the merchant's
 * endpoint, signed with HMAC-SHA256 (header `X-TrackBack-Signature:
 * sha256=<hex>` over the raw body, using the webhook secret shown in
 * Settings → Integrations).
 */
import crypto from "crypto";
import prisma from "../db.server";
import { getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";

export const WEBHOOK_EVENTS = [
  "return.created",
  "return.approved",
  "return.rejected",
  "return.shipped",
  "return.received",
  "return.refunded",
  "return.expired",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type ReturnWithItems = Awaited<ReturnType<typeof loadForSerialize>>;

async function loadForSerialize(id: string) {
  return prisma.returnRequest.findUnique({ where: { id }, include: { items: true, settings: { select: { currency: true } } } });
}

/** Public JSON shape of a return (webhooks + REST API). */
export function serializeReturn(rr: NonNullable<ReturnWithItems>) {
  return {
    rma: rr.rma,
    status: rr.status,
    request_type: rr.requestType,
    locale: rr.locale,
    created_at: rr.createdAt.toISOString(),
    updated_at: rr.updatedAt.toISOString(),
    order: { id: rr.orderId, name: rr.orderName, total: rr.orderTotal, date: rr.orderDate.toISOString() },
    shopify_return_id: rr.shopifyReturnId,
    customer: { name: rr.customerName, email: rr.customerEmail, phone: rr.customerPhone },
    resolution: {
      type: rr.refundType,
      amount: rr.refundAmount,
      items_total: rr.itemsTotal,
      fees: rr.feeAmount,
      store_credit_bonus: rr.storeCreditBonus,
      currency: rr.settings?.currency ?? null,
      keep_item: rr.keepItem,
      exchange_order_id: rr.exchangeOrderId,
      refund_id: rr.refundId,
    },
    return_method: rr.returnMethod,
    tracking: { carrier: rr.carrier, number: rr.trackingNumber, url: rr.trackingUrl },
    risk: rr.riskLevel || null,
    items: rr.items.map((it) => ({
      line_item_id: it.lineItemId,
      product_id: it.productId,
      variant_id: it.variantId,
      sku: it.sku,
      name: it.name,
      variant: it.variantName,
      quantity: it.quantity,
      price: it.price,
      reason: it.reason,
      note: it.note,
      exchange_variant_id: it.exchangeVariantId,
    })),
    timestamps: {
      approved_at: rr.approvedAt?.toISOString() ?? null,
      shipped_at: rr.shippedAt?.toISOString() ?? null,
      received_at: rr.receivedAt?.toISOString() ?? null,
      refunded_at: rr.refundedAt?.toISOString() ?? null,
      rejected_at: rr.rejectedAt?.toISOString() ?? null,
    },
  };
}

export function signWebhookBody(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Fire-and-log. Never throws; records the last delivery status on the shop. */
export async function emitReturnEvent(shop: string, event: WebhookEvent, returnRequestId: string) {
  try {
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
      select: { webhookUrl: true, webhookSecret: true },
    });
    if (!settings?.webhookUrl || !/^https:\/\//i.test(settings.webhookUrl)) return;
    const plan = await getShopPlan(shop);
    if (!hasFeature(plan, "webhooks")) return;

    const rr = await loadForSerialize(returnRequestId);
    if (!rr) return;
    const body = JSON.stringify({
      id: crypto.randomUUID(),
      event,
      shop,
      occurred_at: new Date().toISOString(),
      data: serializeReturn(rr),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let status = "error";
    try {
      const res = await fetch(settings.webhookUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TrackBack-Webhooks/1.0",
          "X-TrackBack-Event": event,
          "X-TrackBack-Shop": shop,
          "X-TrackBack-Signature": `sha256=${signWebhookBody(settings.webhookSecret, body)}`,
        },
        body,
      });
      status = String(res.status);
    } catch (e: any) {
      status = e?.name === "AbortError" ? "timeout" : "error";
    } finally {
      clearTimeout(timer);
    }
    await prisma.shopSettings.update({
      where: { shop },
      data: { webhookLastStatus: `${event} → ${status}`, webhookLastAt: new Date() },
    });
  } catch (e) {
    console.error(`[webhooks-out] ${event} failed:`, e);
  }
}
