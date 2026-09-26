// POST /portal-api/exchange-options — replacement variants for the selected products.
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { exchangeOptions } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(request, "exchange-options", ({ shop, settings, plan, body }) =>
    exchangeOptions({
      shop,
      settings,
      plan,
      token: String(body.token ?? ""),
      productIds: Array.isArray(body.productIds) ? body.productIds.map(String) : [],
    }),
  );
