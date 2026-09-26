import prisma from "../db.server";
import { recordEvent } from "./returns-service.server";

/**
 * refunds/create — when a merchant refunds a return directly in the Shopify
 * Admin, reflect it in TrackBack (status REFUNDED + amount). Refunds issued
 * by TrackBack itself are ignored (the return is already refunded or its
 * refund is being processed).
 */
export async function handleRefundCreated(shop: string, payload: any) {
  const returnGid: string | null =
    payload?.return?.admin_graphql_api_id ??
    (payload?.return?.id ? `gid://shopify/Return/${payload.return.id}` : null);
  if (!returnGid) return;

  const rr = await prisma.returnRequest.findFirst({
    where: { shop, shopifyReturnId: returnGid },
    select: { id: true, status: true, refundedAt: true, refundProcessingAt: true },
  });
  if (!rr || rr.refundedAt || rr.status === "REFUNDED" || rr.status === "REJECTED") return;
  if (rr.refundProcessingAt && Date.now() - rr.refundProcessingAt.getTime() < 5 * 60 * 1000) return;

  const txAmount = (payload?.transactions ?? [])
    .filter((t: any) => String(t.kind).toLowerCase() === "refund" && String(t.status).toLowerCase() === "success")
    .reduce((s: number, t: any) => s + (parseFloat(t.amount) || 0), 0);
  const lineAmount = (payload?.refund_line_items ?? []).reduce(
    (s: number, l: any) => s + (parseFloat(l.subtotal) || 0),
    0,
  );
  const amount = txAmount || lineAmount;

  await prisma.returnRequest.update({
    where: { id: rr.id },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(payload?.processed_at ?? payload?.created_at ?? Date.now()),
      refundId: payload?.admin_graphql_api_id ?? null,
      ...(amount > 0 ? { refundAmount: amount } : {}),
    },
  });
  await recordEvent(rr.id, {
    type: "REFUNDED",
    title: "Refunded in Shopify Admin",
    detail: amount > 0 ? amount.toFixed(2) : null,
    source: "system",
  });
}
