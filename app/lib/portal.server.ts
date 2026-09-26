/**
 * Customer portal — server side. Everything the (public, unauthenticated)
 * portal can do goes through here:
 *
 *   lookupOrder  → verifies order number + email, computes per-item
 *                  eligibility, issues a signed order token
 *   submitReturn → re-reads the order from Shopify and re-validates EVERY
 *                  field (items, quantities, prices, reasons, photos,
 *                  replacements, payout details). Nothing coming from the
 *                  browser is trusted.
 *   withdrawal, status page, customer tracking, exchange options, photos.
 */
import type { ReturnReason, ShopSettings } from "@prisma/client";
import prisma from "../db.server";
import { belongsToShop, cloudinaryConfigured, isAcceptableImageDataUrl, shopFolder, uploadToCloudinary } from "./cloudinary.server";
import { getTrackingUrl } from "./carriers";
import {
  PAYOUT_METHODS,
  parseLocales,
  parsePortalTexts,
  pickLocale,
  normalizeLocale,
  resolvePortalTexts,
  type Locale,
  type PayoutMethodKey,
  type PortalDictionary,
} from "./i18n";
import { realReturnAddress } from "./notifications.server";
import { getQuota, getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";
import type { ExchangeOption, FindOrderResponse, PortalConfig, PortalLine, PortalOrderDTO, PortalView, StatusView } from "./portal-types";
import {
  computeTotals,
  evaluateLine,
  getReturnMethods,
  isGreenReturn,
  isValidEmail,
  normalizeOrderNumber,
  parseList,
  type EligibilitySettings,
  type ReturnMethodKey,
} from "./returns-logic";
import { createReturnRequest, getOfflineAdmin, transitionStatus, type AdminClient } from "./returns-service.server";
import {
  fetchOrderById,
  fetchProductVariants,
  fetchReturnableQuantities,
  fetchVariant,
  findOrderForPortal,
  searchProductsForExchange,
  type PortalOrder,
} from "./shopify-queries.server";
import { signChatToken, signOrderToken, signStatusToken, verifyOrderToken, verifyStatusToken } from "./tokens.server";

type Settings = ShopSettings & { reasons: ReturnReason[] };
export type PortalError = { error: keyof PortalDictionary };

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function sanitizeShop(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  return SHOP_RE.test(v) ? v : null;
}

export async function loadPortalContext(shop: string): Promise<{ settings: Settings; plan: string } | null> {
  const settings = await prisma.shopSettings.findUnique({ where: { shop }, include: { reasons: true } });
  if (!settings) return null;
  const plan = await getShopPlan(shop);
  return { settings, plan };
}

function eligibilitySettings(s: ShopSettings): EligibilitySettings {
  return {
    returnWindow: s.returnWindow,
    returnWindowBasis: s.returnWindowBasis,
    blockedSkus: s.blockedSkus,
    blockedTags: s.blockedTags,
    blockedProductTypes: s.blockedProductTypes,
    blockDiscountedItems: s.blockDiscountedItems,
    oneReturnPerOrder: s.oneReturnPerOrder,
  };
}

function enabledPayoutMethods(s: ShopSettings): PayoutMethodKey[] {
  const allowed = new Set<string>(PAYOUT_METHODS.map((p) => p.key));
  const list = parseList(s.payoutMethods).filter((k) => allowed.has(k)) as PayoutMethodKey[];
  return list.length ? list : ["bank_transfer", "cash"];
}

function isBlockedEmail(s: ShopSettings, email: string): boolean {
  const e = email.toLowerCase();
  return parseList(s.blockedEmails)
    .map((b) => b.toLowerCase())
    .some((b) => (b.startsWith("@") ? e.endsWith(b) : b === e));
}

// ─── Config (loader) ────────────────────────────────────────────────────────

export function buildPortalConfig(args: {
  shop: string;
  settings: Settings | null;
  plan: string;
  currency: string;
  request: Request;
  view: PortalView;
  initialStatus?: StatusView | null;
  embed: boolean;
}): PortalConfig {
  const s = args.settings;
  const url = new URL(args.request.url);
  const enabled = parseLocales(s?.portalLocales ?? "en,fr");
  const fallback = normalizeLocale(s?.defaultLocale) ?? "en";
  const locale = pickLocale({
    requested: url.searchParams.get("lang"),
    acceptLanguage: args.request.headers.get("accept-language"),
    enabled,
    fallback,
  });
  const whiteLabel = hasFeature(args.plan, "whiteLabel");
  const texts = resolvePortalTexts({
    locale,
    defaultLocale: fallback,
    legacy: s
      ? {
          labelFindOrder: s.labelFindOrder,
          descFindOrder: s.descFindOrder,
          labelCta: s.labelCta,
          labelSelectItems: s.labelSelectItems,
          descSelectItems: s.descSelectItems,
          labelReasons: s.labelReasons,
          descReasons: s.descReasons,
          labelRefundType: s.labelRefundType,
          descRefundType: s.descRefundType,
          labelConfirm: s.labelConfirm,
          descConfirm: s.descConfirm,
          labelSubmit: s.labelSubmit,
          labelBackToStore: s.labelBackToStore,
          labelCantFind: s.labelCantFind,
          labelStartAnother: s.labelStartAnother,
          labelTrackingToggle: s.labelTrackingToggle,
          labelPoweredBy: s.labelPoweredBy,
        }
      : undefined,
    overrides: parsePortalTexts(s?.portalTexts),
    whiteLabel,
  });

  const plan = args.plan;
  const reasons = (s?.reasons ?? [])
    .filter((r) => r.enabled)
    .map((r) => ({ label: r.label, requirePhoto: hasFeature(plan, "photos") && r.requirePhoto }));
  const supportEmail =
    s?.footerContact?.trim() || (s?.fromEmail && s.fromEmail !== "returns@acmestore.com" ? s.fromEmail : "");

  return {
    shop: args.shop,
    storeName: s?.portalStoreName || args.shop.split(".")[0],
    locale,
    locales: enabled,
    texts,
    currency: args.currency,
    embed: args.embed,
    layout: s?.portalLayout || "classic",
    brandColor: s?.brandColor || "#6C63FF",
    bannerColor: s?.bannerColor || "#ffffff",
    logoUrl: s?.logoUrl || null,
    supportEmail,
    storeUrl: `https://${args.shop}`,
    policy: s?.returnPolicy ?? "",
    reasons,
    refundOptions: {
      storeCredit: !!s?.allowStoreCredit && hasFeature(plan, "storeCredit"),
      exchange: !!s?.allowExchanges && hasFeature(plan, "variantExchange"),
      shopNow: !!s?.allowShopNow && hasFeature(plan, "shopNow"),
    },
    bonus: {
      enabled: !!s?.incentivizeStoreCredit && hasFeature(plan, "storeCredit"),
      percent: s?.storeCreditBonusPercent ?? 0,
    },
    fees: {
      enabled: hasFeature(plan, "returnFees"),
      restockingFeePercent: s?.restockingFeePercent ?? 0,
      returnShippingFee: s?.returnShippingFee ?? 0,
      feeWaivedForStoreCredit: s?.feeWaivedForStoreCredit ?? true,
      feeWaivedForExchange: s?.feeWaivedForExchange ?? true,
      feeExemptReasons: s?.feeExemptReasons ?? "",
      storeCreditBonusPercent: s?.storeCreditBonusPercent ?? 0,
      incentivizeStoreCredit: !!s?.incentivizeStoreCredit,
    },
    green: {
      enabled: !!s?.greenReturnsEnabled && hasFeature(plan, "greenReturns"),
      maxAmount: s?.greenReturnMaxAmount ?? 0,
    },
    photos: { enabled: hasFeature(plan, "photos") && (!!s?.photosEnabled || reasons.some((r) => r.requirePhoto)) },
    returnMethods: s ? getReturnMethods(s) : ["ship"],
    returnAddress: realReturnAddress(s?.returnAddress),
    storeDropoffInfo: s?.storeDropoffInfo ?? "",
    pickupInfo: s?.pickupInfo ?? "",
    cod: { enabled: s?.codRefundsEnabled ?? true, methods: s ? enabledPayoutMethods(s) : ["bank_transfer"] },
    withdrawal: !!s?.euWithdrawalEnabled,
    chat: { enabled: !!s?.liveChatEnabled && hasFeature(plan, "liveChat"), icon: s?.liveChatIcon || "MessageCircle" },
    whatsapp: {
      number: hasFeature(plan, "whatsapp") && s?.whatsappNumber ? s.whatsappNumber : null,
      optIn: hasFeature(plan, "whatsapp") && !!s?.whatsappNotifyEnabled,
    },
    poweredBy: texts.labelPoweredBy,
    initialView: args.view,
    initialStatus: args.initialStatus ?? null,
    unavailable: !s,
  };
}

// ─── Order lookup ───────────────────────────────────────────────────────────

interface EvaluatedOrder {
  order: PortalOrder;
  lines: PortalLine[];
}

async function evaluateOrder(
  shop: string,
  settings: Settings,
  admin: AdminClient,
  order: PortalOrder,
  mode: "return" | "withdrawal",
): Promise<EvaluatedOrder> {
  const [info, localRequests] = await Promise.all([
    fetchReturnableQuantities(admin, order.id),
    prisma.returnRequest.findMany({
      where: { shop, orderId: order.id, status: { notIn: ["REJECTED", "EXPIRED"] } },
      select: { shopifyReturnId: true, items: { select: { lineItemId: true, quantity: true } } },
    }),
  ]);
  const locked = new Map<string, number>();
  for (const r of localRequests) {
    if (r.shopifyReturnId) continue; // already reflected in Shopify's returnable quantities
    for (const it of r.items) {
      if (!it.lineItemId) continue;
      locked.set(it.lineItemId, (locked.get(it.lineItemId) ?? 0) + it.quantity);
    }
  }
  const eligibility = eligibilitySettings(settings);
  const lines: PortalLine[] = order.lines.map((l) => {
    const fulfilledQty = Math.max(0, l.quantity - l.unfulfilledQuantity);
    const returnable = info.ok ? info.quantities.get(l.id) ?? 0 : fulfilledQty;
    const res = evaluateLine(
      {
        productId: l.productId ?? "",
        variantId: l.variantId,
        sku: l.sku,
        productTags: l.productTags,
        productType: l.productType,
        isDiscounted: l.originalUnitPrice > 0 && l.unitPrice < l.originalUnitPrice - 0.001,
        returnableQty: returnable,
        unfulfilledQty: l.unfulfilledQuantity,
        lockedQty: locked.get(l.id) ?? 0,
        fulfilledAt: info.fulfilledAt.get(l.id) ?? (fulfilledQty > 0 ? order.createdAt : null),
        deliveredAt: info.deliveredAt.get(l.id) ?? null,
      },
      { settings: eligibility, orderCreatedAt: order.createdAt, hasOpenReturnOnOrder: localRequests.length > 0, mode },
    );
    return {
      id: l.id,
      title: l.title,
      variantTitle: l.variantTitle,
      image: l.image,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      productId: l.productId ?? "",
      variantId: l.variantId ?? "",
      eligible: res.eligible,
      maxQty: res.maxQty,
      reason: res.reason,
      deadline: res.deadline,
    };
  });
  return { order, lines };
}

function toDTO(e: EvaluatedOrder): PortalOrderDTO {
  return {
    id: e.order.id,
    name: e.order.name,
    createdAt: e.order.createdAt,
    customerName: e.order.customerName,
    email: e.order.email,
    phone: e.order.phone,
    isOfflinePayment: e.order.isOfflinePayment,
    lines: e.lines,
  };
}

export async function lookupOrder(args: {
  shop: string;
  settings: Settings;
  plan: string;
  orderNumber: string;
  email: string;
  mode: "return" | "withdrawal";
}): Promise<FindOrderResponse> {
  const email = args.email.trim().toLowerCase();
  if (!isValidEmail(email)) return { error: "errInvalidEmail" };
  const num = normalizeOrderNumber(args.orderNumber);
  if (!num) return { error: "errOrderNotFound" };

  if (hasFeature(args.plan, "fraud") && isBlockedEmail(args.settings, email)) return { error: "errBlocked" };

  const admin = await getOfflineAdmin(args.shop);
  if (!admin) return { error: "errUnavailable" };

  const order = await findOrderForPortal(admin, num, email);
  if (!order) return { error: "errOrderNotFound" };

  if (args.mode === "return") {
    if (order.displayFulfillmentStatus === "UNFULFILLED") return { error: "errNotShipped" };
    const quota = await getQuota(args.shop, args.plan);
    if (quota.reached) return { error: "errQuota" };
  }

  const evaluated = await evaluateOrder(args.shop, args.settings, admin, order, args.mode);
  return {
    order: toDTO(evaluated),
    token: signOrderToken({ shop: args.shop, orderId: order.id, email, mode: args.mode }),
    chatToken: signChatToken({ shop: args.shop, email, verified: true, since: 0 }),
  };
}

// ─── Exchange options & photos ──────────────────────────────────────────────

export async function exchangeOptions(args: {
  shop: string;
  plan: string;
  settings: Settings;
  token: string;
  productIds: string[];
}): Promise<{ options?: Record<string, ExchangeOption[]>; error?: keyof PortalDictionary }> {
  const t = verifyOrderToken(args.token);
  if (!t || t.shop !== args.shop) return { error: "errSession" };
  if (!args.settings.allowExchanges || !hasFeature(args.plan, "variantExchange")) return { options: {} };
  const admin = await getOfflineAdmin(args.shop);
  if (!admin) return { error: "errUnavailable" };
  const unique = Array.from(new Set(args.productIds.filter((p) => /^gid:\/\/shopify\/Product\/\d+$/.test(p)))).slice(0, 20);
  const out: Record<string, ExchangeOption[]> = {};
  await Promise.all(
    unique.map(async (pid) => {
      const variants = await fetchProductVariants(admin, pid);
      out[pid] = variants.map((v) => ({
        id: v.id,
        title: v.title,
        productTitle: v.productTitle,
        productId: v.productId,
        price: v.price,
        available: v.available,
        image: v.image,
      }));
    }),
  );
  return { options: out };
}

export async function shopNowSearch(args: {
  shop: string;
  plan: string;
  settings: Settings;
  token: string;
  q: string;
}): Promise<{ results?: ExchangeOption[]; error?: keyof PortalDictionary }> {
  const t = verifyOrderToken(args.token);
  if (!t || t.shop !== args.shop) return { error: "errSession" };
  if (!args.settings.allowShopNow || !hasFeature(args.plan, "shopNow")) return { results: [] };
  const admin = await getOfflineAdmin(args.shop);
  if (!admin) return { error: "errUnavailable" };
  const variants = await searchProductsForExchange(admin, args.q);
  return {
    results: variants.slice(0, 40).map((v) => ({
      id: v.id,
      title: v.title,
      productTitle: v.productTitle,
      productId: v.productId,
      price: v.price,
      available: v.available,
      image: v.image,
    })),
  };
}

export async function uploadReturnPhoto(args: {
  shop: string;
  plan: string;
  token: string;
  dataUrl: string;
}): Promise<{ url?: string; error?: keyof PortalDictionary }> {
  const t = verifyOrderToken(args.token);
  if (!t || t.shop !== args.shop) return { error: "errSession" };
  if (!hasFeature(args.plan, "photos") || !cloudinaryConfigured()) return { error: "photoError" };
  if (!isAcceptableImageDataUrl(args.dataUrl)) return { error: "photoError" };
  try {
    const { url } = await uploadToCloudinary(args.dataUrl, shopFolder(args.shop, "returns"));
    return { url };
  } catch (e) {
    console.error("[portal] photo upload failed:", e);
    return { error: "photoError" };
  }
}

// ─── Submission ─────────────────────────────────────────────────────────────

export interface SubmitBody {
  token: string;
  locale?: string;
  refundType: "ORIGINAL_PAYMENT" | "STORE_CREDIT" | "EXCHANGE" | "SHOP_NOW";
  returnMethod?: string;
  lines: Array<{
    lineItemId: string;
    qty: number;
    reason: string;
    note?: string;
    photos?: string[];
    exchangeVariantId?: string | null;
  }>;
  payout?: { method?: string; account?: string; name?: string } | null;
  phone?: string;
  whatsappOptIn?: boolean;
  exchangeNote?: string;
}

export async function submitReturn(args: {
  shop: string;
  settings: Settings;
  plan: string;
  body: SubmitBody;
}): Promise<{ rma?: string; keepItem?: boolean; view?: StatusView; error?: keyof PortalDictionary }> {
  const { shop, settings, plan, body } = args;
  const t = verifyOrderToken(body.token);
  if (!t || t.shop !== shop || t.mode !== "return") return { error: "errSession" };

  const quota = await getQuota(shop, plan);
  if (quota.reached) return { error: "errQuota" };
  if (hasFeature(plan, "fraud") && isBlockedEmail(settings, t.email)) return { error: "errBlocked" };

  const admin = await getOfflineAdmin(shop);
  if (!admin) return { error: "errUnavailable" };
  const order = await fetchOrderById(admin, t.orderId);
  if (!order || order.email.trim().toLowerCase() !== t.email) return { error: "errSession" };

  const evaluated = await evaluateOrder(shop, settings, admin, order, "return");
  const byId = new Map(evaluated.lines.map((l) => [l.id, l]));
  const orderLineById = new Map(order.lines.map((l) => [l.id, l]));

  // Refund type allowed?
  const wantsShopNow = body.refundType === "SHOP_NOW";
  const refundType: "ORIGINAL_PAYMENT" | "STORE_CREDIT" | "EXCHANGE" =
    body.refundType === "STORE_CREDIT" ? "STORE_CREDIT" : body.refundType === "EXCHANGE" || wantsShopNow ? "EXCHANGE" : "ORIGINAL_PAYMENT";
  if (refundType === "STORE_CREDIT" && !(settings.allowStoreCredit && hasFeature(plan, "storeCredit"))) return { error: "errGeneric" };
  if (refundType === "EXCHANGE" && !wantsShopNow && !(settings.allowExchanges && hasFeature(plan, "variantExchange"))) return { error: "errGeneric" };
  if (wantsShopNow && !(settings.allowShopNow && hasFeature(plan, "shopNow"))) return { error: "errGeneric" };

  // Reasons & photos
  const reasons = settings.reasons.filter((r) => r.enabled);
  const photosAllowed = hasFeature(plan, "photos");

  const seen = new Set<string>();
  const lines: Parameters<typeof createReturnRequest>[0]["lines"] = [];
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 50) return { error: "errItems" };
  for (const req of body.lines) {
    if (!req || typeof req.lineItemId !== "string" || seen.has(req.lineItemId)) return { error: "errItems" };
    seen.add(req.lineItemId);
    const ev = byId.get(req.lineItemId);
    const ol = orderLineById.get(req.lineItemId);
    const qty = Math.floor(Number(req.qty));
    if (!ev || !ol || !ev.eligible || !(qty >= 1) || qty > ev.maxQty) return { error: "errItems" };

    const reason = String(req.reason ?? "").trim().slice(0, 120);
    const reasonDef = reasons.find((r) => r.label === reason);
    if (!reason || (reasons.length > 0 && !reasonDef)) return { error: "errItems" };

    const photos = (Array.isArray(req.photos) ? req.photos : [])
      .filter((u) => typeof u === "string" && belongsToShop(u, shop))
      .slice(0, 3);
    if (photosAllowed && reasonDef?.requirePhoto && photos.length === 0) return { error: "errPhotoRequired" };

    let exchange: { variantId: string; productTitle: string; variantTitle: string; price: number } | null = null;
    if (refundType === "EXCHANGE") {
      if (!req.exchangeVariantId) return { error: "errItems" };
      const v = await fetchVariant(admin, req.exchangeVariantId);
      if (!v || !v.available) return { error: "errItems" };
      if (!wantsShopNow && (v.productId !== ol.productId || v.id === ol.variantId)) return { error: "errItems" };
      exchange = { variantId: v.id, productTitle: v.productTitle, variantTitle: v.title, price: v.price };
    }

    lines.push({
      lineItemId: ol.id,
      productId: ol.productId ?? "",
      variantId: ol.variantId ?? "",
      sku: ol.sku,
      name: ol.title,
      variantName: ol.variantTitle,
      image: ol.image,
      unitPrice: ol.unitPrice,
      qty,
      reason,
      note: String(req.note ?? "").slice(0, 1000),
      photos: photosAllowed ? photos : [],
      exchange,
    });
  }

  // Return method
  const methods = getReturnMethods(settings);
  const returnMethod = (methods.includes(body.returnMethod as ReturnMethodKey) ? body.returnMethod : methods[0]) as ReturnMethodKey;

  // Payout details (cash on delivery refunds)
  let payout: { method: string; account: string; name: string } | null = null;
  if (order.isOfflinePayment && refundType === "ORIGINAL_PAYMENT" && settings.codRefundsEnabled) {
    const allowed = enabledPayoutMethods(settings);
    const method = String(body.payout?.method ?? "");
    if (!allowed.includes(method as PayoutMethodKey)) return { error: "errPayout" };
    const account = String(body.payout?.account ?? "").trim().slice(0, 120);
    const name = String(body.payout?.name ?? "").trim().slice(0, 120);
    if (method !== "cash" && (!account || !name)) return { error: "errPayout" };
    payout = { method, account, name };
  }

  // Totals — always server-side
  const feeSettings = {
    restockingFeePercent: settings.restockingFeePercent,
    returnShippingFee: settings.returnShippingFee,
    feeWaivedForStoreCredit: settings.feeWaivedForStoreCredit,
    feeWaivedForExchange: settings.feeWaivedForExchange,
    feeExemptReasons: settings.feeExemptReasons,
    storeCreditBonusPercent: settings.storeCreditBonusPercent,
    incentivizeStoreCredit: settings.incentivizeStoreCredit,
  };
  const totalsInput = {
    lines: lines.map((l) => ({ price: l.unitPrice, qty: l.qty, reason: l.reason })),
    refundType,
    returnMethod,
    settings: feeSettings,
    feesEnabled: hasFeature(plan, "returnFees"),
    bonusEnabled: hasFeature(plan, "storeCredit"),
  };
  let totals = computeTotals(totalsInput);
  const keepItem =
    refundType !== "EXCHANGE" &&
    isGreenReturn({
      enabled: settings.greenReturnsEnabled && hasFeature(plan, "greenReturns"),
      maxAmount: settings.greenReturnMaxAmount,
      itemsTotal: totals.itemsTotal,
    });
  if (keepItem) totals = computeTotals({ ...totalsInput, keepItem: true });

  const locale = (normalizeLocale(body.locale) ?? normalizeLocale(settings.defaultLocale) ?? "en") as Locale;
  const phone = String(body.phone ?? "").replace(/[^\d+\s()-]/g, "").slice(0, 30) || null;

  const created = await createReturnRequest({
    admin,
    shop,
    plan,
    settings,
    order,
    requestType: "RETURN",
    locale,
    lines,
    refundType,
    returnMethod,
    totals,
    keepItem,
    payout,
    phone,
    whatsappOptIn: !!body.whatsappOptIn,
    exchangeNote: String(body.exchangeNote ?? "").slice(0, 500) || null,
  });

  const view = await getStatusView(shop, created.rma);
  return { rma: created.rma, keepItem, view: view ?? undefined };
}

