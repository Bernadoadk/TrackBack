/**
 * Admin GraphQL reads used by the customer portal and the returns service.
 * All operations validated against the 2025-10 Admin schema.
 */

type AdminClient = { graphql: (query: string, opts?: any) => Promise<Response> };

async function gql<T = any>(admin: AdminClient, query: string, variables?: Record<string, unknown>): Promise<T | null> {
  const resp = await admin.graphql(query, variables ? { variables } : undefined);
  const json: any = await resp.json();
  if (json?.errors) {
    console.error("[shopify] GraphQL errors:", JSON.stringify(json.errors).slice(0, 500));
    return null;
  }
  return (json?.data ?? null) as T | null;
}

const money = (v: any) => parseFloat(v?.shopMoney?.amount ?? "0") || 0;

// ─── Order lookup (portal) ──────────────────────────────────────────────────

export interface PortalOrderLine {
  id: string;
  title: string;
  variantTitle: string;
  quantity: number;
  unfulfilledQuantity: number;
  sku: string | null;
  image: string | null;
  productId: string | null;
  productTags: string[];
  productType: string | null;
  variantId: string | null;
  /** Unit price actually paid (after line + order discounts). */
  unitPrice: number;
  originalUnitPrice: number;
}

export interface PortalOrder {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  currencyCode: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string | null;
  customerId: string | null;
  customerName: string;
  customerOrders: number | null;
  totalPrice: number;
  /** Paid on delivery / manual gateway: no online payment to refund to. */
  isOfflinePayment: boolean;
  lines: PortalOrderLine[];
}

const ORDER_LOOKUP = `#graphql
  query PortalOrderLookup($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        email
        phone
        createdAt
        currencyCode
        displayFulfillmentStatus
        displayFinancialStatus
        paymentGatewayNames
        customer {
          id
          firstName
          lastName
          numberOfOrders
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
        }
        shippingAddress { phone }
        totalPriceSet { shopMoney { amount } }
        transactions(first: 20) { kind status gateway manualPaymentGateway }
        lineItems(first: 100) {
          nodes {
            id
            title
            variantTitle
            quantity
            unfulfilledQuantity
            sku
            image { url }
            product { id tags productType }
            variant { id }
            originalUnitPriceSet { shopMoney { amount } }
            discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
          }
        }
      }
    }
  }`;

