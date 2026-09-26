// POST /portal-api/status — look up a return (RMA + email, or signed status link).
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { lookupStatus } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "status",
    ({ shop, body }) =>
      lookupStatus({
        shop,
        rma: body.rma ? String(body.rma) : undefined,
        email: body.email ? String(body.email) : undefined,
        statusToken: body.statusToken ? String(body.statusToken) : undefined,
      }),
    { limit: 20, windowSeconds: 600 },
  );