export async function submitWithdrawal(args: {
  shop: string;
  settings: Settings;
  plan: string;
  body: { token: string; locale?: string; lines: Array<{ lineItemId: string; qty: number }>; name?: string; comment?: string };
}): Promise<{ rma?: string; receivedAt?: string; view?: StatusView; error?: keyof PortalDictionary }> {
  const { shop, settings, plan, body } = args;
  if (!settings.euWithdrawalEnabled) return { error: "errUnavailable" };
  const t = verifyOrderToken(body.token);
  if (!t || t.shop !== shop || t.mode !== "withdrawal") return { error: "errSession" };

  const admin = await getOfflineAdmin(shop);
  if (!admin) return { error: "errUnavailable" };
  const order = await fetchOrderById(admin, t.orderId);
  if (!order || order.email.trim().toLowerCase() !== t.email) return { error: "errSession" };

  const evaluated = await evaluateOrder(shop, settings, admin, order, "withdrawal");
  const byId = new Map(evaluated.lines.map((l) => [l.id, l]));
  const orderLineById = new Map(order.lines.map((l) => [l.id, l]));
  const requested = Array.isArray(body.lines) && body.lines.length > 0
    ? body.lines
    : evaluated.lines.filter((l) => l.eligible).map((l) => ({ lineItemId: l.id, qty: l.maxQty }));

  const reasonLabel = settings.defaultLocale === "fr" ? "Droit de rétractation (UE)" : "EU right of withdrawal";
  const lines: Parameters<typeof createReturnRequest>[0]["lines"] = [];
  for (const req of requested) {
    const ev = byId.get(req.lineItemId);
    const ol = orderLineById.get(req.lineItemId);
    const qty = Math.floor(Number(req.qty));
    if (!ev || !ol || !ev.eligible || !(qty >= 1) || qty > ev.maxQty) return { error: "withdrawNotEligible" };
    lines.push({
      lineItemId: ol.id,
      productId: ol.productId ?? "",
      variantId: ol.variantId ?? "",
      sku: ol.sku,
      name: ol.title,
      variantName: ol.variantTitle,
      image: ol.image,
      unitPrice: ol.unitPrice,
      qty,
      reason: reasonLabel,
      note: String(body.comment ?? "").slice(0, 1000),
    });
  }
  if (lines.length === 0) return { error: "withdrawNotEligible" };

  const totals = computeTotals({
    lines: lines.map((l) => ({ price: l.unitPrice, qty: l.qty, reason: l.reason })),
    refundType: "ORIGINAL_PAYMENT",
    returnMethod: "ship",
    settings: {
      restockingFeePercent: 0,
      returnShippingFee: 0,
      feeWaivedForStoreCredit: true,
      feeWaivedForExchange: true,
      feeExemptReasons: "",
      storeCreditBonusPercent: 0,
      incentivizeStoreCredit: false,
    },
    feesEnabled: false,
    bonusEnabled: false,
  });
  const locale = (normalizeLocale(body.locale) ?? normalizeLocale(settings.defaultLocale) ?? "en") as Locale;

  const created = await createReturnRequest({
    admin,
    shop,
    plan,
    settings,
    order,
    requestType: "WITHDRAWAL",
    locale,
    lines,
    refundType: "ORIGINAL_PAYMENT",
    returnMethod: getReturnMethods(settings)[0],
    totals,
    keepItem: false,
    customerName: String(body.name ?? "").trim().slice(0, 120) || null,
  });
  const view = await getStatusView(shop, created.rma);
  return { rma: created.rma, receivedAt: new Date().toISOString(), view: view ?? undefined };
}

