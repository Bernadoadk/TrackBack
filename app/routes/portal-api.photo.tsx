// POST /portal-api/photo — upload one evidence photo (data URL, resized client-side).
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { uploadReturnPhoto } from "../lib/portal.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "photo",
    ({ shop, plan, body }) =>
      uploadReturnPhoto({ shop, plan, token: String(body.token ?? ""), dataUrl: String(body.dataUrl ?? "") }),
    { limit: 25, windowSeconds: 600 },
  );
