// POST /portal-api/withdraw — EU right of withdrawal ("Confirm withdrawal").
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { submitWithdrawal } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "withdraw",
    ({ shop, settings, plan, body }) => submitWithdrawal({ shop, settings, plan, body }),
    { limit: 10, windowSeconds: 600 },
  );