// ─── Status page & customer tracking ────────────────────────────────────────

export async function getStatusView(shop: string, rma: string): Promise<StatusView | null> {
  const rr = await prisma.returnRequest.findFirst({
    where: { shop, rma },
    include: { items: true, settings: true },
  });
  if (!rr) return null;
  const s = rr.settings;
  const timeline: { key: string; date: string }[] = [{ key: "tlRequested", date: rr.createdAt.toISOString() }];
  if (rr.approvedAt) timeline.push({ key: "tlApproved", date: rr.approvedAt.toISOString() });
  if (rr.shippedAt) timeline.push({ key: "tlShipped", date: rr.shippedAt.toISOString() });
  if (rr.receivedAt) timeline.push({ key: "tlReceived", date: rr.receivedAt.toISOString() });
  if (rr.refundedAt) timeline.push({ key: "tlRefunded", date: rr.refundedAt.toISOString() });
  if (rr.rejectedAt && rr.status === "REJECTED") timeline.push({ key: "tlRejected", date: rr.rejectedAt.toISOString() });
  if (rr.status === "EXPIRED") timeline.push({ key: "tlExpired", date: (rr.expiredAt ?? rr.updatedAt).toISOString() });

  const methods = getReturnMethods(s);
  const method = methods.includes(rr.returnMethod as ReturnMethodKey) ? rr.returnMethod : methods[0];
  return {
    rma: rr.rma,
    status: rr.status,
    requestType: rr.requestType,
    orderName: rr.orderName,
    createdAt: rr.createdAt.toISOString(),
    items: rr.items.map((it) => ({
      name: it.name,
      variant: it.variantName && it.variantName !== "Default Title" ? it.variantName : "",
      quantity: it.quantity,
      image: it.imageUrl,
    })),
    refundType: rr.refundType,
    refundAmount: rr.refundAmount || rr.itemsTotal,
    currency: s.currency || "USD",
    returnMethod: method,
    keepItem: rr.keepItem,
    instructions: {
      method,
      address: realReturnAddress(s.returnAddress),
      storeInfo: s.storeDropoffInfo,
      pickupInfo: s.pickupInfo,
      labelUrl: rr.labelUrl && /^https:\/\//i.test(rr.labelUrl) ? rr.labelUrl : null,
    },
    tracking: { carrier: rr.carrier, number: rr.trackingNumber, url: rr.trackingUrl ?? getTrackingUrl(rr.carrier, rr.trackingNumber) },
    rejectionReason: rr.status === "REJECTED" ? rr.rejectionReason : null,
    timeline,
    payout: rr.payoutMethod ? { method: rr.payoutMethod, account: rr.payoutAccount ? `••••${rr.payoutAccount.slice(-4)}` : null } : null,
    canSubmitTracking: rr.status === "APPROVED" && !rr.keepItem && method === "ship",
    statusToken: signStatusToken({ shop, rma: rr.rma }),
  };
}

