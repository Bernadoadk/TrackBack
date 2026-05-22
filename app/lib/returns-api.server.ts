// Wrappers around Shopify Admin GraphQL mutations for Returns.
// Used to push TrackBack actions (portal submit, merchant approve/decline)
// back to Shopify so the merchant's Admin stays in sync.

type AdminClient = {
  graphql: (query: string, opts?: any) => Promise<Response>;
};

/**
 * Maps free-text portal reasons to Shopify's ReturnReason enum.
 * Unknown / custom reasons fall back to OTHER (with the original text passed
 * as customerNote, so the merchant sees the verbatim reason in Shopify).
 */
export function mapReasonToShopify(reason: string): string {
  const r = (reason ?? "").toLowerCase();
  if (!r) return "UNKNOWN";
  if (r.includes("size") && (r.includes("small") || r.includes("tight"))) return "SIZE_TOO_SMALL";
  if (r.includes("size") && (r.includes("large") || r.includes("big") || r.includes("loose"))) return "SIZE_TOO_LARGE";
  if (r.includes("fit")) return "SIZE_TOO_SMALL";
  if (r.includes("defect") || r.includes("damag") || r.includes("broken") || r.includes("faulty")) return "DEFECTIVE";
  if (r.includes("wrong") || r.includes("incorrect")) return "WRONG_ITEM";
  if (r.includes("color") || r.includes("colour")) return "COLOR";
  if (r.includes("style") || r.includes("look")) return "STYLE";
  if (r.includes("describ") || r.includes("pictur") || r.includes("expect") || r.includes("not as")) return "NOT_AS_DESCRIBED";
  if (r.includes("changed") || r.includes("mind") || r.includes("unwanted") || r.includes("don't need") || r.includes("dont need")) return "UNWANTED";
  return "OTHER";
}

/**
 * Build a map LineItem ID → FulfillmentLineItem ID for an order.
 * The returnRequest mutation requires FulfillmentLineItem IDs, but the
 * portal's order lookup query returns LineItem IDs — bridge them here.
 */
export async function fetchFulfillmentLineItemMap(
  admin: AdminClient,
  orderId: string,
): Promise<{ map: Map<string, string>; error: string | null }> {
  // returnRequest requires FulfillmentLineItem IDs (NOT FulfillmentOrderLineItem
  // IDs — they're different types). The right path is:
  //   Order.fulfillments[] → Fulfillment.fulfillmentLineItems[] → .id (gid://shopify/FulfillmentLineItem/...)
  // `fulfillments` is a non-paginated array directly on Order.
  const QUERY = `#graphql
    query OrderFulfillmentLineItems($orderId: ID!) {
      order(id: $orderId) {
        fulfillments {
          id
          fulfillmentLineItems(first: 100) {
            edges {
              node {
                id
                quantity
                lineItem { id }
              }
            }
          }
        }
      }
    }`;

  const map = new Map<string, string>();
  try {
    const resp = await admin.graphql(QUERY, { variables: { orderId } });
    const json: any = await resp.json();
    if (json?.errors) {
      const msg = json.errors
        .map((e: any) => e.message ?? JSON.stringify(e))
        .join("; ");
      console.error("[returns-api] fetchFulfillmentLineItemMap GraphQL errors:", msg);
      return { map, error: msg };
    }
    const fulfillments = json?.data?.order?.fulfillments ?? [];
    console.log(
      `[returns-api] order ${orderId} has ${fulfillments.length} fulfillment(s)`,
    );
    for (const f of fulfillments) {
      for (const fli of (f?.fulfillmentLineItems?.edges ?? [])) {
        const lineItemId = fli?.node?.lineItem?.id;
        const fulfillmentLineItemId = fli?.node?.id;
        if (lineItemId && fulfillmentLineItemId) {
          map.set(lineItemId, fulfillmentLineItemId);
        }
      }
    }
    return { map, error: null };
  } catch (err: any) {
    const msg =
      err?.response?.errors?.graphQLErrors?.[0]?.message ??
      err?.message ??
      String(err);
    console.error("[returns-api] fetchFulfillmentLineItemMap failed:", msg);
    return { map, error: msg };
  }
}

export interface CreateShopifyReturnItem {
  /** LineItem ID from the portal's order query (gid://shopify/LineItem/...) */
  lineItemId: string;
  quantity: number;
  /** Free-text reason from settings.reasons */
  reason: string;
  /** Optional customer note */
  note?: string;
}

/**
 * Creates a return on the Shopify side mirroring what the portal just stored
 * locally. Returns the Shopify Return GID if successful, null otherwise.
 * Failures are non-fatal — the local return still exists.
 */
