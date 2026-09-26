// POST /portal-api/chat/token — identity for customers who start a chat before
// looking up an order. Such tokens are "unverified": they can post and read
// replies created after issuance, but never the conversation's history.
import type { ActionFunctionArgs } from "react-router";
import { handlePortalApi } from "../lib/portal-api.server";
import { hasFeature } from "../lib/plans";
import { isValidEmail } from "../lib/returns-logic";
import { signChatToken } from "../lib/tokens.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "chat-token",
    async ({ shop, settings, plan, body }) => {
      if (!settings.liveChatEnabled || !hasFeature(plan, "liveChat")) return { error: "errUnavailable" };
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!isValidEmail(email)) return { error: "errInvalidEmail" };
      return { chatToken: signChatToken({ shop, email, verified: false, since: Date.now() }) };
    },
    { limit: 10, windowSeconds: 600 },
  );