export async function lookupStatus(args: {
  shop: string;
  rma?: string;
  email?: string;
  statusToken?: string;
}): Promise<{ view?: StatusView; error?: keyof PortalDictionary }> {
  if (args.statusToken) {
    const t = verifyStatusToken(args.statusToken);
    if (!t || t.shop !== args.shop) return { error: "statusNotFound" };
    const view = await getStatusView(args.shop, t.rma);
    return view ? { view } : { error: "statusNotFound" };
  }
  const rma = String(args.rma ?? "").trim().toUpperCase().slice(0, 40);
  const email = String(args.email ?? "").trim().toLowerCase();
  if (!rma || !isValidEmail(email)) return { error: "statusNotFound" };
  const rr = await prisma.returnRequest.findFirst({
    where: { shop: args.shop, rma, customerEmail: { equals: email, mode: "insensitive" } },
    select: { rma: true },
  });
  if (!rr) return { error: "statusNotFound" };
  const view = await getStatusView(args.shop, rr.rma);
  return view ? { view } : { error: "statusNotFound" };
}

export async function submitCustomerTracking(args: {
  shop: string;
  statusToken: string;
  carrier: string;
  trackingNumber: string;
}): Promise<{ view?: StatusView; error?: keyof PortalDictionary }> {
  const t = verifyStatusToken(args.statusToken);
  if (!t || t.shop !== args.shop) return { error: "errSession" };
  const carrier = String(args.carrier ?? "").trim().slice(0, 80);
  const trackingNumber = String(args.trackingNumber ?? "").trim().slice(0, 80);
  if (!carrier || !trackingNumber) return { error: "errGeneric" };
  const admin = await getOfflineAdmin(args.shop);
  const res = await transitionStatus({
    admin,
    shop: args.shop,
    rma: t.rma,
    to: "SHIPPED",
    carrier,
    trackingNumber,
    trackingUrl: getTrackingUrl(carrier, trackingNumber),
    source: "customer",
  });
  if (!res.ok) return { error: "errGeneric" };
  const view = await getStatusView(args.shop, t.rma);
  return view ? { view } : { error: "errGeneric" };
}