export async function createShopifyReturn(
  admin: AdminClient,
  orderId: string,
  items: CreateShopifyReturnItem[],
): Promise<{ shopifyReturnId: string | null; userErrors: any[] }> {
  console.log(
    `[returns-api] createShopifyReturn START orderId=${orderId} items=${items.length}`,
  );

  // 1. Resolve fulfillment line items
  const { map: fliMap, error: fliError } = await fetchFulfillmentLineItemMap(
    admin,
    orderId,
  );
  console.log(
    `[returns-api] fulfillment map size=${fliMap.size} keys=[${[...fliMap.keys()].join(", ")}]`,
  );
  console.log(
    `[returns-api] incoming lineItemIds=[${items.map((i) => i.lineItemId).join(", ")}]`,
  );

  // If the fulfillmentOrders query itself failed (e.g. missing scope), surface
  // that to the merchant instead of the misleading "no fulfilled items" msg.
  if (fliError) {
    return {
      shopifyReturnId: null,
      userErrors: [{ message: `Shopify API error: ${fliError}` }],
    };
  }

  const returnLineItems = items
    .map((it) => {
      const fulfillmentLineItemId = fliMap.get(it.lineItemId);
      if (!fulfillmentLineItemId) {
        console.warn(
          `[returns-api] no fulfillmentLineItem for lineItemId=${it.lineItemId} — item will be skipped`,
        );
        return null;
      }
      return {
        fulfillmentLineItemId,
        quantity: it.quantity,
        returnReason: mapReasonToShopify(it.reason),
        customerNote: it.note?.slice(0, 500) || it.reason || "",
      };
    })
    .filter(Boolean);

  if (returnLineItems.length === 0) {
    const msg =
      fliMap.size === 0
        ? "This order has no fulfilled items yet — Shopify only allows returns on fulfilled line items. Ask the merchant to fulfill the order first."
        : "None of the selected items match a fulfilled line item on this order. The LineItem IDs from the portal don't appear in the order's fulfillment orders.";
    console.error(`[returns-api] ${msg}`);
    return {
      shopifyReturnId: null,
      userErrors: [{ message: msg }],
    };
  }

  // 2. Send the returnRequest mutation
  const MUTATION = `#graphql
    mutation ReturnRequest($input: ReturnRequestInput!) {
      returnRequest(input: $input) {
        return { id status name }
        userErrors { field message }
      }
    }`;

  console.log(
    `[returns-api] sending returnRequest mutation with ${returnLineItems.length} line items`,
  );

  try {
    const resp = await admin.graphql(MUTATION, {
      variables: { input: { orderId, returnLineItems } },
    });
    const json: any = await resp.json();
    if (json?.errors) {
      console.error("[returns-api] returnRequest GraphQL errors:", json.errors);
      return {
        shopifyReturnId: null,
        userErrors: json.errors.map((e: any) => ({ message: e.message })),
      };
    }
    const errors = json?.data?.returnRequest?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("[returns-api] returnRequest userErrors:", errors);
      return { shopifyReturnId: null, userErrors: errors };
    }
    const id = json?.data?.returnRequest?.return?.id ?? null;
    console.log(`[returns-api] returnRequest SUCCESS shopifyReturnId=${id}`);
    return { shopifyReturnId: id, userErrors: [] };
  } catch (err) {
    console.error("[returns-api] returnRequest threw:", err);
    return { shopifyReturnId: null, userErrors: [{ message: String(err) }] };
  }
}

/**
 * Approves a requested Shopify Return. Used when the merchant clicks
 * Approve in the TrackBack admin so the action propagates to Shopify Admin.
 */
export async function approveShopifyReturn(
  admin: AdminClient,
  shopifyReturnId: string,
): Promise<{ ok: boolean; userErrors: any[] }> {
  const MUTATION = `#graphql
    mutation ReturnApproveRequest($input: ReturnApproveRequestInput!) {
      returnApproveRequest(input: $input) {
        return { id status }
        userErrors { field message code }
      }
    }`;
  try {
    const resp = await admin.graphql(MUTATION, {
      variables: { input: { id: shopifyReturnId } },
    });
    const json: any = await resp.json();
    const errors = json?.data?.returnApproveRequest?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("[returns-api] returnApproveRequest userErrors:", errors);
      return { ok: false, userErrors: errors };
    }
    return { ok: true, userErrors: [] };
  } catch (err) {
    console.error("[returns-api] returnApproveRequest threw:", err);
    return { ok: false, userErrors: [{ message: String(err) }] };
  }
}

/**
 * Attaches shipping/tracking info to a Shopify Return — call this when the
 * merchant marks the return as SHIPPED in TrackBack. Creates a reverse
 * delivery on the first reverseFulfillmentOrder of the Return.
 *
 * Non-fatal on failure (tracking display is a nicety, not a blocker).
 */
