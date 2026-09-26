// POST /portal-api/submit — create the return request (fully re-validated server-side).
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { submitReturn } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "submit",
    ({ shop, settings, plan, body }) => submitReturn({ shop, settings, plan, body }),
    { limit: 10, windowSeconds: 600 },
  );
