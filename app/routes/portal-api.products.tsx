// POST /portal-api/products — "Shop Now" catalogue search (Pro).
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { shopNowSearch } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "products",
    ({ shop, settings, plan, body }) =>
      shopNowSearch({ shop, settings, plan, token: String(body.token ?? ""), q: String(body.q ?? "").slice(0, 80) }),
    { limit: 60, windowSeconds: 600 },
  );