export async function attachShippingToShopifyReturn(
  admin: AdminClient,
  shopifyReturnId: string,
  tracking: { number?: string | null; url?: string | null },
): Promise<{ ok: boolean; userErrors: any[] }> {
  // 1. Find the reverseFulfillmentOrder linked to this return.
  const QUERY = `#graphql
    query ReturnReverseFOs($id: ID!) {
      return(id: $id) {
        id
        reverseFulfillmentOrders(first: 5) {
          edges { node { id } }
        }
      }
    }`;
  let reverseFulfillmentOrderId: string | null = null;
  try {
    const resp = await admin.graphql(QUERY, { variables: { id: shopifyReturnId } });
    const json: any = await resp.json();
    reverseFulfillmentOrderId =
      json?.data?.return?.reverseFulfillmentOrders?.edges?.[0]?.node?.id ?? null;
  } catch (err) {
    console.error("[returns-api] reverseFulfillmentOrder lookup failed:", err);
    return { ok: false, userErrors: [{ message: String(err) }] };
  }

  if (!reverseFulfillmentOrderId) {
    // No reverse fulfillment order yet — the Return must be approved first.
    return {
      ok: false,
      userErrors: [
        { message: "No reverse fulfillment order found — approve the return first." },
      ],
    };
  }

  // 2. Create the reverse delivery with the tracking info (empty
  // reverseDeliveryLineItems means "all items at full quantity").
  const MUTATION = `#graphql
    mutation ReverseDeliveryCreateWithShipping(
      $reverseFulfillmentOrderId: ID!,
      $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!,
      $trackingInput: ReverseDeliveryTrackingInput
    ) {
      reverseDeliveryCreateWithShipping(
        reverseFulfillmentOrderId: $reverseFulfillmentOrderId,
        reverseDeliveryLineItems: $reverseDeliveryLineItems,
        trackingInput: $trackingInput,
        notifyCustomer: false
      ) {
        reverseDelivery { id }
        userErrors { field message }
      }
    }`;
  try {
    const resp = await admin.graphql(MUTATION, {
      variables: {
        reverseFulfillmentOrderId,
        reverseDeliveryLineItems: [],
        trackingInput:
          tracking.number || tracking.url
            ? { number: tracking.number ?? undefined, url: tracking.url ?? undefined }
            : null,
      },
    });
    const json: any = await resp.json();
    const errors = json?.data?.reverseDeliveryCreateWithShipping?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("[returns-api] reverseDeliveryCreateWithShipping userErrors:", errors);
      return { ok: false, userErrors: errors };
    }
    return { ok: true, userErrors: [] };
  } catch (err) {
    console.error("[returns-api] reverseDeliveryCreateWithShipping threw:", err);
    return { ok: false, userErrors: [{ message: String(err) }] };
  }
}

/**
 * Closes a Shopify Return — call this after a refund has been issued so the
 * native Shopify Return moves from OPEN → CLOSED and stops showing in the
 * merchant's "Retours en cours" list.
 *
 * A Return auto-closes only when ALL items have been processed via
 * returnProcess with disposition decisions. Since TrackBack uses refundCreate
 * (legacy path), we close explicitly here.
 */
export async function closeShopifyReturn(
  admin: AdminClient,
  shopifyReturnId: string,
): Promise<{ ok: boolean; userErrors: any[] }> {
  const MUTATION = `#graphql
    mutation ReturnClose($id: ID!) {
      returnClose(id: $id) {
        return { id status }
        userErrors { field message }
      }
    }`;
  try {
    const resp = await admin.graphql(MUTATION, {
      variables: { id: shopifyReturnId },
    });
    const json: any = await resp.json();
    const errors = json?.data?.returnClose?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("[returns-api] returnClose userErrors:", errors);
      return { ok: false, userErrors: errors };
    }
    return { ok: true, userErrors: [] };
  } catch (err) {
    console.error("[returns-api] returnClose threw:", err);
    return { ok: false, userErrors: [{ message: String(err) }] };
  }
}

/**
 * Declines a requested Shopify Return. Mirror of approveShopifyReturn for
 * the merchant's "Reject" action.
 */
export async function declineShopifyReturn(
  admin: AdminClient,
  shopifyReturnId: string,
  declineReason: string = "OTHER",
): Promise<{ ok: boolean; userErrors: any[] }> {
  const MUTATION = `#graphql
    mutation ReturnDeclineRequest($input: ReturnDeclineRequestInput!) {
      returnDeclineRequest(input: $input) {
        return { id status }
        userErrors { field message code }
      }
    }`;
  try {
    const resp = await admin.graphql(MUTATION, {
      variables: { input: { id: shopifyReturnId, declineReason } },
    });
    const json: any = await resp.json();
    const errors = json?.data?.returnDeclineRequest?.userErrors ?? [];
    if (errors.length > 0) {
      console.error("[returns-api] returnDeclineRequest userErrors:", errors);
      return { ok: false, userErrors: errors };
    }
    return { ok: true, userErrors: [] };
  } catch (err) {
    console.error("[returns-api] returnDeclineRequest threw:", err);
    return { ok: false, userErrors: [{ message: String(err) }] };
  }
}
