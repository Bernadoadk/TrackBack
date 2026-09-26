// POST /portal-api/tracking — the customer adds the carrier + tracking number of their parcel.
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { submitCustomerTracking } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "tracking",
    ({ shop, body }) =>
      submitCustomerTracking({
        shop,
        statusToken: String(body.statusToken ?? ""),
        carrier: String(body.carrier ?? ""),
        trackingNumber: String(body.trackingNumber ?? ""),
      }),
    { limit: 10, windowSeconds: 600 },
  );
