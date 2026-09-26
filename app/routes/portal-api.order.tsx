// POST /portal-api/order — find an order (number + email) for a return or an EU withdrawal.
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { lookupOrder } from "../lib/portal.server";
import { rateLimit } from "../lib/rate-limit.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "order",
    async ({ shop, settings, plan, body }) => {
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
      // Second limiter keyed on the email: stops guessing order numbers for one customer.
      if (email && !(await rateLimit(`portal:order-email:${shop}:${email}`, 8, 600))) return { error: "errTooMany" };
      return lookupOrder({
        shop,
        settings,
        plan,
        orderNumber: String(body.orderNumber ?? ""),
        email,
        mode: body.mode === "withdrawal" ? "withdrawal" : "return",
      });
    },
    { limit: 15, windowSeconds: 600 },
  );
