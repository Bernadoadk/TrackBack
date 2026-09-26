import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useLoaderData, useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, StatusBadge, Btn, Card, Modal, Textarea, Toggle, useToast, STATUS_STYLES, Input, Select, RiskBadge, TierBadge } from "../components/ui";
import { REFUND_TYPES } from "../components/mock-data";
import { getTrackingUrl, getCarrierDisplayName, getEstimatedTransitLabel, CARRIER_OPTIONS, OTHER_CARRIER } from "../lib/carriers";
import { evaluateOnboarding } from "../lib/onboarding.server";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoney, currencySymbol } from "../lib/money";
import { ProductPicker, type PickedVariant } from "../components/ProductPicker";
import { ensureBillingSynced } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";
import { processRefund, transitionStatus, type RefundMethod } from "../lib/returns-service.server";
import { PAYOUT_METHODS, maskAccount, normalizeLocale, payoutMethodLabel } from "../lib/i18n";
import { waLink, whatsappStatusText } from "../lib/whatsapp";
import { statusUrl, buildReturnInstructions } from "../lib/notifications.server";
import { EMAIL_STRINGS } from "../lib/email-templates";
import { getReturnMethods } from "../lib/returns-logic";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

  const [returnRequest, currency, plan] = await Promise.all([
    prisma.returnRequest.findFirst({
      where: { rma: rmaId, shop },
      include: {
        items: true,
        notes: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'asc' } },
        settings: true,
      },
    }),
    getShopCurrency(shop, admin),
    ensureBillingSynced(admin, shop),
  ]);
  if (!returnRequest) throw new Response("Not Found", { status: 404 });

  // Refundable balance on the original payment (totalReceived − totalRefunded).
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

  // Customer history (fraud signals, Pro)
  let history: { total: number; last90: number; refunded: number } | null = null;
  if (hasFeature(plan, 'fraud')) {
    const since90 = new Date(Date.now() - 90 * 86400000);
    const where = { shop, customerEmail: { equals: returnRequest.customerEmail, mode: 'insensitive' as const } };
    const [total, last90, refunded] = await Promise.all([
      prisma.returnRequest.count({ where }),
      prisma.returnRequest.count({ where: { ...where, createdAt: { gte: since90 } } }),
      prisma.returnRequest.count({ where: { ...where, status: 'REFUNDED' } }),
    ]);
    history = { total, last90, refunded };
  }

  // WhatsApp click-to-chat message prefilled for the current status (Pro).
  let whatsapp: string | null = null;
  if (hasFeature(plan, 'whatsapp') && returnRequest.customerPhone) {
    const locale = normalizeLocale(returnRequest.locale) ?? 'en';
    const s = EMAIL_STRINGS[locale];
    const url = statusUrl(shop, returnRequest.rma);
    const type = returnRequest.status === 'APPROVED' ? 'Approved'
      : returnRequest.status === 'REJECTED' ? 'Rejected'
      : returnRequest.status === 'SHIPPED' ? 'Shipped'
      : returnRequest.status === 'RECEIVED' ? 'Received'
      : returnRequest.status === 'REFUNDED' ? 'Refunded'
      : returnRequest.status === 'EXPIRED' ? 'Expired'
      : 'Request Received';
    const text = whatsappStatusText(type, locale, {
      name: returnRequest.customerName || returnRequest.customerEmail.split('@')[0],
      rma: returnRequest.rma,
      order: returnRequest.orderName,
      url,
      reason: returnRequest.rejectionReason ?? undefined,
      method: returnRequest.refundType === 'STORE_CREDIT' ? s.methodStoreCredit : returnRequest.refundType === 'EXCHANGE' ? s.methodExchange : s.methodRefund,
      amount: formatMoney(returnRequest.refundAmount || returnRequest.itemsTotal, currency),
      instructions: type === 'Approved' ? buildReturnInstructions(returnRequest as any, locale, url).replace(/\n+/g, ' ') : undefined,
    });
    whatsapp = waLink(returnRequest.customerPhone, text);
  }

  const onboarding = evaluateOnboarding(returnRequest.settings);
  const methods = getReturnMethods(returnRequest.settings);
  return {
    returnRequest: { ...returnRequest, maxRefundable },
    currency,
    plan,
    features: {
      storeCredit: hasFeature(plan, 'storeCredit'),
      exchange: hasFeature(plan, 'variantExchange'),
      fraud: hasFeature(plan, 'fraud'),
      whatsapp: hasFeature(plan, 'whatsapp'),
    },
    history,
    whatsapp,
    returnMethod: methods.includes(returnRequest.returnMethod as any) ? returnRequest.returnMethod : methods[0],
    onboardingIncomplete: onboarding.status !== 'complete',
    onboardingMissing: onboarding.missingFields,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const rma = params.rmaId!;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  let res: { ok: boolean; error?: string } = { ok: false, error: 'Unknown action' };

  if (intent === 'approve') {
    const carrier = get('carrier');
    const trackingNumber = get('trackingNumber');
    res = await transitionStatus({
      admin, shop, rma, to: 'APPROVED', source: 'merchant',
      carrier, trackingNumber,
      trackingUrl: getTrackingUrl(carrier, trackingNumber),
      labelUrl: get('labelUrl'),
    });
  } else if (intent === 'reject') {
    const reason = get('reason');
    res = reason
      ? await transitionStatus({ admin, shop, rma, to: 'REJECTED', reason, source: 'merchant' })
      : { ok: false, error: 'A reason is required.' };
  } else if (intent === 'ship') {
    const carrier = get('carrier');
    const trackingNumber = get('trackingNumber');
    res = await transitionStatus({
      admin, shop, rma, to: 'SHIPPED', source: 'merchant',
      carrier, trackingNumber, trackingUrl: getTrackingUrl(carrier, trackingNumber),
    });
  } else if (intent === 'receive') {
    res = await transitionStatus({ admin, shop, rma, to: 'RECEIVED', source: 'merchant' });
  } else if (intent === 'refund') {
    const method = String(formData.get('refundMethod') ?? 'ORIGINAL_PAYMENT') as RefundMethod;
    const currency = await getShopCurrency(shop, admin);
    let exchange: any = null;
    const linesJson = get('exchangeLines');
    if (method === 'EXCHANGE') {
      try {
        const parsed = linesJson ? JSON.parse(linesJson) : null;
        exchange = {
          lines: Array.isArray(parsed) && parsed.length ? parsed.map((l: any) => ({
            variantId: String(l.variantId), quantity: Math.max(1, parseInt(l.quantity, 10) || 1), price: Number(l.price) || 0,
          })) : undefined,
          diffSettlement: get('diffSettlement') ?? 'INVOICE_DIFFERENCE',
        };
      } catch {
        return { ok: false, intent, error: 'Invalid exchange selection.' };
      }
    }
    res = await processRefund({
      admin, shop, rma, method, currency, source: 'merchant',
      amount: parseFloat(String(formData.get('refundAmount') ?? '0')) || 0,
      exchange,
      payout: method === 'MANUAL' ? {
        method: get('payoutMethod') ?? undefined,
        account: get('payoutAccount') ?? undefined,
        name: get('payoutName') ?? undefined,
        reference: get('payoutReference') ?? undefined,
      } : null,
    });
  } else if (intent === 'add_note') {
    const text = get('text');
    const rr = await prisma.returnRequest.findFirst({ where: { rma, shop }, select: { id: true } });
    if (rr && text) {
      await prisma.internalNote.create({ data: { returnRequestId: rr.id, text: text.slice(0, 2000), author: 'Admin' } });
      res = { ok: true };
    } else {
      res = { ok: false, error: 'Note is empty.' };
    }
  }

  return res.ok ? { success: true, intent } : { success: false, intent, error: res.error };
};

