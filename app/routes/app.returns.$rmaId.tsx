import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useLoaderData, useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, StatusBadge, Btn, Card, Modal, Textarea, Toggle, useToast, STATUS_STYLES, Input, Select } from "../components/ui";
import { REFUND_TYPES } from "../components/mock-data";
import { sendReturnEmail } from "../lib/mailer.server";
import { getTrackingUrl, getCarrierDisplayName, getEstimatedTransitLabel, CARRIER_OPTIONS, OTHER_CARRIER } from "../lib/carriers";
import { evaluateOnboarding } from "../lib/onboarding.server";
import { approveShopifyReturn, attachShippingToShopifyReturn, closeShopifyReturn, declineShopifyReturn } from "../lib/returns-api.server";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoney, currencySymbol } from "../lib/money";
import { ProductPicker, type PickedVariant } from "../components/ProductPicker";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

  const [returnRequest, currency] = await Promise.all([
    prisma.returnRequest.findUnique({
      where: { rma: rmaId, shop },
      include: {
        items: true,
        notes: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'asc' } },
        settings: true
      }
    }),
    getShopCurrency(shop, admin),
  ]);

  if (!returnRequest) {
    throw new Response("Not Found", { status: 404 });
  }

  // Fetch how much is still refundable on the original payment for this
  // order: totalReceived − totalRefunded. Surfaced in the Refund modal as
  // "F CFA X available for refund". Non-fatal on failure — falls back to
  // the order total stored locally.
  let maxRefundable: number | null = null;
  try {
    const resp = await admin.graphql(`#graphql
      query OrderRefundable($id: ID!) {
        order(id: $id) {
          totalReceivedSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
        }
      }`, { variables: { id: returnRequest.orderId } });
    const json: any = await resp.json();
    const received = parseFloat(json?.data?.order?.totalReceivedSet?.shopMoney?.amount ?? '0');
    const refunded = parseFloat(json?.data?.order?.totalRefundedSet?.shopMoney?.amount ?? '0');
    maxRefundable = Math.max(0, received - refunded);
  } catch (err) {
    console.error('[app.returns.$rmaId] maxRefundable fetch failed:', err);
  }

  const onboarding = evaluateOnboarding(returnRequest.settings);
  return {
    returnRequest: { ...returnRequest, maxRefundable },
    currency,
    onboardingIncomplete: onboarding.status !== 'complete',
    onboardingMissing: onboarding.missingFields,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;
  // Currency for amount-formatted strings in events / emails. Lazy lookup,
  // falls back to "USD" if Shopify shop query fails.
  const currency = await getShopCurrency(shop, admin);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_status") {
    const status = formData.get("status") as string;
    const reason = formData.get("reason") as string | null;
    const carrier = formData.get("carrier") as string | null;
    const trackingNumber = formData.get("trackingNumber") as string | null;
    const labelUrl = formData.get("labelUrl") as string | null;

    const rr = await prisma.returnRequest.findUnique({ where: { rma: rmaId, shop }, include: { settings: true } });
    if (!rr) return { error: "Not found" };

    const now = new Date();
    const trackingUrl = getTrackingUrl(carrier ?? rr.carrier, trackingNumber ?? rr.trackingNumber);

    const updateData: any = {
      status,
      ...(reason && { rejectionReason: reason }),
      ...(carrier && { carrier }),
      ...(trackingNumber && { trackingNumber }),
      ...(labelUrl && { labelUrl }),
      ...(trackingUrl && { trackingUrl }),
    };

    // Lifecycle timestamps — only set on first transition into each state
    if (status === 'APPROVED' && !rr.approvedAt) updateData.approvedAt = now;
    if (status === 'SHIPPED' && !rr.shippedAt) updateData.shippedAt = now;
    if (status === 'RECEIVED' && !rr.receivedAt) updateData.receivedAt = now;
    if (status === 'REJECTED' && !rr.rejectedAt) updateData.rejectedAt = now;

    await prisma.returnRequest.update({ where: { rma: rmaId, shop }, data: updateData });

    // Propagate state changes to the Shopify native Return so the merchant's
    // Admin stays in sync. Only if we have a linked shopifyReturnId — returns
    // created directly in TrackBack without a Shopify mirror are skipped.
    //
    // Mapping:
    //   APPROVED → returnApproveRequest        (REQUESTED → OPEN)
    //   REJECTED → returnDeclineRequest        (REQUESTED → DECLINED)
    //   SHIPPED  → reverseDeliveryCreateWithShipping  (attach tracking)
    //   RECEIVED → no Shopify equivalent       (stays OPEN until refund)
    //   REFUNDED → handled in process_refund   (refundCreate + returnClose)
    if (rr.shopifyReturnId) {
      try {
        if (status === 'APPROVED') {
          await approveShopifyReturn(admin, rr.shopifyReturnId);
        } else if (status === 'REJECTED') {
          await declineShopifyReturn(admin, rr.shopifyReturnId, 'OTHER');
        } else if (status === 'SHIPPED') {
          await attachShippingToShopifyReturn(admin, rr.shopifyReturnId, {
            number: trackingNumber ?? rr.trackingNumber,
            url: trackingUrl ?? rr.trackingUrl,
          });
        }
      } catch (e) {
        console.error('[returns.$rmaId] Shopify mirror update failed:', e);
      }
    }

    // Audit event
    const eventTitle: Record<string, string> = {
      APPROVED: 'Return Approved',
      SHIPPED: 'Items Shipped',
      RECEIVED: 'Items Received',
      REJECTED: 'Return Rejected',
      EXPIRED: 'Return Expired',
    };
    await prisma.returnEvent.create({
      data: {
        returnRequestId: rr.id,
        type: status,
        source: 'merchant',
        title: eventTitle[status] ?? `Status: ${status}`,
        detail: status === 'REJECTED' ? (reason || null)
          : status === 'SHIPPED' ? (trackingNumber ? `Tracking ${trackingNumber}` : 'Marked as shipped')
            : null,
        meta: (carrier || trackingNumber)
          ? JSON.stringify({ carrier, trackingNumber, trackingUrl })
          : null,
      }
    });

    if (status === 'APPROVED') {
      await sendReturnEmail("Approved", {
        to: rr.customerEmail,
        shop,
        fromEmail: rr.settings?.fromEmail,
        customer_name: rr.customerName || rr.customerEmail.split('@')[0],
        rma_number: rr.rma,
        order_number: rr.orderName,
        refund_amount: formatMoney(rr.refundAmount, currency),
        label_url: labelUrl || undefined
      });
    } else if (status === 'SHIPPED') {
      await sendReturnEmail("Shipped", {
        to: rr.customerEmail,
        shop,
        fromEmail: rr.settings?.fromEmail,
        customer_name: rr.customerName || rr.customerEmail.split('@')[0],
        rma_number: rr.rma,
        order_number: rr.orderName,
        carrier: carrier || rr.carrier || 'N/A',
        tracking_number: trackingNumber || rr.trackingNumber || 'N/A',
        tracking_url: trackingUrl || undefined,
      });
    } else if (status === 'REJECTED') {
      await sendReturnEmail("Rejected", {
        to: rr.customerEmail,
        shop,
        fromEmail: rr.settings?.fromEmail,
        customer_name: rr.customerName || rr.customerEmail.split('@')[0],
        rma_number: rr.rma,
        order_number: rr.orderName,
        rejection_reason: reason || 'N/A'
      });
    }

  } else if (intent === "process_refund") {
    const refundMethod = formData.get("refundMethod") as string;
    const refundAmount = parseFloat(formData.get("refundAmount") as string);

    const rr = await prisma.returnRequest.findUnique({
      where: { rma: rmaId, shop },
      include: { items: true, settings: true }
    });
    if (!rr) return { error: "Not found" };
    if (!refundAmount || refundAmount <= 0) {
      return { error: "Refund amount must be greater than zero." };
    }

    // Fetch the order once for any method that needs it (transactions/lineItems/customer).
    // NOTE: In API 2025-10+, Order.transactions is a paginated connection, NOT a list.
    async function fetchOrderContext() {
      const res = await admin.graphql(`#graphql
        query GetOrderForRefund($id: ID!) {
          order(id: $id) {
            id
            currencyCode
            customer { id email }
            transactions(first: 50) {
              id
              kind
              status
              gateway
              amountSet { shopMoney { amount currencyCode } }
            }
            lineItems(first: 50) {
              edges { node { id variant { id } quantity } }
            }
          }
        }`, { variables: { id: rr!.orderId } });
      const data = await res.json();
      return data?.data?.order;
    }

    function pickSaleTransaction(order: any) {
      // Order.transactions in 2025-10 returns a list of OrderTransaction (no edges layer here)
      const txs: any[] = Array.isArray(order?.transactions) ? order.transactions : (order?.transactions?.nodes ?? []);
      return txs.find((t: any) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS') || null;
    }

    // Shopify requires a locationId on each refund line item when restockType=RETURN.
    // Fetch the first active location; if none is available we fall back to NO_RESTOCK
    // so the refund still succeeds (the merchant can restock manually in Shopify).
    async function fetchRestockLocationId(): Promise<string | null> {
      try {
        const res = await admin.graphql(`#graphql
          query RestockLocation {
            locations(first: 10) {
              edges { node { id isActive } }
            }
          }`);
        const data = await res.json();
        const edges: any[] = data?.data?.locations?.edges ?? [];
        const active = edges.find((e: any) => e.node?.isActive);
        return active?.node?.id ?? edges[0]?.node?.id ?? null;
      } catch {
        return null;
      }
    }

    function mapRefundLineItems(order: any, locationId: string | null) {
      const shopifyLineItems: any[] = order?.lineItems?.edges?.map((e: any) => e.node) || [];
      return rr!.items
        .map((it: any) => {
          const shopifyItem = it.lineItemId
            ? shopifyLineItems.find((li: any) => li.id === it.lineItemId)
            : shopifyLineItems.find((li: any) => li.variant?.id === it.variantId);
          if (!shopifyItem) return null;
          return locationId
            ? { lineItemId: shopifyItem.id, quantity: it.quantity, restockType: "RETURN", locationId }
            : { lineItemId: shopifyItem.id, quantity: it.quantity, restockType: "NO_RESTOCK" };
        })
        .filter(Boolean);
    }

    let storeCreditCode: string | null = null;
    let storeCreditTxId: string | null = null;
    let refundId: string | null = null;
    let exchangeOrderId: string | null = null;
    let exchangeOrderUrl: string | null = null;
    let customerId: string | null = null;

    // ─── ORIGINAL_PAYMENT ──────────────────────────────────────────────────
    if (refundMethod === 'ORIGINAL_PAYMENT') {
      try {
        const order = await fetchOrderContext();
        if (!order) return { error: "Order not found in Shopify. Please verify the order ID." };

        const saleTx = pickSaleTransaction(order);
        const locationId = await fetchRestockLocationId();
        const refundLineItems = mapRefundLineItems(order, locationId);
        customerId = order.customer?.id ?? null;

        if (!saleTx) return { error: "No successful payment transaction found on this order. The refund cannot be processed automatically." };
        if (refundLineItems.length === 0) return { error: "Could not match return items to Shopify order line items. Please process this refund manually in Shopify admin." };

        const refundRes = await admin.graphql(`#graphql
          mutation RefundCreate($input: RefundInput!) {
            refundCreate(input: $input) {
              refund { id createdAt }
              userErrors { field message }
            }
          }`, {
          variables: {
            input: {
              orderId: rr.orderId,
              refundLineItems,
              transactions: [{
                orderId: rr.orderId,
                parentId: saleTx.id,
                amount: refundAmount.toFixed(2),
                kind: "REFUND",
                gateway: saleTx.gateway,
              }],
              notify: true,
            }
          }
        });
        const refundData = await refundRes.json();
        const userErrors = refundData.data?.refundCreate?.userErrors || [];
        if (userErrors.length > 0) {
          return { error: `Shopify refund error: ${userErrors.map((e: any) => e.message).join(', ')}` };
        }
        refundId = refundData.data?.refundCreate?.refund?.id ?? null;
      } catch (e: any) {
        return { error: `Failed to issue refund: ${e?.message || 'unknown error'}` };
      }

      // ─── STORE_CREDIT (modern: storeCreditAccountCredit) ──────────────────
    } else if (refundMethod === 'STORE_CREDIT') {
      try {
        const order = await fetchOrderContext();
        if (!order) return { error: "Order not found in Shopify. Please verify the order ID." };
        customerId = order.customer?.id ?? null;
        if (!customerId) {
          return { error: "This order has no linked customer account, so store credit cannot be issued. Use ORIGINAL_PAYMENT instead, or invite the customer to create an account." };
        }

        // Use the order's currency (not the shop's) for the store credit
        // mutation — Shopify requires them to match the order being credited.
        const orderCurrency = order.currencyCode || currency;

        // 1) Credit the customer's store credit account (creates one if needed)
        const creditRes = await admin.graphql(`#graphql
          mutation IssueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
            storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
              storeCreditAccountTransaction {
                id
                amount { amount currencyCode }
                account { id balance { amount currencyCode } }
              }
              userErrors { field message code }
            }
          }`, {
          variables: {
            id: customerId,
            creditInput: {
              creditAmount: { amount: refundAmount.toFixed(2), currencyCode: orderCurrency },
            }
          }
        });
        const creditData = await creditRes.json();
        const creditErrors = creditData.data?.storeCreditAccountCredit?.userErrors || [];
        if (creditErrors.length > 0) {
          return { error: `Failed to issue store credit: ${creditErrors.map((e: any) => e.message).join(', ')}` };
        }
        storeCreditTxId = creditData.data?.storeCreditAccountCredit?.storeCreditAccountTransaction?.id ?? null;
        storeCreditCode = `${formatMoney(refundAmount, orderCurrency)} store credit`;

        // 2) Notional refund (no money movement) so Shopify restocks items + marks
        //    the order as refunded. Empty transactions = "refund without payment".
        const locationId = await fetchRestockLocationId();
        const refundLineItems = mapRefundLineItems(order, locationId);
        if (refundLineItems.length > 0) {
          const refundRes = await admin.graphql(`#graphql
            mutation RefundCreate($input: RefundInput!) {
              refundCreate(input: $input) {
                refund { id }
                userErrors { field message }
              }
            }`, {
            variables: {
              input: {
                orderId: rr.orderId,
                refundLineItems,
                note: `Store credit issued via TrackBack (${rr.rma})`,
                notify: false,
              }
            }
          });
          const refundData = await refundRes.json();
          refundId = refundData.data?.refundCreate?.refund?.id ?? null;
          // Don't fail the whole flow if the notional refund has errors — the credit was issued.
        }
      } catch (e: any) {
        return { error: `Failed to create store credit: ${e?.message || 'unknown error'}` };
      }

      // ─── EXCHANGE (draft order with real replacement variant) ─────────────
      //
      // New flow (Phase C): merchant picks the exact replacement variant via
      // the ProductPicker. We create a draft order with that variant as a
      // real line item, apply the returned items' total as a discount, and
      // settle any price difference via invoice or refund per the merchant's
      // choice.
    } else if (refundMethod === 'EXCHANGE') {
      const exchangeVariantId = formData.get("exchangeVariantId") as string | null;
      const exchangeVariantPrice = parseFloat(formData.get("exchangeVariantPrice") as string ?? "0");
      const exchangeQty = parseInt(formData.get("exchangeQty") as string ?? "1", 10) || 1;
      const diffSettlement = (formData.get("diffSettlement") as string) || 'INVOICE_DIFFERENCE';

      if (!exchangeVariantId) {
        return { error: 'Pick a replacement product before creating the exchange.' };
      }

      const returnedCredit = rr.items.reduce(
        (s: number, it: any) => s + it.price * it.quantity,
        0,
      );
      const replacementTotal = exchangeVariantPrice * exchangeQty;
      const diff = replacementTotal - returnedCredit;
      // Cap the credit at the replacement total — we never want a discount
      // larger than the line item (Shopify would reject it anyway).
      const discountValue = Math.min(returnedCredit, replacementTotal);

      try {
        const draftOrderRes = await admin.graphql(`#graphql
          mutation DraftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id name invoiceUrl }
              userErrors { field message }
            }
          }`, {
          variables: {
            input: {
              email: rr.customerEmail,
              note: rr.exchangeNote
                ? `Exchange request: ${rr.exchangeNote}`
                : `Exchange for return ${rr.rma}`,
              lineItems: [{
                variantId: exchangeVariantId,
                quantity: exchangeQty,
              }],
              appliedDiscount: {
                value: discountValue,
                amount: discountValue,
                valueType: "FIXED_AMOUNT",
                title: `Return credit ${rr.rma}`,
              },
              tags: [`exchange`, `return-${rr.rma}`],
            }
          }
        });
        const draftData = await draftOrderRes.json();
        const draftErrors = draftData.data?.draftOrderCreate?.userErrors || [];
        if (draftErrors.length > 0) {
          return { error: `Failed to create exchange draft order: ${draftErrors.map((e: any) => e.message).join(', ')}` };
        }
        const draftOrder = draftData.data?.draftOrderCreate?.draftOrder;
        if (draftOrder) {
          exchangeOrderId = draftOrder.id;
          exchangeOrderUrl = draftOrder.invoiceUrl;

          // If the customer owes a difference → invoice them to complete checkout.
          // Otherwise (even or replacement < returned credit) we don't invoice;
          // the draft is fully discounted and ready to be fulfilled directly,
          // or any negative diff is settled via the chosen settlement below.
          if (diff > 0.001 || diffSettlement === 'INVOICE_DIFFERENCE') {
            const sendRes = await admin.graphql(`#graphql
              mutation SendInvoice($id: ID!) {
                draftOrderInvoiceSend(id: $id) {
                  draftOrder { id invoiceSentAt }
                  userErrors { field message }
                }
              }`, { variables: { id: draftOrder.id } });
            const sendData = await sendRes.json();
            const sendErrors = sendData.data?.draftOrderInvoiceSend?.userErrors || [];
            if (sendErrors.length > 0) {
              console.warn('draftOrderInvoiceSend errors:', sendErrors);
            }
          }
        }

        // Settle the difference when the replacement is cheaper than the returned items.
        if (diff < -0.001) {
          const diffAbs = -diff;
          if (diffSettlement === 'REFUND_DIFFERENCE') {
            // Best-effort refund of the diff to the original payment.
            try {
              const orderRes = await admin.graphql(`#graphql
                query GetOrderForDiffRefund($id: ID!) {
                  order(id: $id) {
                    currencyCode
                    transactions(first: 50) {
                      id kind status gateway
                    }
                  }
                }`, { variables: { id: rr.orderId } });
              const orderData = await orderRes.json();
              const txs: any[] = orderData?.data?.order?.transactions ?? [];
              const saleTx = txs.find((t: any) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS');
              if (saleTx) {
                const refundRes = await admin.graphql(`#graphql
                  mutation RefundCreate($input: RefundInput!) {
                    refundCreate(input: $input) {
                      refund { id }
                      userErrors { field message }
                    }
                  }`, {
                  variables: {
                    input: {
                      orderId: rr.orderId,
                      transactions: [{
                        orderId: rr.orderId,
                        parentId: saleTx.id,
                        amount: diffAbs.toFixed(2),
                        kind: "REFUND",
                        gateway: saleTx.gateway,
                      }],
                      notify: true,
                    }
                  }
                });
                const refundJson = await refundRes.json();
                refundId = refundJson?.data?.refundCreate?.refund?.id ?? refundId;
              }
            } catch (e) {
              console.error('[exchange] diff refund failed:', e);
            }
          } else if (diffSettlement === 'STORE_CREDIT_DIFFERENCE') {
            // Issue store credit for the difference.
            try {
              const orderRes = await admin.graphql(`#graphql
                query GetOrderForDiffCredit($id: ID!) {
                  order(id: $id) {
                    currencyCode
                    customer { id }
                  }
                }`, { variables: { id: rr.orderId } });
              const orderData = await orderRes.json();
              const cId = orderData?.data?.order?.customer?.id ?? null;
              const orderCurrency = orderData?.data?.order?.currencyCode ?? currency;
              if (cId) {
                const creditRes = await admin.graphql(`#graphql
                  mutation IssueDiffCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
                    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
                      storeCreditAccountTransaction { id }
                      userErrors { field message code }
                    }
                  }`, {
                  variables: {
                    id: cId,
                    creditInput: {
                      creditAmount: { amount: diffAbs.toFixed(2), currencyCode: orderCurrency },
                    }
                  }
                });
                const creditJson = await creditRes.json();
                storeCreditTxId = creditJson?.data?.storeCreditAccountCredit?.storeCreditAccountTransaction?.id ?? storeCreditTxId;
                storeCreditCode = `${formatMoney(diffAbs, orderCurrency)} store credit (exchange diff)`;
                customerId = cId;
              }
            } catch (e) {
              console.error('[exchange] diff store credit failed:', e);
            }
          }
          // diffSettlement === 'NONE' → nothing to do
        }
      } catch (e: any) {
        return { error: `Failed to process exchange: ${e?.message || 'unknown error'}` };
      }
    } else {
      return { error: `Unknown refund method: ${refundMethod}` };
    }

    // Persist final state
    const now = new Date();
    await prisma.returnRequest.update({
      where: { rma: rmaId, shop },
      data: {
        status: "REFUNDED",
        refundType: refundMethod,
        refundAmount,
        refundedAt: now,
        ...(refundId && { refundId }),
        ...(storeCreditTxId && { storeCreditTxId }),
        ...(storeCreditCode && { storeCreditCode }),
        ...(exchangeOrderId && { exchangeOrderId }),
        ...(exchangeOrderUrl && { exchangeOrderUrl }),
        ...(customerId && { customerId }),
      }
    });

    // Close the corresponding Shopify Return so it leaves the "Retours en
    // cours" list in the Admin. We use refundCreate (legacy path) which does
    // NOT auto-close the return — only returnProcess does. Non-fatal on
    // failure; the local state is already REFUNDED.
    if (rr.shopifyReturnId) {
      try {
        await closeShopifyReturn(admin, rr.shopifyReturnId);
      } catch (e) {
        console.error('[returns.$rmaId] closeShopifyReturn after refund failed:', e);
      }
    }

    await prisma.returnEvent.create({
      data: {
        returnRequestId: rr.id,
        type: refundMethod === 'EXCHANGE' ? 'EXCHANGE_CREATED' : 'REFUNDED',
        source: 'merchant',
        title:
          refundMethod === 'EXCHANGE' ? 'Exchange order created'
            : refundMethod === 'STORE_CREDIT' ? 'Store credit issued'
              : 'Refund issued',
        detail: `${formatMoney(refundAmount, currency)} · ${REFUND_TYPES[refundMethod]?.label ?? refundMethod}`,
        meta: JSON.stringify({ refundId, storeCreditTxId, exchangeOrderId, exchangeOrderUrl }),
      }
    });

    await sendReturnEmail("Refunded", {
      to: rr.customerEmail,
      shop,
      fromEmail: rr.settings?.fromEmail,
      customer_name: rr.customerName || rr.customerEmail.split('@')[0],
      rma_number: rr.rma,
      order_number: rr.orderName,
      refund_amount: formatMoney(refundAmount, currency),
      store_credit_code: storeCreditCode || undefined,
      exchange_url: exchangeOrderUrl || undefined,
      refund_method: refundMethod,
    });

  } else if (intent === "add_note") {
    const text = formData.get("text") as string;
    const rr = await prisma.returnRequest.findUnique({ where: { rma: rmaId, shop } });
    if (rr) {
      await prisma.internalNote.create({
        data: { returnRequestId: rr.id, text, author: "Admin" }
      });
    }
  }

  // Echo the intent (and status when relevant) so the client can dismiss the
  // right modal/toast: React Router v7 clears fetcher.formData on idle, so we
  // can't reliably check the submitted intent from the client side anymore.
  return {
    success: true,
    intent: typeof intent === 'string' ? intent : null,
    status: (formData.get('status') as string | null) ?? null,
  };
};

export default function ReturnDetailPage() {
  const { returnRequest, currency, onboardingIncomplete, onboardingMissing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const toast = useToast();

  const r = returnRequest;

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [overrideMethod, setOverrideMethod] = useState(false);
  const [refundMethod, setRefundMethod] = useState(r.refundType || 'ORIGINAL_PAYMENT');
  const [refundAmountStr, setRefundAmountStr] = useState((r.refundAmount || 0).toFixed(2));
  // Exchange product picker — set when refundMethod === 'EXCHANGE'.
  const [exchangeVariant, setExchangeVariant] = useState<PickedVariant | null>(null);
  const [exchangeQty, setExchangeQty] = useState<number>(1);
  // How to settle a price difference between the returned items and the
  // replacement: customer pays via invoice / refund the diff / store credit.
  const [diffSettlement, setDiffSettlement] = useState<
    'INVOICE_DIFFERENCE' | 'REFUND_DIFFERENCE' | 'STORE_CREDIT_DIFFERENCE' | 'NONE'
  >('INVOICE_DIFFERENCE');

  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [labelUrl, setLabelUrl] = useState('');
  // If the merchant configured the shop to provide labels by default
  // (Settings → Return shipping method), the Approve modal expands the prepaid
  // label section by default. Otherwise it stays collapsed behind a toggle.
  const shopProvidesLabels =
    r.settings?.returnShippingMethod === 'merchant_provides_label';
  const [providingLabel, setProvidingLabel] = useState(shopProvidesLabels);

  // Ship modal state — pre-fill with customer-submitted tracking (from portal)
  // when present, so the merchant only has to confirm. They can still edit.
  const [shipCarrier, setShipCarrier] = useState(r.carrier ?? '');
  const [shipTracking, setShipTracking] = useState(r.trackingNumber ?? '');
  const customerSubmittedTracking = !!(r.carrier || r.trackingNumber);

  // Tracks which fetcher response we've already handled (so the same data
  // payload doesn't trigger duplicate toasts on re-render).
  const handledFetcherRef = useRef<any>(null);
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (handledFetcherRef.current === fetcher.data) return;
    handledFetcherRef.current = fetcher.data;

    const data = fetcher.data as any;
    const dataIntent = data?.intent as string | undefined;
    const dataStatus = data?.status as string | undefined;

    if (data.success && dataIntent === "add_note") {
      setInternalNote('');
      toast({ kind: 'info', title: 'Note added' });
    } else if (data.success && dataIntent === "update_status") {
      if (dataStatus === 'APPROVED') {
        setApproveOpen(false);
        toast({ kind: 'success', title: 'Return approved', body: `${r.rma} — shipping instructions sent.` });
      } else if (dataStatus === 'REJECTED') {
        setRejectOpen(false);
        setRejectReason('');
        toast({ kind: 'error', title: 'Return rejected', body: 'Customer has been notified.' });
      } else if (dataStatus === 'SHIPPED') {
        setShipOpen(false);
        toast({ kind: 'success', title: 'Marked as shipped', body: 'Waiting for arrival at warehouse.' });
      } else if (dataStatus === 'RECEIVED') {
        toast({ kind: 'success', title: 'Marked as received', body: 'Refund queue updated.' });
      }
    } else if (data.success && dataIntent === "process_refund") {
      setRefundOpen(false);
      const methodLabel = REFUND_TYPES[refundMethod as string]?.label || 'Refund';
      toast({ kind: 'success', title: 'Refund issued', body: `${methodLabel} — ${formatMoney(parseFloat(refundAmountStr || '0'), currency)} to ${r.customerName}.` });
    } else if (data.error) {
      toast({ kind: 'error', title: 'Error', body: data.error });
    }
  }, [fetcher.data, fetcher.state, r.rma, r.customerName, refundMethod, refundAmountStr, toast]);

  const itemsTotal = r.items.reduce((s: number, it: any) => s + it.price * it.quantity, 0);
  const restocking = 0;
  const refund = itemsTotal - restocking;
  // Max refund available on the original payment. Phase B will fetch the real
  // value from Shopify (`order.totalReceived - totalRefunded`); for now use
  // the order total as a safe upper bound.
  const maxRefundable = (r as any).maxRefundable ?? Math.max(itemsTotal, r.orderTotal);
  const refundAmountNum = parseFloat(refundAmountStr || '0') || 0;
  const refundExceedsMax =
    refundMethod === 'ORIGINAL_PAYMENT' && refundAmountNum > maxRefundable + 0.001;

  // A refund/credit/exchange has already been issued if ANY of these are set.
  // We check all of them (not just status) because the action handler updates
  // them atomically — once any is present, the merchant should NOT see the
  // "Issue refund" button again, even if the status hasn't refreshed yet.
  const hasIssuedRefund = !!(
    r.refundedAt || r.refundId || r.storeCreditTxId || r.exchangeOrderId
  );

  const isPending = r.status === 'PENDING' && !hasIssuedRefund;
  const isApproved = r.status === 'APPROVED' && !hasIssuedRefund;
  const isShipped = r.status === 'SHIPPED' && !hasIssuedRefund;
  const isReceived = r.status === 'RECEIVED' && !hasIssuedRefund;
  const isClosed =
    hasIssuedRefund || ['REFUNDED', 'REJECTED', 'EXPIRED'].includes(r.status);

  const handleApprove = () => {
    fetcher.submit({
      intent: 'update_status', status: 'APPROVED', carrier, trackingNumber, labelUrl
    }, { method: 'POST' });
  };
  const handleReject = () => {
    if (!rejectReason.trim()) return;
    fetcher.submit({ intent: 'update_status', status: 'REJECTED', reason: rejectReason }, { method: 'POST' });
  };
  const handleMarkShipped = () => {
    fetcher.submit({
      intent: 'update_status', status: 'SHIPPED',
      carrier: shipCarrier, trackingNumber: shipTracking
    }, { method: 'POST' });
  };
  const handleMarkReceived = () => {
    fetcher.submit({ intent: 'update_status', status: 'RECEIVED' }, { method: 'POST' });
  };
  const openRefundModal = () => {
    let creditTotal = refund;
    if (r.refundType === 'STORE_CREDIT' && r.settings.incentivizeStoreCredit) {
      creditTotal = refund * (1 + r.settings.storeCreditBonusPercent / 100);
    }
    setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT');
    setOverrideMethod(false);
    setRefundAmountStr(creditTotal.toFixed(2));
    setRefundOpen(true);
  };
  const handleRefund = () => {
    const payload: Record<string, string> = {
      intent: 'process_refund',
      refundMethod,
      refundAmount: refundAmountStr,
    };
    if (refundMethod === 'EXCHANGE' && exchangeVariant) {
      payload.exchangeVariantId = exchangeVariant.id;
      payload.exchangeVariantPrice = exchangeVariant.price.toString();
      payload.exchangeQty = exchangeQty.toString();
      payload.diffSettlement = diffSettlement;
    }
    fetcher.submit(payload, { method: 'POST' });
  };
  const handleAddNote = () => {
    if (!internalNote.trim()) return;
    fetcher.submit({ intent: 'add_note', text: internalNote.trim() }, { method: 'POST' });
  };

  // Build timeline from lifecycle timestamps (source of truth) + supplemental ReturnEvents
  // for carrier/system events. Falls back to updatedAt only when a timestamp is missing
  // on older records that pre-date the migration.
  const fmt = (d: any) => new Date(d).toLocaleString();
  const fallback = (d: any) => d ? new Date(d).toLocaleString() : new Date(r.updatedAt).toLocaleString();

  const timeline: any[] = [
    { title: 'Return Requested', detail: 'Customer submitted return request', time: fmt(r.createdAt), icon: 'PackagePlus', color: '#22C55E' },
  ];
  if (r.approvedAt || ['APPROVED', 'SHIPPED', 'RECEIVED', 'REFUNDED'].includes(r.status)) {
    timeline.push({ title: 'Return Approved', detail: 'Shipping instructions sent to customer', time: fallback(r.approvedAt), icon: 'CircleCheck', color: '#3B82F6' });
  }
  if (r.rejectedAt || r.status === 'REJECTED') {
    timeline.push({ title: 'Return Rejected', detail: r.rejectionReason || 'No reason provided', time: fallback(r.rejectedAt), icon: 'CircleX', color: '#EF4444' });
  }
  if (r.status === 'EXPIRED') {
    timeline.push({ title: 'Return Expired', detail: 'Customer did not ship within the allowed window', time: fmt(r.updatedAt), icon: 'Clock', color: '#6B7280' });
  }
  if (r.shippedAt || ['SHIPPED', 'RECEIVED', 'REFUNDED'].includes(r.status)) {
    const carrierName = getCarrierDisplayName(r.carrier);
    const detail = r.trackingNumber
      ? `${carrierName} · ${r.trackingNumber}`
      : 'Customer shipped items back';
    timeline.push({
      title: 'Items Shipped',
      detail,
      time: fallback(r.shippedAt),
      icon: 'Truck',
      color: '#10B981',
      trackingUrl: r.trackingUrl || getTrackingUrl(r.carrier, r.trackingNumber),
    });
  }
  // Insert any carrier events (IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED) that came between
  // shipped and received (typically from AfterShip webhook integration when configured).
  (r.events || [])
    .filter((e: any) => ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(e.type))
    .forEach((e: any) => {
      timeline.push({
        title: e.title,
        detail: e.detail || '',
        time: fmt(e.createdAt),
        icon: e.type === 'DELIVERED' ? 'PackageCheck' : e.type === 'OUT_FOR_DELIVERY' ? 'Truck' : 'MoveRight',
        color: e.type === 'DELIVERED' ? '#8B5CF6' : '#10B981',
      });
    });
  if (r.receivedAt || ['RECEIVED', 'REFUNDED'].includes(r.status)) {
    timeline.push({ title: 'Items Received', detail: 'Items confirmed at warehouse', time: fallback(r.receivedAt), icon: 'PackageCheck', color: '#8B5CF6' });
  }
  if (r.refundedAt || r.status === 'REFUNDED') {
    const label = REFUND_TYPES[r.refundType as string]?.label ?? r.refundType;
    timeline.push({
      title: r.refundType === 'EXCHANGE' ? 'Exchange order created' : 'Refund issued',
      detail: `${label} · ${formatMoney(r.refundAmount, currency)}`,
      time: fallback(r.refundedAt),
      icon: r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign',
      color: '#22C55E',
      exchangeUrl: r.refundType === 'EXCHANGE' ? r.exchangeOrderUrl : undefined,
    });
  }

  return (
    <div>
      <Link to={`/app/returns${location.search}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition mb-4 group">
        <Icon name="ArrowLeft" size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Returns
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-semibold text-ink tracking-tight font-mono">{r.rma}</h1>
          <StatusBadge status={r.status} size="lg" />
        </div>
        <div className="text-[13px] text-muted mt-1.5">Submitted {new Date(r.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>

      {/* ── Shopify mirror status ─────────────────────────────────────────
          Two cases:
            (a) The order isn't fulfilled yet  → informational, auto-syncs via fulfillments/create webhook
            (b) The mirror failed for another reason → show the actual error so the merchant knows
      */}
      {!r.shopifyReturnId && (() => {
        const lastFail = (r.events || [])
          .filter((e: any) => e.type === 'SHOPIFY_MIRROR_FAILED')
          .slice(-1)[0];
        // "Wait for fulfillment" only if the failure was genuinely about
        // the order being unfulfilled. Any other error (access denied,
        // network, mutation user errors) is a real bug to surface.
        const isFulfillmentWait =
          !lastFail ||
          (lastFail.detail?.includes('no fulfilled items') &&
            !lastFail.detail?.includes('Access denied') &&
            !lastFail.detail?.includes('Forbidden'));
        if (isFulfillmentWait) {
          return (
            <div className="mb-4 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-4 py-3 flex items-start gap-3">
              <Icon name="Clock" size={16} className="mt-0.5 shrink-0" style={{ color: '#3B82F6' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink">Waiting for order fulfillment</div>
                <div className="text-[12px] text-muted mt-0.5 leading-relaxed">
                  This return will appear in your Shopify Admin automatically as soon as the order's items are fulfilled and shipped.
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="mb-4 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 flex items-start gap-3">
            <Icon name="AlertTriangle" size={16} className="mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink">Couldn't sync to Shopify Admin</div>
              <div className="text-[12px] text-muted mt-0.5 leading-relaxed break-words">
                {lastFail.detail || 'Unknown error — check the server logs for [returns-api] entries.'}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">
          {/* Customer */}
          <Card title="Customer">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full grid place-content-center text-[14px] font-bold text-white shrink-0"
                style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                {r.customerName ? r.customerName.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase() : r.customerEmail[0].toUpperCase()}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
                <div className="col-span-2">
                  <div className="text-ink font-semibold text-[14px]">{r.customerName || r.customerEmail.split('@')[0]}</div>
                </div>
                <Field icon="Mail" label="Email" value={r.customerEmail} />
                <Field icon="Phone" label="Phone" value={r.customerPhone || 'N/A'} />
                <Field icon="Receipt" label="Order" value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
                <Field icon="Calendar" label="Date" value={new Date(r.orderDate).toLocaleDateString()} />
              </div>
            </div>
          </Card>

          {/* Items */}
          <Card title="Items Requested" subtitle={`${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`}>
            <div className="space-y-3">
              {r.items.map((it: any, i: number) => (
                <div key={i} className="flex gap-4 p-3 rounded-md bg-bg/40 border border-divider">
                  <div className="w-16 h-16 rounded-md grid place-content-center shrink-0 relative overflow-hidden bg-[#f8fafc]">
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt={it.name} className="w-full h-full object-cover" />
                    ) : (
                      <Icon name="Shirt" size={22} className="text-[#ccc]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-[13.5px] font-semibold text-ink">{it.name}</div>
                        <div className="text-[12px] text-muted mt-0.5">{it.variantName} · Qty {it.quantity}</div>
                      </div>
                      <div className="text-[13.5px] font-semibold text-ink tabular-nums">${it.price.toFixed(2)}</div>
                    </div>
                    <div className="mt-2 flex items-start gap-2 flex-wrap text-[12px]">
                      <span className="px-2 py-0.5 rounded bg-white/[0.05] text-muted border border-divider">Reason: <span className="text-ink">{it.reason}</span></span>
                      {it.note && (
                        <span className="px-2 py-0.5 rounded bg-warn/10 text-warn border border-warn/20 italic">"{it.note}"</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-divider text-[13px]">
                <span className="text-muted">Total items value</span>
                <span className="text-ink font-semibold text-[15px] tabular-nums">${itemsTotal.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card title="Timeline">
            <div className="relative">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-divider" />
              <div className="space-y-4">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 relative">
                    <div className="w-[22px] h-[22px] rounded-full grid place-content-center shrink-0 relative z-10 border-[3px] border-surface"
                      style={{ background: t.color }}>
                      <Icon name={t.icon} size={11} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink">{t.title}</span>
                        <span className="text-[11.5px] text-muted">· {t.time}</span>
                      </div>
                      <div className="text-[12.5px] text-muted mt-0.5">{t.detail}</div>
                      {t.trackingUrl && (
                        <a href={t.trackingUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] text-accent2 hover:text-white transition group">
                          <Icon name="ExternalLink" size={12} />
                          <span>Track live</span>
                          <span className="opacity-0 group-hover:opacity-100 transition">→</span>
                        </a>
                      )}
                      {t.exchangeUrl && (
                        <a href={t.exchangeUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] text-accent2 hover:text-white transition group">
                          <Icon name="ExternalLink" size={12} />
                          <span>View exchange invoice</span>
                          <span className="opacity-0 group-hover:opacity-100 transition">→</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Internal notes */}
          <Card title="Internal Notes" subtitle="Only visible to your team">
            <Textarea value={internalNote} onChange={(e: any) => setInternalNote(e.target.value)} placeholder="Add a private note…" rows={3} />
            <div className="flex justify-end mt-2.5">
              <Btn variant="secondary" icon="Plus" size="sm" onClick={handleAddNote} disabled={!internalNote.trim() || fetcher.state !== 'idle'}>Add Note</Btn>
            </div>
            {r.notes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-divider space-y-2.5">
                {r.notes.map((n: any) => (
                  <div key={n.id} className="flex gap-2.5 text-[12.5px]">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent2 grid place-content-center text-[10px] font-bold shrink-0">AD</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-ink font-medium">{n.author}</span><span className="text-faint">{new Date(n.createdAt).toLocaleString()}</span></div>
                      <div className="text-muted mt-0.5">{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-2 space-y-5">
          {/* Actions */}
          <Card title="Actions">
            {isPending && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon="Check" onClick={() => setApproveOpen(true)} disabled={fetcher.state !== 'idle'}>Approve Return</Btn>
                <Btn variant="danger-outline" className="w-full mt-2.5" size="lg" icon="X" onClick={() => setRejectOpen(true)} disabled={fetcher.state !== 'idle'}>Reject Return</Btn>
                <div className="mt-4 pt-4 border-t border-divider text-[12px] text-muted leading-relaxed">
                  Once approved, the customer will receive shipping instructions.
                </div>
              </>
            )}
            {isApproved && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="Truck" onClick={() => setShipOpen(true)} disabled={fetcher.state !== 'idle'}>Mark as Shipped</Btn>
                <Btn variant="secondary" className="w-full mt-2.5" size="lg" icon="PackageCheck" onClick={handleMarkReceived} disabled={fetcher.state !== 'idle'}>Skip to Received</Btn>
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info/10 border border-info/20 text-[12px] text-info flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>Waiting for customer to ship items back. Mark shipped when tracking is available.</div>
                </div>
              </>
            )}
            {isShipped && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="PackageCheck" onClick={handleMarkReceived} disabled={fetcher.state !== 'idle'}>Mark as Received</Btn>
                {(() => {
                  const url = r.trackingUrl ?? getTrackingUrl(r.carrier, r.trackingNumber);
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-2.5">
                      <Btn variant="secondary" className="w-full" size="lg" icon="ExternalLink">
                        Track live · {getCarrierDisplayName(r.carrier)}
                      </Btn>
                    </a>
                  ) : null;
                })()}
                <div className="mt-3 px-3 py-2.5 rounded-md bg-[#10B981]/10 border border-[#10B981]/20 text-[12px] text-[#10B981] flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>
                    Items in transit. Mark received once they arrive at your warehouse.
                    {getEstimatedTransitLabel(r.carrier) && (
                      <div className="text-[11.5px] opacity-80 mt-1">{getEstimatedTransitLabel(r.carrier)}</div>
                    )}
                  </div>
                </div>
              </>
            )}
            {isReceived && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon={r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign'} onClick={openRefundModal}>
                  {r.refundType === 'EXCHANGE' ? 'Process Exchange' : 'Issue Refund'}
                </Btn>
                <div className="mt-3 text-[12px] text-muted">
                  {r.refundType === 'EXCHANGE' ? 'Items received. Ready to create replacement order.' : 'Items received and inspected. Ready to refund.'}
                </div>
              </>
            )}
            {isClosed && (
              <div className="px-3 py-3 rounded-md text-[12.5px]"
                style={{ background: STATUS_STYLES[r.status]?.bg || '#333', color: STATUS_STYLES[r.status]?.text || '#fff' }}>
                This return is {r.status === 'EXPIRED' ? 'expired' : 'closed'}. No further actions available.
              </div>
            )}
          </Card>

          {/* Refund preview */}
          <Card title="Refund Preview">
            <div className="space-y-2 text-[13px]">
              <Row label="Items total" value={formatMoney(itemsTotal, currency)} />
              <Row label="Restocking fee" value={`- ${formatMoney(restocking, currency)}`} muted />
              <div className="border-t border-divider my-2"></div>
              <Row label="Estimated refund" value={formatMoney(refund, currency)} strong />
              <div className="flex items-center justify-between pt-1.5">
                <span className="text-[12px] text-muted">Customer requested</span>
                {(() => {
                  const m = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-0.5 rounded"
                      style={{ background: m.bg, color: m.color }}>
                      <Icon name={m.icon} size={11} /> {m.label}
                    </span>
                  );
                })()}
              </div>
              {r.refundType === 'STORE_CREDIT' && r.settings.incentivizeStoreCredit && r.settings.storeCreditBonusPercent > 0 && (
                <div className="px-2.5 py-1.5 rounded-md text-[11.5px] flex items-start gap-1.5"
                  style={{ background: 'rgba(108,99,255,0.08)', color: '#8B85FF' }}>
                  <Icon name="Sparkles" size={11} className="mt-0.5" />
                  <span>+{r.settings.storeCreditBonusPercent}% bonus credit · total <strong className="text-ink">${(refund * (1 + r.settings.storeCreditBonusPercent / 100)).toFixed(2)}</strong></span>
                </div>
              )}
              {r.refundType === 'EXCHANGE' && (r as any).exchangeNote && (
                <div className="px-2.5 py-2 rounded-md text-[12px] flex items-start gap-1.5 border"
                  style={{ background: 'rgba(59,130,246,0.06)', color: '#3B82F6', borderColor: 'rgba(59,130,246,0.2)' }}>
                  <Icon name="RefreshCw" size={12} className="mt-0.5 shrink-0" />
                  <div><span className="font-semibold">Customer wants: </span>{(r as any).exchangeNote}</div>
                </div>
              )}
              {r.refundType === 'EXCHANGE' && (r as any).exchangeOrderUrl && (
                <div className="px-2.5 py-2 rounded-md text-[12px] flex items-start gap-1.5 border"
                  style={{ background: 'rgba(16,185,129,0.06)', color: '#10B981', borderColor: 'rgba(16,185,129,0.2)' }}>
                  <Icon name="PackageCheck" size={12} className="mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Shopify draft order created — </span>
                    <a href={(r as any).exchangeOrderUrl} target="_blank" rel="noreferrer" className="underline">View & complete in Shopify</a>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Shipping Info */}
          <Card title="Shipping Info">
            <div className="space-y-2.5 text-[13px]">
              <Row label="Order" value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
              <Row label="Total" value={formatMoney(r.orderTotal, currency)} />
              {r.carrier && <Row label="Carrier" value={r.carrier} />}
              {r.trackingNumber && <Row label="Tracking" value={r.trackingNumber} />}
              {r.shippedAt && <Row label="Shipped" value={new Date(r.shippedAt).toLocaleDateString()} />}
              {r.labelUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Shipping Label</span>
                  <a href={r.labelUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-accent2 hover:underline text-[12.5px] font-medium">
                    <Icon name="Download" size={13} /> Download
                  </a>
                </div>
              )}
              {(r as any).exchangeOrderUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Exchange Order</span>
                  <a href={(r as any).exchangeOrderUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[#10B981] hover:underline text-[12.5px] font-medium">
                    <Icon name="ExternalLink" size={13} /> View in Shopify
                  </a>
                </div>
              )}
              {!r.carrier && !r.trackingNumber && !(r as any).exchangeOrderUrl && (
                <div className="text-[12px] text-faint italic">No shipping info yet.</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* APPROVE Modal */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Approve this return?"
        footer={<>
          <Btn variant="ghost" onClick={() => setApproveOpen(false)}>Cancel</Btn>
          <Btn variant="ok" icon="Check" onClick={handleApprove} disabled={fetcher.state !== 'idle'}>Approve & Send instructions</Btn>
        </>}>
        <div className="space-y-4">
          <div className="text-[13px] text-muted leading-relaxed">
            {shopProvidesLabels
              ? 'Your shop is configured to provide return labels — attach the prepaid label info below before approving.'
              : 'The customer will be emailed shipping instructions. They will ship at their own cost and submit their tracking number via your portal once shipped.'}
          </div>

          <div className="p-3 rounded-md bg-bg/40 border border-divider">
            <Toggle
              checked={providingLabel}
              onChange={setProvidingLabel}
              label="I'm providing a prepaid return label"
              description="Only enable this if you're attaching a return label for the customer (e.g. from Shippo, EasyPost)."
            />
            {providingLabel && (
              <div className="mt-3 pl-12 space-y-3 animate-fadeIn">
                <div className="grid grid-cols-2 gap-3">
                  <CarrierField value={carrier} onChange={setCarrier} />
                  <div>
                    <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking Number</label>
                    <Input value={trackingNumber} onChange={(e: any) => setTrackingNumber(e.target.value)} placeholder="e.g. 1Z999..." />
                  </div>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted block mb-1.5">Prepaid Shipping Label URL</label>
                  <Input value={labelUrl} onChange={(e: any) => setLabelUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* REJECT Modal */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject this return?"
        footer={<>
          <Btn variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Btn>
          <Btn variant="danger" icon="X" onClick={handleReject} disabled={!rejectReason.trim() || fetcher.state !== 'idle'}>Reject & Notify</Btn>
        </>}>
        <div className="text-[13px] text-muted leading-relaxed mb-3">
          The customer will be notified that their return cannot be accepted.
        </div>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Reason for rejection</label>
        <Textarea value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} rows={4}
          placeholder="e.g. Outside 30-day return window; items show signs of wear." />
      </Modal>

      {/* SHIPPED Modal */}
      <Modal open={shipOpen} onClose={() => setShipOpen(false)} title="Mark as Shipped"
        footer={<>
          <Btn variant="ghost" onClick={() => setShipOpen(false)}>Cancel</Btn>
          <Btn variant="primary" icon="Truck" onClick={handleMarkShipped} disabled={fetcher.state !== 'idle'}>Confirm Shipped</Btn>
        </>}>
        <div className="space-y-4">
          {customerSubmittedTracking ? (
            <div className="rounded-md border border-[#22C55E]/30 bg-[#22C55E]/10 px-3 py-2.5 flex items-start gap-2">
              <Icon name="CheckCircle2" size={14} className="mt-0.5 shrink-0" style={{ color: '#22C55E' }} />
              <div className="text-[12.5px] text-ink leading-relaxed">
                <span className="font-semibold">Customer submitted tracking via the portal.</span>{' '}
                <span className="text-muted">You can edit before confirming.</span>
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-muted leading-relaxed">
              Confirm that the customer has shipped the items back. Add tracking info if available.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <CarrierField value={shipCarrier} onChange={setShipCarrier} />
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking Number</label>
              <Input value={shipTracking} onChange={(e: any) => setShipTracking(e.target.value)} placeholder="e.g. 9400..." />
            </div>
          </div>
        </div>
      </Modal>

      {/* REFUND Modal */}
      <Modal open={refundOpen} onClose={() => setRefundOpen(false)}
        title={r.refundType === 'EXCHANGE' ? 'Process Exchange' : 'Process Refund'} width="max-w-lg"
        footer={<>
          <Btn variant="ghost" onClick={() => setRefundOpen(false)}>Cancel</Btn>
          <Btn variant="primary" icon={r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign'}
            onClick={handleRefund}
            disabled={
              fetcher.state !== 'idle' ||
              refundExceedsMax ||
              refundAmountNum <= 0 ||
              (refundMethod === 'EXCHANGE' && !exchangeVariant)
            }>
            {refundMethod === 'EXCHANGE' ? 'Create Exchange Order' : 'Confirm Refund'}
          </Btn>
        </>}>
        {(() => {
          const requested = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
          const method = REFUND_TYPES[refundMethod as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
          const bonusPct = r.settings?.storeCreditBonusPercent ?? 0;
          const bonusActive =
            refundMethod === 'STORE_CREDIT' &&
            r.settings?.incentivizeStoreCredit &&
            bonusPct > 0;
          const bonusAmount = bonusActive ? refundAmountNum * (bonusPct / 100) : 0;
          const totalStoreCredit = refundAmountNum + bonusAmount;

          return (
            <div className="space-y-4">
              {onboardingIncomplete && (
                <Link to="/app/onboarding"
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-md border transition hover:bg-warn/15"
                  style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)' }}>
                  <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
                  <div className="flex-1 text-[12.5px]">
                    <div className="font-semibold" style={{ color: '#F59E0B' }}>Setup incomplete</div>
                    <div className="text-muted mt-0.5 leading-relaxed">
                      Missing: {(onboardingMissing || []).join(', ')}. Refund emails may not reach the customer.
                      <span className="ml-1 font-semibold text-accent2">Finish setup →</span>
                    </div>
                  </div>
                </Link>
              )}

              {/* ── SUMMARY ──────────────────────────────────────────────── */}
              <div className="rounded-md border border-divider bg-bg/30 p-3.5">
                <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold mb-2">Summary</div>
                <div className="space-y-1.5 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Items total ({r.items.length})</span>
                    <span className="text-ink tabular-nums">{formatMoney(itemsTotal, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Restocking fee</span>
                    <span className="text-muted tabular-nums">{restocking > 0 ? `- ${formatMoney(restocking, currency)}` : '—'}</span>
                  </div>
                  <div className="pt-1.5 mt-1.5 border-t border-divider flex items-center justify-between text-[13.5px]">
                    <span className="font-semibold text-ink">Total refund</span>
                    <span className="font-bold text-ink tabular-nums">{formatMoney(refund, currency)}</span>
                  </div>
                </div>
              </div>

              {/* ── REFUND METHOD ────────────────────────────────────────── */}
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold mb-1.5">Refund method</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md"
                  style={{ background: method.bg, color: method.color }}>
                  <Icon name={method.icon} size={14} />
                  <span className="text-[13px] font-semibold">{method.label}</span>
                  {refundMethod === r.refundType && (
                    <span className="ml-auto text-[10.5px] uppercase tracking-wider opacity-80">Customer choice</span>
                  )}
                </div>
                {refundMethod === 'ORIGINAL_PAYMENT' && (
                  <div className="text-[11.5px] text-muted mt-1.5 flex items-center gap-1.5">
                    <Icon name="Info" size={11} />
                    <span>{formatMoney(maxRefundable, currency)} available for refund</span>
                  </div>
                )}
              </div>

              {/* ── AMOUNT ──────────────────────────────────────────────── */}
              <div>
                <label className="text-[10.5px] uppercase tracking-wider text-faint font-semibold block mb-1.5">
                  {refundMethod === 'STORE_CREDIT' ? 'Credit amount' :
                    refundMethod === 'EXCHANGE' ? 'Exchange credit value' :
                      'Refund amount'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[14px] tabular-nums">{currencySymbol(currency)}</span>
                  <input value={refundAmountStr} onChange={e => setRefundAmountStr(e.target.value)}
                    className={`w-full h-10 pl-12 pr-3 text-[15px] rounded-md bg-bg border ${refundExceedsMax ? 'border-danger ring-2 ring-danger/20' : 'border-border focus:border-accent focus:ring-2 focus:ring-accent/20'} text-ink font-semibold tabular-nums focus:outline-none`} />
                </div>
                {refundExceedsMax && (
                  <div className="text-[11.5px] text-danger mt-1.5 flex items-center gap-1.5">
                    <Icon name="TriangleAlert" size={11} />
                    Amount exceeds the {formatMoney(maxRefundable, currency)} available on the original payment.
                  </div>
                )}
              </div>

              {/* ── METHOD-SPECIFIC PREVIEW ─────────────────────────────── */}
              {refundMethod === 'STORE_CREDIT' && bonusActive && (
                <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2.5"
                  style={{ background: 'rgba(139,133,255,0.10)', color: '#8B85FF' }}>
                  <Icon name="Sparkles" size={14} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed text-ink">
                    With <strong>+{bonusPct}% bonus</strong>, customer will receive{' '}
                    <strong className="tabular-nums">{formatMoney(totalStoreCredit, currency)}</strong> in store credit (+{formatMoney(bonusAmount, currency)} bonus).
                  </div>
                </div>
              )}
              {refundMethod === 'STORE_CREDIT' && !bonusActive && (
                <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2.5"
                  style={{ background: 'rgba(139,133,255,0.08)', color: '#8B85FF' }}>
                  <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed text-ink">
                    A store credit balance of <strong className="tabular-nums">{formatMoney(refundAmountNum, currency)}</strong> will be issued to <strong>{r.customerEmail}</strong>'s Shopify customer account.
                  </div>
                </div>
              )}
              {refundMethod === 'EXCHANGE' && (() => {
                const replacementUnit = exchangeVariant?.price ?? 0;
                const replacementTotal = replacementUnit * exchangeQty;
                const returnedCredit = itemsTotal;
                const diff = replacementTotal - returnedCredit;
                return (
                  <div className="space-y-3">
                    {(r as any).exchangeNote && (
                      <div className="p-3 rounded-md border text-[12.5px]"
                        style={{ background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.2)' }}>
                        <div className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: '#3B82F6' }}>
                          <Icon name="MessageSquare" size={12} /> Customer requested:
                        </div>
                        <div className="text-ink italic">&ldquo;{(r as any).exchangeNote}&rdquo;</div>
                      </div>
                    )}

                    {/* Product picker */}
                    <div>
                      <label className="text-[10.5px] uppercase tracking-wider text-faint font-semibold block mb-1.5">
                        Replacement item
                      </label>
                      <ProductPicker
                        value={exchangeVariant}
                        onChange={setExchangeVariant}
                        currency={currency}
                      />
                    </div>

                    {exchangeVariant && (
                      <>
                        {/* Quantity */}
                        <div className="flex items-center gap-3">
                          <label className="text-[12.5px] text-muted shrink-0">Quantity</label>
                          <div className="flex items-center gap-1">
                            <button type="button"
                              onClick={() => setExchangeQty(q => Math.max(1, q - 1))}
                              className="w-7 h-7 rounded border border-border text-ink hover:bg-bg/40 transition">
                              <Icon name="Minus" size={11} />
                            </button>
                            <input type="number" min={1} value={exchangeQty}
                              onChange={(e) => setExchangeQty(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
                              className="w-12 h-7 px-2 text-[13px] rounded-md bg-bg border border-border text-ink text-center tabular-nums focus:outline-none focus:border-accent" />
                            <button type="button"
                              onClick={() => setExchangeQty(q => q + 1)}
                              className="w-7 h-7 rounded border border-border text-ink hover:bg-bg/40 transition">
                              <Icon name="Plus" size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Price difference breakdown */}
                        <div className="rounded-md border border-divider bg-bg/30 p-3 space-y-1.5 text-[13px]">
                          <div className="flex items-center justify-between">
                            <span className="text-muted">Replacement ({exchangeQty}×)</span>
                            <span className="text-ink tabular-nums">{formatMoney(replacementTotal, currency)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted">Returned credit</span>
                            <span className="text-muted tabular-nums">- {formatMoney(returnedCredit, currency)}</span>
                          </div>
                          <div className="pt-1.5 mt-1.5 border-t border-divider flex items-center justify-between text-[13.5px] font-semibold">
                            {diff > 0.001 ? (
                              <>
                                <span className="text-ink">Customer owes</span>
                                <span className="text-[#F59E0B] tabular-nums">{formatMoney(diff, currency)}</span>
                              </>
                            ) : diff < -0.001 ? (
                              <>
                                <span className="text-ink">To refund customer</span>
                                <span className="text-[#22C55E] tabular-nums">{formatMoney(-diff, currency)}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-ink">Even exchange</span>
                                <span className="text-muted">—</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Settlement choice — only when there's a difference */}
                        {diff > 0.001 && (
                          <div className="rounded-md border border-divider p-3 space-y-2">
                            <div className="text-[12.5px] text-ink font-semibold">How should the difference be settled?</div>
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="radio" checked={diffSettlement === 'INVOICE_DIFFERENCE'}
                                onChange={() => setDiffSettlement('INVOICE_DIFFERENCE')}
                                className="mt-0.5" />
                              <div className="text-[12.5px]">
                                <div className="text-ink">Customer pays the difference</div>
                                <div className="text-[11.5px] text-muted">A draft order is invoiced for {formatMoney(diff, currency)}. Customer completes checkout to receive the item.</div>
                              </div>
                            </label>
                          </div>
                        )}
                        {diff < -0.001 && r.settings?.allowStoreCredit && (
                          <div className="rounded-md border border-divider p-3 space-y-2">
                            <div className="text-[12.5px] text-ink font-semibold">How should the difference be settled?</div>
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="radio" checked={diffSettlement === 'REFUND_DIFFERENCE'}
                                onChange={() => setDiffSettlement('REFUND_DIFFERENCE')}
                                className="mt-0.5" />
                              <div className="text-[12.5px]">
                                <div className="text-ink">Refund difference to original payment</div>
                                <div className="text-[11.5px] text-muted">Customer receives {formatMoney(-diff, currency)} back via {currencySymbol(currency)} on their card.</div>
                              </div>
                            </label>
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="radio" checked={diffSettlement === 'STORE_CREDIT_DIFFERENCE'}
                                onChange={() => setDiffSettlement('STORE_CREDIT_DIFFERENCE')}
                                className="mt-0.5" />
                              <div className="text-[12.5px]">
                                <div className="text-ink">Issue difference as store credit</div>
                                <div className="text-[11.5px] text-muted">Customer keeps {formatMoney(-diff, currency)} as store credit for future purchases.</div>
                              </div>
                            </label>
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="radio" checked={diffSettlement === 'NONE'}
                                onChange={() => setDiffSettlement('NONE')}
                                className="mt-0.5" />
                              <div className="text-[12.5px]">
                                <div className="text-ink">No settlement</div>
                                <div className="text-[11.5px] text-muted">Customer agreed to no refund of the difference.</div>
                              </div>
                            </label>
                          </div>
                        )}
                      </>
                    )}

                    {!exchangeVariant && (
                      <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2.5"
                        style={{ background: 'rgba(59,130,246,0.08)', color: '#3B82F6' }}>
                        <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                        <div className="leading-relaxed text-ink">
                          Pick the replacement item from your catalog. A draft order will be sent to <strong>{r.customerEmail}</strong> with this product, the returned items applied as credit, and any price difference invoiced or refunded.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── ADVANCED: override method ───────────────────────────── */}
              <details className="group">
                <summary className="text-[11.5px] text-muted hover:text-ink cursor-pointer select-none flex items-center gap-1.5 transition-colors">
                  <Icon name="ChevronRight" size={11} className="transition-transform group-open:rotate-90" />
                  Advanced: change refund method
                </summary>
                <div className="mt-3 p-3 rounded-md bg-bg/40 border border-divider">
                  <div className="text-[11.5px] text-muted leading-relaxed mb-2">
                    Customer originally requested <strong className="text-ink">{requested.label}</strong>. Only override if you have agreed otherwise.
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'EXCHANGE'] as const)
                      .filter(key => {
                        if (key === 'STORE_CREDIT') return !!r.settings?.allowStoreCredit;
                        if (key === 'EXCHANGE') return !!r.settings?.allowExchanges;
                        return true;
                      })
                      .map(key => {
                        const m = REFUND_TYPES[key];
                        const sel = refundMethod === key;
                        return (
                          <button key={key} onClick={() => { setOverrideMethod(true); setRefundMethod(key); }}
                            className={`text-left p-2.5 rounded-md border-2 transition ${sel ? 'border-accent bg-accent/10' : 'border-divider hover:border-[#3a3e58]'}`}>
                            <Icon name={m.icon} size={14} style={{ color: m.color }} />
                            <div className="text-[12px] font-semibold text-ink mt-1.5">{m.label}</div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </details>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function Field({ icon, label, value }: any) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} size={13} className="text-faint mt-1 shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-faint uppercase tracking-wide">{label}</div>
        <div className="text-[13px] text-ink truncate">{value}</div>
      </div>
    </div>
  );
}
function Row({ label, value, strong, muted }: any) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-ink font-semibold text-[15px]' : muted ? 'text-faint' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

/**
 * Dropdown of supported carriers (FedEx/UPS/USPS/DHL/Colissimo…) plus an
 * "Other" option that reveals a free-text input for unlisted carriers.
 * Picking a listed carrier guarantees a working "Track live" deep-link;
 * "Other" stores the typed value but the tracking link is hidden.
 */
function CarrierField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const presetValues = CARRIER_OPTIONS.map(o => o.value).filter(v => v !== OTHER_CARRIER);
  const isPreset = !!value && presetValues.includes(value);
  const startsOther = !!value && !isPreset;
  const [otherMode, setOtherMode] = useState(startsOther);
  const dropdownValue = otherMode ? OTHER_CARRIER : (isPreset ? value : '');

  return (
    <div>
      <label className="text-[12px] font-medium text-muted block mb-1.5">Carrier</label>
      <Select
        value={dropdownValue}
        onChange={(v: string) => {
          if (v === OTHER_CARRIER) {
            setOtherMode(true);
            onChange('');
          } else {
            setOtherMode(false);
            onChange(v);
          }
        }}
        options={[{ value: '', label: 'Select a carrier…' }, ...CARRIER_OPTIONS]}
      />
      {otherMode && (
        <Input
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          placeholder="Enter carrier name"
          className="mt-2"
        />
      )}
    </div>
  );
}
