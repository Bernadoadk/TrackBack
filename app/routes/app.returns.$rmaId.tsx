import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useLoaderData, useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, StatusBadge, Btn, Card, Modal, Textarea, Toggle, useToast, STATUS_STYLES, Input } from "../components/ui";
import { REFUND_TYPES } from "../components/mock-data";
import { sendReturnEmail } from "../lib/mailer.server";
import { getTrackingUrl, getCarrierDisplayName, getEstimatedTransitLabel } from "../lib/carriers";
import { evaluateOnboarding } from "../lib/onboarding.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

  const returnRequest = await prisma.returnRequest.findUnique({
    where: { rma: rmaId, shop },
    include: {
      items: true,
      notes: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
      settings: true
    }
  });

  if (!returnRequest) {
    throw new Response("Not Found", { status: 404 });
  }

  const onboarding = evaluateOnboarding(returnRequest.settings);
  return {
    returnRequest,
    onboardingIncomplete: onboarding.status !== 'complete',
    onboardingMissing: onboarding.missingFields,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

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
        refund_amount: `$${rr.refundAmount.toFixed(2)}`,
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

        const currency = order.currencyCode || 'USD';

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
              creditAmount: { amount: refundAmount.toFixed(2), currencyCode: currency },
            }
          }
        });
        const creditData = await creditRes.json();
        const creditErrors = creditData.data?.storeCreditAccountCredit?.userErrors || [];
        if (creditErrors.length > 0) {
          return { error: `Failed to issue store credit: ${creditErrors.map((e: any) => e.message).join(', ')}` };
        }
        storeCreditTxId = creditData.data?.storeCreditAccountCredit?.storeCreditAccountTransaction?.id ?? null;
        storeCreditCode = `$${refundAmount.toFixed(2)} ${currency} store credit`;

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
                note: `Store credit issued via ReturnFlow (${rr.rma})`,
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

    // ─── EXCHANGE (draft order + invoice email) ───────────────────────────
    } else if (refundMethod === 'EXCHANGE') {
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
              note: rr.exchangeNote || 'Exchange request',
              lineItems: [{
                title: `Exchange — ${rr.exchangeNote || 'Replacement item'}`,
                originalUnitPrice: refundAmount.toFixed(2),
                quantity: 1,
                requiresShipping: true,
              }],
              appliedDiscount: {
                value: refundAmount,
                amount: refundAmount,
                valueType: "FIXED_AMOUNT",
                title: `Return credit ${rmaId}`,
              },
              tags: [`exchange`, `return-${rmaId}`],
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

          // Auto-send the invoice email so the customer can complete the exchange purchase.
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
            // Don't block — the draft order was created. Surface a warning via event.
            console.warn('draftOrderInvoiceSend errors:', sendErrors);
          }
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

    await prisma.returnEvent.create({
      data: {
        returnRequestId: rr.id,
        type: refundMethod === 'EXCHANGE' ? 'EXCHANGE_CREATED' : 'REFUNDED',
        source: 'merchant',
        title:
          refundMethod === 'EXCHANGE' ? 'Exchange order created'
          : refundMethod === 'STORE_CREDIT' ? 'Store credit issued'
          : 'Refund issued',
        detail: `$${refundAmount.toFixed(2)} · ${REFUND_TYPES[refundMethod]?.label ?? refundMethod}`,
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
      refund_amount: `$${refundAmount.toFixed(2)}`,
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
  const { returnRequest, onboardingIncomplete, onboardingMissing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const toast = useToast();

  const r = returnRequest;

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [refundOpen,  setRefundOpen]  = useState(false);
  const [shipOpen,    setShipOpen]    = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [overrideMethod, setOverrideMethod] = useState(false);
  const [refundMethod, setRefundMethod] = useState(r.refundType || 'ORIGINAL_PAYMENT');
  const [refundAmountStr, setRefundAmountStr] = useState((r.refundAmount || 0).toFixed(2));

  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [labelUrl, setLabelUrl] = useState('');

  // Ship modal state (when merchant manually marks as shipped)
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTracking, setShipTracking] = useState('');

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
      toast({ kind: 'success', title: 'Refund issued', body: `${methodLabel} — $${parseFloat(refundAmountStr || '0').toFixed(2)} to ${r.customerName}.` });
    } else if (data.error) {
      toast({ kind: 'error', title: 'Error', body: data.error });
    }
  }, [fetcher.data, fetcher.state, r.rma, r.customerName, refundMethod, refundAmountStr, toast]);

  const itemsTotal = r.items.reduce((s: number, it: any) => s + it.price * it.quantity, 0);
  const restocking = 0;
  const refund = itemsTotal - restocking;

  const isPending  = r.status === 'PENDING';
  const isApproved = r.status === 'APPROVED';
  const isShipped  = r.status === 'SHIPPED';
  const isReceived = r.status === 'RECEIVED';
  const isClosed   = ['REFUNDED', 'REJECTED', 'EXPIRED'].includes(r.status);

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
    fetcher.submit({ intent: 'process_refund', refundMethod, refundAmount: refundAmountStr }, { method: 'POST' });
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
  if (r.approvedAt || ['APPROVED','SHIPPED','RECEIVED','REFUNDED'].includes(r.status)) {
    timeline.push({ title: 'Return Approved', detail: 'Shipping instructions sent to customer', time: fallback(r.approvedAt), icon: 'CircleCheck', color: '#3B82F6' });
  }
  if (r.rejectedAt || r.status === 'REJECTED') {
    timeline.push({ title: 'Return Rejected', detail: r.rejectionReason || 'No reason provided', time: fallback(r.rejectedAt), icon: 'CircleX', color: '#EF4444' });
  }
  if (r.status === 'EXPIRED') {
    timeline.push({ title: 'Return Expired', detail: 'Customer did not ship within the allowed window', time: fmt(r.updatedAt), icon: 'Clock', color: '#6B7280' });
  }
  if (r.shippedAt || ['SHIPPED','RECEIVED','REFUNDED'].includes(r.status)) {
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
    .filter((e: any) => ['IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED'].includes(e.type))
    .forEach((e: any) => {
      timeline.push({
        title: e.title,
        detail: e.detail || '',
        time: fmt(e.createdAt),
        icon: e.type === 'DELIVERED' ? 'PackageCheck' : e.type === 'OUT_FOR_DELIVERY' ? 'Truck' : 'MoveRight',
        color: e.type === 'DELIVERED' ? '#8B5CF6' : '#10B981',
      });
    });
  if (r.receivedAt || ['RECEIVED','REFUNDED'].includes(r.status)) {
    timeline.push({ title: 'Items Received', detail: 'Items confirmed at warehouse', time: fallback(r.receivedAt), icon: 'PackageCheck', color: '#8B5CF6' });
  }
  if (r.refundedAt || r.status === 'REFUNDED') {
    const label = REFUND_TYPES[r.refundType as string]?.label ?? r.refundType;
    timeline.push({
      title: r.refundType === 'EXCHANGE' ? 'Exchange order created' : 'Refund issued',
      detail: `${label} · $${r.refundAmount.toFixed(2)}`,
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">
          {/* Customer */}
          <Card title="Customer">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full grid place-content-center text-[14px] font-bold text-white shrink-0"
                   style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                {r.customerName ? r.customerName.split(' ').map((p: string) => p[0]).slice(0,2).join('').toUpperCase() : r.customerEmail[0].toUpperCase()}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
                <div className="col-span-2">
                  <div className="text-ink font-semibold text-[14px]">{r.customerName || r.customerEmail.split('@')[0]}</div>
                </div>
                <Field icon="Mail"     label="Email"   value={r.customerEmail} />
                <Field icon="Phone"    label="Phone"   value={r.customerPhone || 'N/A'} />
                <Field icon="Receipt"  label="Order"   value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
                <Field icon="Calendar" label="Date"    value={new Date(r.orderDate).toLocaleDateString()} />
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
                {(r.trackingUrl || (r.carrier && r.trackingNumber)) && (
                  <a
                    href={r.trackingUrl ?? getTrackingUrl(r.carrier, r.trackingNumber) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-2.5"
                  >
                    <Btn variant="secondary" className="w-full" size="lg" icon="ExternalLink">
                      Track live · {getCarrierDisplayName(r.carrier)}
                    </Btn>
                  </a>
                )}
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
              <Row label="Items total"      value={`$${itemsTotal.toFixed(2)}`} />
              <Row label="Restocking fee"   value={`-$${restocking.toFixed(2)}`} muted />
              <div className="border-t border-divider my-2"></div>
              <Row label="Estimated refund" value={`$${refund.toFixed(2)}`} strong />
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
              <Row label="Order"    value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
              <Row label="Total"    value={`$${r.orderTotal.toFixed(2)}`} />
              {r.carrier       && <Row label="Carrier"   value={r.carrier} />}
              {r.trackingNumber && <Row label="Tracking"  value={r.trackingNumber} />}
              {r.shippedAt     && <Row label="Shipped"   value={new Date(r.shippedAt).toLocaleDateString()} />}
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
            The customer will be emailed shipping instructions. Optionally provide a prepaid label below.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Carrier</label>
              <Input value={carrier} onChange={(e: any) => setCarrier(e.target.value)} placeholder="e.g. FedEx" />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking Number</label>
              <Input value={trackingNumber} onChange={(e: any) => setTrackingNumber(e.target.value)} placeholder="e.g. 1Z999..." />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">Prepaid Shipping Label URL <span className="text-faint font-normal">(optional)</span></label>
            <Input value={labelUrl} onChange={(e: any) => setLabelUrl(e.target.value)} placeholder="https://..." />
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
          <div className="text-[13px] text-muted leading-relaxed">
            Confirm that the customer has shipped the items back. Add tracking info if available.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Carrier</label>
              <Input value={shipCarrier} onChange={(e: any) => setShipCarrier(e.target.value)} placeholder="e.g. USPS" />
            </div>
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
               <Btn variant="primary" icon={r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign'} onClick={handleRefund} disabled={fetcher.state !== 'idle'}>
                 {refundMethod === 'EXCHANGE' ? 'Create Exchange Order' : 'Confirm Refund'}
               </Btn>
             </>}>
        {(() => {
          const requested = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
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
              <div>
                <div className="text-[11px] uppercase tracking-wider text-faint font-semibold mb-1.5">Customer requested</div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md"
                     style={{ background: requested.bg, color: requested.color }}>
                  <Icon name={requested.icon} size={14} />
                  <span className="text-[13px] font-semibold">{requested.label}</span>
                </div>
              </div>

              <div className="p-3 rounded-md bg-bg/40 border border-divider">
                <Toggle checked={overrideMethod} onChange={(v: boolean) => { setOverrideMethod(v); if (!v) setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT'); }}
                        label="Override refund method"
                        description="Issue a different refund type than the customer requested." />
                {overrideMethod && (
                  <div className="mt-3 grid grid-cols-3 gap-2 animate-fadeIn">
                    {['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'EXCHANGE'].map(key => {
                      const m = REFUND_TYPES[key];
                      const sel = refundMethod === key;
                      return (
                        <button key={key} onClick={() => setRefundMethod(key)}
                          className={`text-left p-2.5 rounded-md border-2 transition ${sel ? 'border-accent bg-accent/10' : 'border-divider hover:border-[#3a3e58]'}`}>
                          <Icon name={m.icon} size={14} style={{ color: m.color }} />
                          <div className="text-[12px] font-semibold text-ink mt-1.5">{m.label}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wider text-faint font-semibold block mb-1.5">Refund amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[14px]">$</span>
                  <input value={refundAmountStr} onChange={e => setRefundAmountStr(e.target.value)}
                         className="w-full h-10 pl-7 pr-3 text-[15px] rounded-md bg-bg border border-border text-ink font-semibold tabular-nums focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
                </div>
              </div>

              {refundMethod === 'STORE_CREDIT' && (
                <div className="p-3 rounded-md text-[12.5px] flex gap-2 items-start"
                     style={{ background: 'rgba(108,99,255,0.10)', color: '#8B85FF' }}>
                  <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed">A Shopify gift card will be issued to the customer via <code>refundCreate</code> and sent by email.</div>
                </div>
              )}
              {refundMethod === 'EXCHANGE' && (
                <div className="space-y-3">
                  {(r as any).exchangeNote && (
                    <div className="p-3 rounded-md border text-[12.5px]"
                         style={{ background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.2)', color: '#3B82F6' }}>
                      <div className="font-semibold mb-1 flex items-center gap-1.5"><Icon name="MessageSquare" size={12} /> Customer requested:</div>
                      <div className="text-ink italic">"{(r as any).exchangeNote}"</div>
                    </div>
                  )}
                  <div className="p-3 rounded-md text-[12.5px] flex gap-2 items-start"
                       style={{ background: 'rgba(59,130,246,0.08)', color: '#3B82F6' }}>
                    <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                    <div className="leading-relaxed">A Shopify draft order will be created with the return value applied as a discount credit. You can then edit it in Shopify admin to add the exact replacement item before completing it.</div>
                  </div>
                </div>
              )}
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