const EVENT_ICON: Record<string, { icon: string; color: string }> = {
  SHOPIFY_MIRROR_FAILED: { icon: 'TriangleAlert', color: '#EF4444' },
  SHOPIFY_MIRROR_OK: { icon: 'Link', color: '#10B981' },
  SHOPIFY_IMPORTED: { icon: 'Download', color: '#6B7280' },
  AUTO_REFUND_FAILED: { icon: 'TriangleAlert', color: '#EF4444' },
  WITHDRAWAL_REQUESTED: { icon: 'FileX', color: '#F59E0B' },
};

export default function ReturnDetailPage() {
  const { returnRequest, currency, features, history, whatsapp, returnMethod, onboardingIncomplete, onboardingMissing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const toast = useToast();
  const r = returnRequest;
  const busy = fetcher.state !== 'idle';

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const itemsTotal = r.items.reduce((s: number, it: any) => s + it.price * it.quantity, 0);
  const fees = r.feeAmount || 0;
  const baseRefund = Math.max(0, itemsTotal - fees);
  const bonusPct = r.settings.storeCreditBonusPercent || 0;
  const hasCustomerExchange = r.items.some((it: any) => !!it.exchangeVariantId);

  // Refund modal state
  const defaultMethod = (): RefundMethod =>
    r.refundType === 'STORE_CREDIT' ? 'STORE_CREDIT'
      : r.refundType === 'EXCHANGE' ? 'EXCHANGE'
      : r.isOfflinePayment ? 'MANUAL'
      : 'ORIGINAL_PAYMENT';
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(defaultMethod());
  const [refundAmountStr, setRefundAmountStr] = useState('');
  const [payoutMethod, setPayoutMethod] = useState(r.payoutMethod || 'bank_transfer');
  const [payoutAccount, setPayoutAccount] = useState(r.payoutAccount || '');
  const [payoutName, setPayoutName] = useState(r.payoutName || r.customerName || '');
  const [payoutReference, setPayoutReference] = useState('');
  const [exchangeVariant, setExchangeVariant] = useState<PickedVariant | null>(null);
  const [exchangeQty, setExchangeQty] = useState(1);
  const [useCustomerChoice, setUseCustomerChoice] = useState(hasCustomerExchange);
  const [diffSettlement, setDiffSettlement] = useState<'INVOICE_DIFFERENCE' | 'REFUND_DIFFERENCE' | 'STORE_CREDIT_DIFFERENCE' | 'NONE'>('INVOICE_DIFFERENCE');

  // Approve / ship state
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [labelUrl, setLabelUrl] = useState('');
  const [providingLabel, setProvidingLabel] = useState(returnMethod === 'label');
  const [shipCarrier, setShipCarrier] = useState(r.carrier ?? '');
  const [shipTracking, setShipTracking] = useState(r.trackingNumber ?? '');

  const handledRef = useRef<any>(null);
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data || handledRef.current === fetcher.data) return;
    handledRef.current = fetcher.data;
    const data = fetcher.data as any;
    if (!data.success) {
      toast({ kind: 'error', title: 'Action failed', body: data.error });
      return;
    }
    const messages: Record<string, [string, string?]> = {
      approve: ['Return approved', 'Return instructions sent to the customer.'],
      reject: ['Return rejected', 'The customer has been notified.'],
      ship: ['Marked as shipped', 'Waiting for arrival at your warehouse.'],
      receive: ['Marked as received', 'Ready for refund.'],
      refund: ['Done', 'Refund processed and customer notified.'],
      add_note: ['Note added'],
    };
    const [title, body] = messages[data.intent] ?? ['Saved'];
    toast({ kind: data.intent === 'reject' ? 'info' : 'success', title, body });
    setApproveOpen(false);
    setRejectOpen(false);
    setShipOpen(false);
    setRefundOpen(false);
    if (data.intent === 'add_note') setInternalNote('');
  }, [fetcher.state, fetcher.data, toast]);

  const hasIssuedRefund = !!(r.refundedAt || r.status === 'REFUNDED');
  const isPending = r.status === 'PENDING';
  const isApproved = r.status === 'APPROVED' && !hasIssuedRefund;
  const isShipped = r.status === 'SHIPPED' && !hasIssuedRefund;
  const isReceived = r.status === 'RECEIVED' && !hasIssuedRefund;
  const isClosed = hasIssuedRefund || ['REFUNDED', 'REJECTED', 'EXPIRED'].includes(r.status);
  const canRefund = isReceived || (isApproved && r.keepItem);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: 'POST' });

  const openRefundModal = () => {
    const m = defaultMethod();
    setRefundMethod(m);
    const amount = (m === 'STORE_CREDIT' || m === 'GIFT_CARD') && r.settings.incentivizeStoreCredit
      ? baseRefund * (1 + bonusPct / 100)
      : baseRefund;
    setRefundAmountStr((r.refundAmount > 0 ? r.refundAmount : amount).toFixed(2));
    setRefundOpen(true);
  };

  const refundAmountNum = parseFloat(refundAmountStr || '0') || 0;
  const maxRefundable = (r as any).maxRefundable ?? Math.max(itemsTotal, r.orderTotal);
  const refundExceedsMax = refundMethod === 'ORIGINAL_PAYMENT' && refundAmountNum > maxRefundable + 0.001;

  // Exchange lines for the refund action
  const exchangeLines = refundMethod !== 'EXCHANGE'
    ? []
    : useCustomerChoice && hasCustomerExchange
      ? r.items.filter((it: any) => it.exchangeVariantId).map((it: any) => ({ variantId: it.exchangeVariantId, quantity: it.quantity, price: it.exchangeVariantPrice ?? it.price, title: `${it.exchangeProductTitle ?? ''} — ${it.exchangeVariantTitle ?? ''}` }))
      : exchangeVariant ? [{ variantId: exchangeVariant.id, quantity: exchangeQty, price: exchangeVariant.price, title: exchangeVariant.title }] : [];
  const replacementTotal = exchangeLines.reduce((s: number, l: any) => s + l.price * l.quantity, 0);
  const exchangeDiff = replacementTotal - baseRefund;

  const handleRefund = () => {
    const payload: Record<string, string> = { intent: 'refund', refundMethod, refundAmount: refundAmountStr };
    if (refundMethod === 'EXCHANGE') {
      payload.exchangeLines = JSON.stringify(exchangeLines);
      payload.diffSettlement = diffSettlement;
    }
    if (refundMethod === 'MANUAL') Object.assign(payload, { payoutMethod, payoutAccount, payoutName, payoutReference });
    submit(payload);
  };

  const refundDisabled =
    busy || refundExceedsMax ||
    (refundMethod !== 'EXCHANGE' && refundAmountNum <= 0) ||
    (refundMethod === 'EXCHANGE' && exchangeLines.length === 0) ||
    (refundMethod === 'MANUAL' && payoutMethod !== 'cash' && !payoutAccount.trim());

  // Timeline: lifecycle timestamps + noteworthy system events
  const fmt = (d: any) => new Date(d).toLocaleString();
  const timeline: any[] = [
    { at: r.createdAt, title: r.requestType === 'WITHDRAWAL' ? 'Withdrawal received (EU)' : 'Return requested', detail: 'Submitted from the customer portal', icon: 'PackagePlus', color: '#22C55E' },
  ];
  if (r.approvedAt) timeline.push({ at: r.approvedAt, title: 'Return approved', detail: r.keepItem ? 'Green return: customer keeps the item' : 'Return instructions sent to customer', icon: 'CircleCheck', color: '#3B82F6' });
  if (r.rejectedAt && r.status === 'REJECTED') timeline.push({ at: r.rejectedAt, title: 'Return rejected', detail: r.rejectionReason || 'No reason provided', icon: 'CircleX', color: '#EF4444' });
  if (r.shippedAt) timeline.push({ at: r.shippedAt, title: 'Items shipped', detail: r.trackingNumber ? `${getCarrierDisplayName(r.carrier)} · ${r.trackingNumber}` : 'Customer shipped the items', icon: 'Truck', color: '#10B981', trackingUrl: r.trackingUrl || getTrackingUrl(r.carrier, r.trackingNumber) });
  if (r.receivedAt) timeline.push({ at: r.receivedAt, title: 'Items received', detail: 'Items confirmed at warehouse', icon: 'PackageCheck', color: '#8B5CF6' });
  if (r.refundedAt) {
    const label = REFUND_TYPES[r.refundType as string]?.label ?? (r.refundType === 'GIFT_CARD' ? 'Gift card' : r.refundType === 'MANUAL' ? 'Manual payout' : r.refundType);
    timeline.push({ at: r.refundedAt, title: r.refundType === 'EXCHANGE' ? 'Exchange order created' : 'Refund issued', detail: `${label} · ${formatMoney(r.refundAmount, currency)}`, icon: r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign', color: '#22C55E', exchangeUrl: r.refundType === 'EXCHANGE' ? r.exchangeOrderUrl : undefined });
  }
  if (r.status === 'EXPIRED') timeline.push({ at: r.expiredAt ?? r.updatedAt, title: 'Return expired', detail: 'Customer did not ship within the allowed window', icon: 'Clock', color: '#6B7280' });
  for (const e of r.events as any[]) {
    const meta = EVENT_ICON[e.type];
    if (meta) timeline.push({ at: e.createdAt, title: e.title, detail: e.detail || '', icon: meta.icon, color: meta.color });
  }
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const lastMirrorFail = (r.events || []).filter((e: any) => e.type === 'SHOPIFY_MIRROR_FAILED').slice(-1)[0];
  const orderNumericId = String(r.orderId).split('/').pop();
  const methodLabel: Record<string, string> = { ship: 'Customer ships', label: 'Prepaid label', store: 'Store drop-off', pickup: 'Home pickup' };

  const refundMethods: { key: RefundMethod; label: string; icon: string; color: string; available: boolean; hint?: string }[] = [
    { key: 'ORIGINAL_PAYMENT', label: 'Original payment', icon: 'CreditCard', color: '#8B8FA8', available: true, hint: r.isOfflinePayment ? 'Paid offline (COD)' : undefined },
    { key: 'MANUAL', label: 'Manual payout', icon: 'Smartphone', color: '#F59E0B', available: true },
    { key: 'STORE_CREDIT', label: 'Store credit', icon: 'Gift', color: '#6C63FF', available: features.storeCredit },
    { key: 'GIFT_CARD', label: 'Gift card', icon: 'Ticket', color: '#EC4899', available: features.storeCredit },
    { key: 'EXCHANGE', label: 'Exchange', icon: 'RefreshCw', color: '#3B82F6', available: features.exchange },
  ];

  return (
    <div>
      <Link to={`/app/returns${location.search}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition mb-4 group">
        <Icon name="ArrowLeft" size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Returns
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold text-ink tracking-tight font-mono">{r.rma}</h1>
            <StatusBadge status={r.status} size="lg" />
            {r.requestType === 'WITHDRAWAL' && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.14)', color: '#F59E0B' }}>EU withdrawal</span>
            )}
            {r.keepItem && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.14)', color: '#22C55E' }}>
                <Icon name="Leaf" size={11} /> Keep item
              </span>
            )}
            {features.fraud && <RiskBadge level={r.riskLevel} />}
          </div>
          <div className="text-[13px] text-muted mt-1.5">
            Submitted {new Date(r.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {r.locale && <span className="ml-2 uppercase text-[11px] font-semibold text-faint">{r.locale}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <Btn variant="secondary" icon="MessageCircle">WhatsApp</Btn>
            </a>
          )}
          <a href={`shopify://admin/orders/${orderNumericId}`} target="_top">
            <Btn variant="secondary" icon="ExternalLink">Order {r.orderName}</Btn>
          </a>
        </div>
      </div>

      {!r.shopifyReturnId && (() => {
        const isFulfillmentWait = !lastMirrorFail || (lastMirrorFail.detail?.includes('no fulfilled items') && !lastMirrorFail.detail?.includes('Access denied'));
        return isFulfillmentWait ? (
          <div className="mb-4 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-4 py-3 flex items-start gap-3">
            <Icon name="Clock" size={16} className="mt-0.5 shrink-0" style={{ color: '#3B82F6' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink">Waiting for order fulfillment</div>
              <div className="text-[12px] text-muted mt-0.5 leading-relaxed">This return will appear in your Shopify Admin automatically as soon as the order's items are fulfilled.</div>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 flex items-start gap-3">
            <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink">Couldn't sync to Shopify Admin</div>
              <div className="text-[12px] text-muted mt-0.5 leading-relaxed break-words">{lastMirrorFail.detail || 'Unknown error.'}</div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">
          <Card title="Customer">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full grid place-content-center text-[14px] font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                {r.customerName ? r.customerName.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase() : r.customerEmail[0].toUpperCase()}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
                <div className="col-span-2 text-ink font-semibold text-[14px]">{r.customerName || r.customerEmail.split('@')[0]}</div>
                <Field icon="Mail" label="Email" value={<a href={`mailto:${r.customerEmail}`} className="hover:underline">{r.customerEmail}</a>} />
                <Field icon="Phone" label="Phone" value={r.customerPhone || '—'} />
                <Field icon="Receipt" label="Order" value={r.orderName} />
                <Field icon="Calendar" label="Order date" value={new Date(r.orderDate).toLocaleDateString()} />
              </div>
            </div>
            {history && (
              <div className="mt-4 pt-3 border-t border-divider flex items-center gap-4 text-[12px] text-muted flex-wrap">
                <span><strong className="text-ink">{history.total}</strong> return request{history.total > 1 ? 's' : ''} in total</span>
                <span><strong className="text-ink">{history.last90}</strong> in the last 90 days</span>
                <span><strong className="text-ink">{history.refunded}</strong> refunded</span>
              </div>
            )}
          </Card>

          <Card title="Items Requested" subtitle={`${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`}>
            <div className="space-y-3">
              {r.items.map((it: any) => {
                let photos: string[] = [];
                try { photos = JSON.parse(it.photos || '[]'); } catch { photos = []; }
                return (
                  <div key={it.id} className="flex gap-4 p-3 rounded-md bg-bg/40 border border-divider">
                    <div className="w-16 h-16 rounded-md grid place-content-center shrink-0 overflow-hidden bg-[#f8fafc]">
                      {it.imageUrl ? <img src={it.imageUrl} alt={it.name} className="w-full h-full object-cover" /> : <Icon name="Shirt" size={22} className="text-[#ccc]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-[13.5px] font-semibold text-ink">{it.name}</div>
                          <div className="text-[12px] text-muted mt-0.5">{it.variantName && it.variantName !== 'Default Title' ? `${it.variantName} · ` : ''}Qty {it.quantity}{it.sku ? ` · ${it.sku}` : ''}</div>
                        </div>
                        <div className="text-[13.5px] font-semibold text-ink tabular-nums">{formatMoney(it.price * it.quantity, currency)}</div>
                      </div>
                      <div className="mt-2 flex items-start gap-2 flex-wrap text-[12px]">
                        <span className="px-2 py-0.5 rounded bg-white/[0.05] text-muted border border-divider">Reason: <span className="text-ink">{it.reason}</span></span>
                        {it.note && <span className="px-2 py-0.5 rounded bg-warn/10 text-warn border border-warn/20 italic">"{it.note}"</span>}
                        {it.exchangeVariantId && (
                          <span className="px-2 py-0.5 rounded border inline-flex items-center gap-1" style={{ background: 'rgba(59,130,246,0.08)', color: '#3B82F6', borderColor: 'rgba(59,130,246,0.25)' }}>
                            <Icon name="RefreshCw" size={11} /> Wants: {it.exchangeProductTitle} — {it.exchangeVariantTitle}
                          </span>
                        )}
                      </div>
                      {photos.length > 0 && (
                        <div className="mt-2 flex gap-2 flex-wrap">
                          {photos.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                              <img src={u} alt="Customer photo" className="w-14 h-14 rounded-md object-cover border border-divider hover:opacity-80 transition" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-divider text-[13px]">
                <span className="text-muted">Total items value</span>
                <span className="text-ink font-semibold text-[15px] tabular-nums">{formatMoney(itemsTotal, currency)}</span>
              </div>
            </div>
          </Card>

          <Card title="Timeline">
            <div className="relative">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-divider" />
              <div className="space-y-4">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 relative">
                    <div className="w-[22px] h-[22px] rounded-full grid place-content-center shrink-0 relative z-10 border-[3px] border-surface" style={{ background: t.color }}>
                      <Icon name={t.icon} size={11} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink">{t.title}</span>
                        <span className="text-[11.5px] text-muted">· {fmt(t.at)}</span>
                      </div>
                      {t.detail && <div className="text-[12.5px] text-muted mt-0.5 break-words">{t.detail}</div>}
                      {t.trackingUrl && (
                        <a href={t.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] text-accent2 hover:underline">
                          <Icon name="ExternalLink" size={12} /> Track live
                        </a>
                      )}
                      {t.exchangeUrl && (
                        <a href={t.exchangeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] text-accent2 hover:underline">
                          <Icon name="ExternalLink" size={12} /> View exchange invoice
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Internal Notes" subtitle="Only visible to your team">
            <Textarea value={internalNote} onChange={(e: any) => setInternalNote(e.target.value)} placeholder="Add a private note…" rows={3} />
            <div className="flex justify-end mt-2.5">
              <Btn variant="secondary" icon="Plus" size="sm" onClick={() => submit({ intent: 'add_note', text: internalNote })} disabled={!internalNote.trim() || busy}>Add Note</Btn>
            </div>
            {r.notes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-divider space-y-2.5">
                {r.notes.map((n: any) => (
                  <div key={n.id} className="flex gap-2.5 text-[12.5px]">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent2 grid place-content-center text-[10px] font-bold shrink-0">AD</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-ink font-medium">{n.author}</span><span className="text-faint">{new Date(n.createdAt).toLocaleString()}</span></div>
                      <div className="text-muted mt-0.5 whitespace-pre-line">{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-2 space-y-5">
          <Card title="Actions">
            {isPending && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon="Check" onClick={() => setApproveOpen(true)} disabled={busy}>Approve Return</Btn>
                <Btn variant="danger-outline" className="w-full mt-2.5" size="lg" icon="X" onClick={() => setRejectOpen(true)} disabled={busy}>Reject Return</Btn>
                <div className="mt-4 pt-4 border-t border-divider text-[12px] text-muted leading-relaxed">
                  {r.keepItem ? 'Green return: once approved you can refund right away, no shipment needed.' : 'Once approved, the customer receives the return instructions for their chosen method.'}
                </div>
              </>
            )}
            {isApproved && !r.keepItem && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="Truck" onClick={() => setShipOpen(true)} disabled={busy}>Mark as Shipped</Btn>
                <Btn variant="secondary" className="w-full mt-2.5" size="lg" icon="PackageCheck" onClick={() => submit({ intent: 'receive' })} disabled={busy}>Mark as Received</Btn>
                <Btn variant="danger-outline" className="w-full mt-2.5" size="md" icon="X" onClick={() => setRejectOpen(true)} disabled={busy}>Cancel return</Btn>
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info/10 border border-info/20 text-[12px] text-info flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>Waiting for the customer ({methodLabel[returnMethod] ?? returnMethod}). They can add their tracking number from the return page.</div>
                </div>
              </>
            )}
            {isShipped && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="PackageCheck" onClick={() => submit({ intent: 'receive' })} disabled={busy}>Mark as Received</Btn>
                {(() => {
                  const url = r.trackingUrl ?? getTrackingUrl(r.carrier, r.trackingNumber);
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-2.5">
                      <Btn variant="secondary" className="w-full" size="lg" icon="ExternalLink">Track live · {getCarrierDisplayName(r.carrier)}</Btn>
                    </a>
                  ) : null;
                })()}
                <div className="mt-3 px-3 py-2.5 rounded-md bg-[#10B981]/10 border border-[#10B981]/20 text-[12px] text-[#10B981] flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>
                    Items in transit. Mark received once they arrive.
                    {getEstimatedTransitLabel(r.carrier) && <div className="text-[11.5px] opacity-80 mt-1">{getEstimatedTransitLabel(r.carrier)}</div>}
                  </div>
                </div>
              </>
            )}
            {canRefund && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon={r.refundType === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign'} onClick={openRefundModal} disabled={busy}>
                  {r.refundType === 'EXCHANGE' ? 'Process Exchange' : 'Issue Refund'}
                </Btn>
                <div className="mt-3 text-[12px] text-muted">
                  {r.keepItem ? 'Green return: refund without waiting for the items.' : r.refundType === 'EXCHANGE' ? 'Items received. Ready to create the replacement order.' : 'Items received and inspected. Ready to refund.'}
                </div>
              </>
            )}
            {isClosed && (
              <div className="px-3 py-3 rounded-md text-[12.5px]" style={{ background: STATUS_STYLES[r.status]?.bg || '#333', color: STATUS_STYLES[r.status]?.text || '#fff' }}>
                This return is {r.status === 'EXPIRED' ? 'expired' : 'closed'}. No further actions available.
              </div>
            )}
          </Card>

          <Card title="Refund Preview">
            <div className="space-y-2 text-[13px]">
              <Row label="Items total" value={formatMoney(itemsTotal, currency)} />
              <Row label="Fees" value={fees > 0 ? `- ${formatMoney(fees, currency)}` : '—'} muted={fees <= 0} />
              {r.storeCreditBonus > 0 && <Row label="Store credit bonus" value={`+ ${formatMoney(r.storeCreditBonus, currency)}`} />}
              <div className="border-t border-divider my-2" />
              <Row label={r.status === 'REFUNDED' ? 'Refunded' : 'Estimated'} value={formatMoney(r.refundAmount || baseRefund, currency)} strong />
              <div className="flex items-center justify-between pt-1.5">
                <span className="text-[12px] text-muted">Customer requested</span>
                {(() => {
                  const m = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-0.5 rounded" style={{ background: m.bg, color: m.color }}>
                      <Icon name={m.icon} size={11} /> {m.label}
                    </span>
                  );
                })()}
              </div>
              {r.exchangeNote && (
                <div className="px-2.5 py-2 rounded-md text-[12px] flex items-start gap-1.5 border" style={{ background: 'rgba(59,130,246,0.06)', color: '#3B82F6', borderColor: 'rgba(59,130,246,0.2)' }}>
                  <Icon name="MessageSquare" size={12} className="mt-0.5 shrink-0" />
                  <div><span className="font-semibold">Customer note: </span>{r.exchangeNote}</div>
                </div>
              )}
              {r.storeCreditCode && <div className="text-[12px] text-muted">{r.storeCreditCode}</div>}
            </div>
          </Card>

          {(r.isOfflinePayment || r.payoutMethod) && (
            <Card title="Refund details (paid on delivery)">
              <div className="space-y-2.5 text-[13px]">
                <Row label="Method" value={r.payoutMethod ? payoutMethodLabel(r.payoutMethod, 'en') : '—'} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Account</span>
                  <span className="text-ink font-mono text-[12.5px] flex items-center gap-2">
                    {r.payoutAccount || '—'}
                    {r.payoutAccount && (
                      <button onClick={() => navigator.clipboard?.writeText(r.payoutAccount!)} className="text-faint hover:text-ink" title="Copy"><Icon name="Copy" size={12} /></button>
                    )}
                  </span>
                </div>
                <Row label="Name" value={r.payoutName || '—'} />
                {r.payoutReference && <Row label="Reference" value={r.payoutReference} />}
                <div className="text-[11.5px] text-faint leading-relaxed">Send the money with your mobile money / bank app, then record it with “Manual payout” in the refund dialog.</div>
              </div>
            </Card>
          )}

          <Card title="Shipping Info">
            <div className="space-y-2.5 text-[13px]">
              <Row label="Return method" value={r.keepItem ? 'Keep item (no return)' : methodLabel[returnMethod] ?? returnMethod} />
              <Row label="Order total" value={formatMoney(r.orderTotal, currency)} />
              {r.carrier && <Row label="Carrier" value={r.carrier} />}
              {r.trackingNumber && <Row label="Tracking" value={r.trackingNumber} />}
              {r.shippedAt && <Row label="Shipped" value={new Date(r.shippedAt).toLocaleDateString()} />}
              {r.labelUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Shipping label</span>
                  <a href={r.labelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent2 hover:underline text-[12.5px] font-medium"><Icon name="Download" size={13} /> Download</a>
                </div>
              )}
              {r.exchangeOrderUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Exchange order</span>
                  <a href={r.exchangeOrderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#10B981] hover:underline text-[12.5px] font-medium"><Icon name="ExternalLink" size={13} /> View invoice</a>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* APPROVE */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Approve this return?"
        footer={<>
          <Btn variant="ghost" onClick={() => setApproveOpen(false)}>Cancel</Btn>
          <Btn variant="ok" icon="Check" disabled={busy} onClick={() => submit({ intent: 'approve', carrier, trackingNumber, labelUrl: providingLabel ? labelUrl : '' })}>Approve & notify</Btn>
        </>}>
        <div className="space-y-4">
          <div className="text-[13px] text-muted leading-relaxed">
            {r.keepItem
              ? 'This is a green return: the customer keeps the item. After approval you can refund immediately.'
              : `The customer will receive the instructions for “${methodLabel[returnMethod] ?? returnMethod}” (return address, store, pickup or label).`}
          </div>
          {!r.keepItem && (
            <div className="p-3 rounded-md bg-bg/40 border border-divider">
              <Toggle checked={providingLabel} onChange={setProvidingLabel} label="Attach a prepaid return label" description="Paste the label link generated with your carrier (e.g. DHL, Shippo, Sendcloud)." />
              {providingLabel && (
                <div className="mt-3 pl-12 space-y-3 animate-fadeIn">
                  <div>
                    <label className="text-[12px] font-medium text-muted block mb-1.5">Prepaid label URL (https)</label>
                    <Input value={labelUrl} onChange={(e: any) => setLabelUrl(e.target.value)} placeholder="https://..." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <CarrierField value={carrier} onChange={setCarrier} />
                    <div>
                      <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking number</label>
                      <Input value={trackingNumber} onChange={(e: any) => setTrackingNumber(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* REJECT */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={isApproved ? 'Cancel this return?' : 'Reject this return?'}
        footer={<>
          <Btn variant="ghost" onClick={() => setRejectOpen(false)}>Back</Btn>
          <Btn variant="danger" icon="X" disabled={!rejectReason.trim() || busy} onClick={() => submit({ intent: 'reject', reason: rejectReason })}>Reject & notify</Btn>
        </>}>
        <div className="text-[13px] text-muted leading-relaxed mb-3">The customer will be emailed that their return can't be accepted, with your reason.</div>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Reason</label>
        <Textarea value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} rows={4} placeholder="e.g. Outside the return window; items show signs of wear." />
      </Modal>

      {/* SHIPPED */}
      <Modal open={shipOpen} onClose={() => setShipOpen(false)} title="Mark as shipped"
        footer={<>
          <Btn variant="ghost" onClick={() => setShipOpen(false)}>Cancel</Btn>
          <Btn variant="primary" icon="Truck" disabled={busy} onClick={() => submit({ intent: 'ship', carrier: shipCarrier, trackingNumber: shipTracking })}>Confirm shipped</Btn>
        </>}>
        <div className="space-y-4">
          <div className="text-[13px] text-muted leading-relaxed">Confirm that the customer has shipped the items back. Add tracking info if available.</div>
          <div className="grid grid-cols-2 gap-3">
            <CarrierField value={shipCarrier} onChange={setShipCarrier} />
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking number</label>
              <Input value={shipTracking} onChange={(e: any) => setShipTracking(e.target.value)} placeholder="e.g. 9400..." />
            </div>
          </div>
        </div>
      </Modal>

      {/* REFUND */}
      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title={refundMethod === 'EXCHANGE' ? 'Process exchange' : 'Process refund'} width="max-w-lg"
        footer={<>
          <Btn variant="ghost" onClick={() => setRefundOpen(false)}>Cancel</Btn>
          <Btn variant="primary" icon={refundMethod === 'EXCHANGE' ? 'RefreshCw' : 'DollarSign'} onClick={handleRefund} disabled={refundDisabled} loading={busy}>
            {refundMethod === 'EXCHANGE' ? 'Create exchange order' : refundMethod === 'MANUAL' ? 'Record payout' : 'Confirm refund'}
          </Btn>
        </>}>
        <div className="space-y-4">
          {onboardingIncomplete && (
            <Link to={`/app/onboarding${location.search}`} className="flex items-start gap-2.5 px-3 py-2.5 rounded-md border transition hover:bg-warn/15" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)' }}>
              <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
              <div className="flex-1 text-[12.5px] text-muted">Setup incomplete (missing: {(onboardingMissing || []).join(', ')}). <span className="font-semibold text-accent2">Finish setup →</span></div>
            </Link>
          )}

          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold mb-1.5">Method</div>
            <div className="grid grid-cols-3 gap-2">
              {refundMethods.map((m) => {
                const sel = refundMethod === m.key;
                return (
                  <button key={m.key} type="button" disabled={!m.available}
                    onClick={() => setRefundMethod(m.key)}
                    className={`text-left p-2.5 rounded-md border-2 transition disabled:opacity-40 disabled:cursor-not-allowed ${sel ? 'border-accent bg-accent/10' : 'border-divider hover:border-[#3a3e58]'}`}>
                    <div className="flex items-center justify-between">
                      <Icon name={m.icon} size={14} style={{ color: m.color }} />
                      {!m.available && <TierBadge tier="starter" />}
                    </div>
                    <div className="text-[12px] font-semibold text-ink mt-1.5">{m.label}</div>
                    {m.hint && <div className="text-[10.5px] text-warn mt-0.5">{m.hint}</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {refundMethod === 'ORIGINAL_PAYMENT' && r.isOfflinePayment && (
            <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', color: '#F59E0B' }}>
              <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
              <div className="text-ink leading-relaxed">This order was paid on delivery / offline: Shopify can't send money back. Use <strong>Manual payout</strong> after sending the refund yourself.</div>
            </div>
          )}

          {refundMethod !== 'EXCHANGE' && (
            <div>
              <label className="text-[10.5px] uppercase tracking-wider text-faint font-semibold block mb-1.5">
                {refundMethod === 'STORE_CREDIT' ? 'Credit amount' : refundMethod === 'GIFT_CARD' ? 'Gift card value' : 'Refund amount'}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[13px] tabular-nums">{currencySymbol(currency)}</span>
                <input value={refundAmountStr} onChange={(e) => setRefundAmountStr(e.target.value)} inputMode="decimal"
                  className={`w-full h-10 pl-14 pr-3 text-[15px] rounded-md bg-bg border ${refundExceedsMax ? 'border-danger ring-2 ring-danger/20' : 'border-border focus:border-accent focus:ring-2 focus:ring-accent/20'} text-ink font-semibold tabular-nums focus:outline-none`} />
              </div>
              <div className="text-[11.5px] text-muted mt-1.5 flex items-center gap-1.5">
                <Icon name="Info" size={11} />
                {refundMethod === 'ORIGINAL_PAYMENT'
                  ? `${formatMoney(maxRefundable, currency)} available on the original payment`
                  : `Items ${formatMoney(itemsTotal, currency)}${fees > 0 ? ` − fees ${formatMoney(fees, currency)}` : ''}${(refundMethod === 'STORE_CREDIT' || refundMethod === 'GIFT_CARD') && r.settings.incentivizeStoreCredit && bonusPct > 0 ? ` + ${bonusPct}% bonus` : ''}`}
              </div>
              {refundExceedsMax && <div className="text-[11.5px] text-danger mt-1">Amount exceeds the refundable balance.</div>}
            </div>
          )}

          {refundMethod === 'MANUAL' && (
            <div className="space-y-3 p-3 rounded-md border border-divider bg-bg/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted block mb-1.5">Paid via</label>
                  <Select value={payoutMethod} onChange={setPayoutMethod} options={PAYOUT_METHODS.map((p) => ({ value: p.key, label: p.label.en }))} />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted block mb-1.5">Transaction reference</label>
                  <Input value={payoutReference} onChange={(e: any) => setPayoutReference(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted block mb-1.5">Account / phone</label>
                  <Input value={payoutAccount} onChange={(e: any) => setPayoutAccount(e.target.value)} placeholder={maskAccount(r.payoutAccount) || '—'} />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted block mb-1.5">Account holder</label>
                  <Input value={payoutName} onChange={(e: any) => setPayoutName(e.target.value)} />
                </div>
              </div>
              <div className="text-[11.5px] text-muted leading-relaxed">Records the payout you sent outside Shopify, restocks the items and emails the customer with the reference.</div>
            </div>
          )}

          {refundMethod === 'GIFT_CARD' && (
            <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2.5" style={{ background: 'rgba(236,72,153,0.08)' }}>
              <Icon name="Ticket" size={14} className="mt-0.5 shrink-0" style={{ color: '#EC4899' }} />
              <div className="leading-relaxed text-ink">A Shopify gift card is created and its code is emailed to <strong>{r.customerEmail}</strong>. Works even for guest checkouts.</div>
            </div>
          )}
          {refundMethod === 'STORE_CREDIT' && (
            <div className="p-3 rounded-md text-[12.5px] flex items-start gap-2.5" style={{ background: 'rgba(139,133,255,0.08)' }}>
              <Icon name="Gift" size={14} className="mt-0.5 shrink-0" style={{ color: '#8B85FF' }} />
              <div className="leading-relaxed text-ink">Store credit is added to the customer's Shopify account{r.settings.storeCreditMethod !== 'store_credit' ? ' (a gift card is created instead if the order has no customer account)' : ''}.</div>
            </div>
          )}

          {refundMethod === 'EXCHANGE' && (
            <div className="space-y-3">
              {hasCustomerExchange && (
                <div className="p-3 rounded-md border border-divider">
                  <Toggle checked={useCustomerChoice} onChange={setUseCustomerChoice} label="Use the replacements chosen by the customer"
                    description={r.items.filter((it: any) => it.exchangeVariantId).map((it: any) => `${it.exchangeProductTitle} — ${it.exchangeVariantTitle} ×${it.quantity}`).join(', ')} />
                </div>
              )}
              {(!hasCustomerExchange || !useCustomerChoice) && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10.5px] uppercase tracking-wider text-faint font-semibold block mb-1.5">Replacement item</label>
                    <ProductPicker value={exchangeVariant} onChange={setExchangeVariant} currency={currency} />
                  </div>
                  {exchangeVariant && (
                    <div className="flex items-center gap-3">
                      <label className="text-[12.5px] text-muted shrink-0">Quantity</label>
                      <input type="number" min={1} value={exchangeQty} onChange={(e) => setExchangeQty(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
                        className="w-16 h-8 px-2 text-[13px] rounded-md bg-bg border border-border text-ink text-center tabular-nums focus:outline-none focus:border-accent" />
                    </div>
                  )}
                </div>
              )}
              {exchangeLines.length > 0 && (
                <div className="rounded-md border border-divider bg-bg/30 p-3 space-y-1.5 text-[13px]">
                  <Row label="Replacement" value={formatMoney(replacementTotal, currency)} />
                  <Row label="Returned credit" value={`- ${formatMoney(baseRefund, currency)}`} muted />
                  <div className="pt-1.5 mt-1.5 border-t border-divider flex items-center justify-between font-semibold">
                    {exchangeDiff > 0.001 ? (<><span className="text-ink">Customer pays</span><span className="text-[#F59E0B] tabular-nums">{formatMoney(exchangeDiff, currency)}</span></>)
                      : exchangeDiff < -0.001 ? (<><span className="text-ink">Difference to settle</span><span className="text-[#22C55E] tabular-nums">{formatMoney(-exchangeDiff, currency)}</span></>)
                      : (<><span className="text-ink">Even exchange</span><span className="text-muted">—</span></>)}
                  </div>
                </div>
              )}
              {exchangeDiff < -0.001 && exchangeLines.length > 0 && (
                <div className="rounded-md border border-divider p-3 space-y-2">
                  <div className="text-[12.5px] text-ink font-semibold">Settle the difference</div>
                  {([
                    ['REFUND_DIFFERENCE', 'Refund to original payment'],
                    ['STORE_CREDIT_DIFFERENCE', 'Issue store credit'],
                    ['NONE', 'No settlement'],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer text-[12.5px] text-ink">
                      <input type="radio" checked={diffSettlement === k} onChange={() => setDiffSettlement(k)} /> {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums text-right ${strong ? 'text-ink font-semibold text-[15px]' : muted ? 'text-faint' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

/** Supported carriers + "Other" (free text, no tracking deep-link). */
function CarrierField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const presetValues = CARRIER_OPTIONS.map(o => o.value).filter(v => v !== OTHER_CARRIER);
  const isPreset = !!value && presetValues.includes(value);
  const [otherMode, setOtherMode] = useState(!!value && !isPreset);
  const dropdownValue = otherMode ? OTHER_CARRIER : (isPreset ? value : '');
  return (
    <div>
      <label className="text-[12px] font-medium text-muted block mb-1.5">Carrier</label>
      <Select
        value={dropdownValue}
        onChange={(v: string) => {
          if (v === OTHER_CARRIER) { setOtherMode(true); onChange(''); }
          else { setOtherMode(false); onChange(v); }
        }}
        options={[{ value: '', label: 'Select a carrier…' }, ...CARRIER_OPTIONS]}
      />
      {otherMode && <Input value={value} onChange={(e: any) => onChange(e.target.value)} placeholder="Carrier name" className="mt-2" />}
    </div>
  );
}
