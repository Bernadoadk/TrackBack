// Search Shopify products / variants by title for the Exchange product picker.
// Returns up to 20 variants matching the query string.
//
// GET /api/products/search?q=tshirt
//   → { variants: [{ id, productId, title, productTitle, sku, price, currencyCode, imageUrl, availableForSale, inventoryQuantity }] }

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return { variants: [] };
  }

  try {
    // Search productVariants by title — covers most use cases. We could also
    // search by SKU; Shopify's `query` syntax supports both via `title:*` and
    // `sku:*` prefixes.
    const resp = await admin.graphql(
      `#graphql
        query SearchVariants($query: String!) {
          productVariants(first: 20, query: $query) {
            edges {
              node {
                id
                title
                sku
                price
                availableForSale
                inventoryQuantity
                image { url }
                product {
                  id
                  title
                  status
                  featuredImage { url }
                }
              }
            }
          }
        }`,
      { variables: { query: q } },
    );
    const json: any = await resp.json();
    if (json?.errors) {
      console.error("[api.products.search] GraphQL errors:", json.errors);
      return { variants: [], error: "Shopify search failed." };
    }

    const variants = (json?.data?.productVariants?.edges ?? [])
      .map((e: any) => {
        const v = e.node;
        if (!v || v.product?.status !== "ACTIVE") return null;
        return {
          id: v.id,
          productId: v.product?.id,
          title: v.title === "Default Title" ? v.product?.title : `${v.product?.title} — ${v.title}`,
          productTitle: v.product?.title,
          variantTitle: v.title,
          sku: v.sku ?? "",
          price: parseFloat(v.price ?? "0"),
          availableForSale: !!v.availableForSale,
          inventoryQuantity: v.inventoryQuantity ?? null,
          imageUrl: v.image?.url ?? v.product?.featuredImage?.url ?? null,
        };
      })
      .filter(Boolean);

    return { variants };
  } catch (err: any) {
    console.error("[api.products.search] failed:", err?.message ?? err);
    return { variants: [], error: String(err?.message ?? err) };
  }
};