function toPortalOrder(node: any): PortalOrder {
  const txs: any[] = node.transactions ?? [];
  const paidOnline = txs.some(
    (t) => (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS" && !t.manualPaymentGateway,
  );
  const gateways: string[] = node.paymentGatewayNames ?? [];
  const looksCod = gateways.some((g) => /cash|cod|livraison|delivery|manual/i.test(g));
  const firstName = node.customer?.firstName ?? "";
  const lastName = node.customer?.lastName ?? "";
  const email = String(node.email || node.customer?.defaultEmailAddress?.emailAddress || "");
  return {
    id: node.id,
    name: node.name,
    email,
    phone: node.phone || node.shippingAddress?.phone || node.customer?.defaultPhoneNumber?.phoneNumber || null,
    createdAt: node.createdAt,
    currencyCode: node.currencyCode,
    displayFulfillmentStatus: node.displayFulfillmentStatus,
    displayFinancialStatus: node.displayFinancialStatus ?? null,
    customerId: node.customer?.id ?? null,
    customerName: [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0],
    customerOrders: typeof node.customer?.numberOfOrders === "string"
      ? parseInt(node.customer.numberOfOrders, 10)
      : node.customer?.numberOfOrders ?? null,
    totalPrice: money(node.totalPriceSet),
    isOfflinePayment: !paidOnline && (looksCod || txs.length === 0 || txs.every((t) => t.manualPaymentGateway)),
    lines: (node.lineItems?.nodes ?? [])
      .filter((n: any) => n.product && n.variant)
      .map((n: any) => ({
        id: n.id,
        title: n.title,
        variantTitle: n.variantTitle || "",
        quantity: n.quantity,
        unfulfilledQuantity: n.unfulfilledQuantity ?? 0,
        sku: n.sku ?? null,
        image: n.image?.url ?? null,
        productId: n.product?.id ?? null,
        productTags: n.product?.tags ?? [],
        productType: n.product?.productType ?? null,
        variantId: n.variant?.id ?? null,
        unitPrice: money(n.discountedUnitPriceAfterAllDiscountsSet),
        originalUnitPrice: money(n.originalUnitPriceSet),
      })),
  };
}

/** Escapes a value for use inside a double-quoted Shopify search term. */
function searchValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Finds an order by number + email. The email is only used as a *quoted*
 * search value and is then re-checked in code, so search-syntax injection
 * (e.g. `* name:1001`) can never return someone else's order.
 */
export async function findOrderForPortal(
  admin: AdminClient,
  orderNumber: string,
  email: string,
): Promise<PortalOrder | null> {
  const want = email.trim().toLowerCase();
  const num = orderNumber.replace(/^#/, "");
  const queries = [`name:${searchValue(`#${num}`)}`, `name:${searchValue(num)}`];
  for (const q of queries) {
    const data = await gql<any>(admin, ORDER_LOOKUP, { query: q });
    for (const node of data?.orders?.nodes ?? []) {
      const order = toPortalOrder(node);
      const nameOk = String(order.name).replace(/^#/, "").toLowerCase() === num.toLowerCase();
      const emails = [order.email, node.customer?.defaultEmailAddress?.emailAddress]
        .filter(Boolean)
        .map((e: string) => e.trim().toLowerCase());
      if (nameOk && emails.includes(want)) return order;
    }
  }
  return null;
}

/** Re-reads an order by id (used on submit — never trust the browser's copy). */
export async function fetchOrderById(admin: AdminClient, orderId: string): Promise<PortalOrder | null> {
  const numeric = orderId.split("/").pop();
  if (!numeric || !/^\d+$/.test(numeric)) return null;
  const data = await gql<any>(admin, ORDER_LOOKUP, { query: `id:${numeric}` });
  const node = (data?.orders?.nodes ?? []).find((n: any) => n.id === orderId);
  return node ? toPortalOrder(node) : null;
}

// ─── Returnable quantities ──────────────────────────────────────────────────

export interface ReturnableInfo {
  /** False when Shopify couldn't be queried — callers fall back to order quantities. */
  ok: boolean;
  /** lineItemId → returnable quantity (fulfilled − already returned in Shopify). */
  quantities: Map<string, number>;
  /** lineItemId → earliest fulfillment date / delivery date. */
  fulfilledAt: Map<string, string>;
  deliveredAt: Map<string, string>;
}

export async function fetchReturnableQuantities(admin: AdminClient, orderId: string): Promise<ReturnableInfo> {
  const info: ReturnableInfo = { ok: false, quantities: new Map(), fulfilledAt: new Map(), deliveredAt: new Map() };
  const data = await gql<any>(
    admin,
    `#graphql
      query ReturnableFulfillments($orderId: ID!) {
        returnableFulfillments(orderId: $orderId, first: 20) {
          nodes {
            fulfillment { id createdAt deliveredAt }
            returnableFulfillmentLineItems(first: 100) {
              nodes {
                quantity
                fulfillmentLineItem { id lineItem { id } }
              }
            }
          }
        }
      }`,
    { orderId },
  );
  info.ok = !!data?.returnableFulfillments;
  for (const rf of data?.returnableFulfillments?.nodes ?? []) {
    const created = rf.fulfillment?.createdAt ?? null;
    const delivered = rf.fulfillment?.deliveredAt ?? null;
    for (const li of rf.returnableFulfillmentLineItems?.nodes ?? []) {
      const lineItemId = li.fulfillmentLineItem?.lineItem?.id;
      if (!lineItemId) continue;
      info.quantities.set(lineItemId, (info.quantities.get(lineItemId) ?? 0) + (li.quantity ?? 0));
      if (created && (!info.fulfilledAt.has(lineItemId) || created < info.fulfilledAt.get(lineItemId)!)) {
        info.fulfilledAt.set(lineItemId, created);
      }
      if (delivered && (!info.deliveredAt.has(lineItemId) || delivered < info.deliveredAt.get(lineItemId)!)) {
        info.deliveredAt.set(lineItemId, delivered);
      }
    }
  }
  return info;
}

// ─── Exchange options ───────────────────────────────────────────────────────

export interface ExchangeVariant {
  id: string;
  title: string;
  price: number;
  available: boolean;
  image: string | null;
  productId: string;
  productTitle: string;
}

export async function fetchProductVariants(admin: AdminClient, productId: string): Promise<ExchangeVariant[]> {
  const data = await gql<any>(
    admin,
    `#graphql
      query ExchangeVariants($id: ID!) {
        product(id: $id) {
          id
          title
          status
          featuredMedia { preview { image { url } } }
          variants(first: 100) {
            nodes { id title price availableForSale image { url } }
          }
        }
      }`,
    { id: productId },
  );
  const p = data?.product;
  if (!p || p.status !== "ACTIVE") return [];
  const fallbackImage = p.featuredMedia?.preview?.image?.url ?? null;
  return (p.variants?.nodes ?? []).map((v: any) => ({
    id: v.id,
    title: v.title,
    price: parseFloat(v.price ?? "0") || 0,
    available: !!v.availableForSale,
    image: v.image?.url ?? fallbackImage,
    productId: p.id,
    productTitle: p.title,
  }));
}

export async function searchProductsForExchange(admin: AdminClient, term: string): Promise<ExchangeVariant[]> {
  // Keep only letters/digits so the term can't alter the search expression.
  const words = term
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(and|or|not)$/i.test(w))
    .slice(0, 4);
  const query = words.length ? `status:active ${words.map((w) => `${w}*`).join(" ")}` : "status:active";
  const data = await gql<any>(
    admin,
    `#graphql
      query ShopNowProducts($query: String!) {
        products(first: 12, query: $query) {
          nodes {
            id
            title
            status
            featuredMedia { preview { image { url } } }
            variants(first: 25) { nodes { id title price availableForSale image { url } } }
          }
        }
      }`,
    { query },
  );
  const out: ExchangeVariant[] = [];
  for (const p of data?.products?.nodes ?? []) {
    if (p.status !== "ACTIVE") continue;
    const img = p.featuredMedia?.preview?.image?.url ?? null;
    for (const v of p.variants?.nodes ?? []) {
      out.push({
        id: v.id,
        title: v.title,
        price: parseFloat(v.price ?? "0") || 0,
        available: !!v.availableForSale,
        image: v.image?.url ?? img,
        productId: p.id,
        productTitle: p.title,
      });
    }
  }
  return out;
}

/** Resolves a single variant (validates a customer-picked replacement server-side). */
export async function fetchVariant(admin: AdminClient, variantId: string): Promise<ExchangeVariant | null> {
  const data = await gql<any>(
    admin,
    `#graphql
      query ExchangeVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          price
          availableForSale
          image { url }
          product { id title status featuredMedia { preview { image { url } } } }
        }
      }`,
    { id: variantId },
  );
  const v = data?.productVariant;
  if (!v || v.product?.status !== "ACTIVE") return null;
  return {
    id: v.id,
    title: v.title,
    price: parseFloat(v.price ?? "0") || 0,
    available: !!v.availableForSale,
    image: v.image?.url ?? v.product?.featuredMedia?.preview?.image?.url ?? null,
    productId: v.product.id,
    productTitle: v.product.title,
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function addOrderTags(admin: AdminClient, orderId: string, tags: string[]) {
  try {
    const data = await gql<any>(
      admin,
      `#graphql
        mutation TagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`,
      { id: orderId, tags },
    );
    const errs = data?.tagsAdd?.userErrors ?? [];
    if (errs.length) console.warn("[shopify] tagsAdd userErrors:", errs);
  } catch (e) {
    console.error("[shopify] tagsAdd failed:", e);
  }
}

export async function createGiftCard(
  admin: AdminClient,
  input: { amount: number; customerId?: string | null; note: string },
): Promise<{ id: string | null; code: string | null; lastCharacters: string | null; error: string | null }> {
  const data = await gql<any>(
    admin,
    `#graphql
      mutation GiftCardCreate($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard { id lastCharacters }
          giftCardCode
          userErrors { field message code }
        }
      }`,
    {
      input: {
        initialValue: input.amount.toFixed(2),
        note: input.note,
        ...(input.customerId ? { customerId: input.customerId } : {}),
      },
    },
  );
  const errs = data?.giftCardCreate?.userErrors ?? [];
  if (!data || errs.length) {
    return {
      id: null,
      code: null,
      lastCharacters: null,
      error: errs.map((e: any) => e.message).join(", ") || "Gift card creation failed",
    };
  }
  return {
    id: data.giftCardCreate.giftCard?.id ?? null,
    code: data.giftCardCreate.giftCardCode ?? null,
    lastCharacters: data.giftCardCreate.giftCard?.lastCharacters ?? null,
    error: null,
  };
}

export async function countOrders(admin: AdminClient, sinceIso: string): Promise<number | null> {
  try {
    const data = await gql<any>(
      admin,
      `#graphql
        query OrdersCount($query: String!) {
          ordersCount(query: $query, limit: 10000) { count precision }
        }`,
      { query: `created_at:>='${sinceIso}'` },
    );
    return typeof data?.ordersCount?.count === "number" ? data.ordersCount.count : null;
  } catch {
    return null;
  }
}
