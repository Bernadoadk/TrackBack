// POST /portal-api/chat/send — customer message (signed chat token required).
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { sendChatEmail } from "../lib/chat-mailer.server";
import {
  claimOfflineEmailSlot,
  getOrCreateClientConversation,
  isMerchantOffline,
  previewOf,
} from "../lib/chat.server";
import { handlePortalApi } from "../lib/portal-api.server";
import { hasFeature } from "../lib/plans";
import { rateLimit } from "../lib/rate-limit.server";
import { verifyChatToken } from "../lib/tokens.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handlePortalApi(
    request,
    "chat-send",
    async ({ shop, settings, plan, body }) => {
      if (!settings.liveChatEnabled || !hasFeature(plan, "liveChat")) return { error: "errUnavailable" };
      const token = verifyChatToken(String(body.token ?? ""));
      if (!token || token.shop !== shop) return { error: "errSession" };

      const text = String(body.body ?? "").trim();
      if (!text || text.length > 4000) return { error: "chatError" };
      const name = body.name ? String(body.name).trim().slice(0, 80) : undefined;

      if (!(await rateLimit(`chat:${shop}:${token.email}`, 20, 600))) return { error: "errTooMany" };

      const conversation = await getOrCreateClientConversation({ shop, customerEmail: token.email, customerName: name });
      const message = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderType: "CLIENT",
          senderName: name ?? token.email.split("@")[0],
          body: text,
        },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: message.createdAt,
          lastMessagePreview: previewOf(text),
          unreadByMerchant: { increment: 1 },
        },
      });

      if ((await isMerchantOffline(shop)) && (await claimOfflineEmailSlot(conversation.id))) {
        await sendChatEmail({
          shop,
          customerName: name ?? token.email.split("@")[0],
          customerEmail: token.email,
          bodyPreview: previewOf(text),
        }).catch((e) => console.error("[chat] email notify failed:", e));
      }

      return {
        ok: true,
        conversationId: conversation.id,
        message: {
          id: message.id,
          senderType: message.senderType,
          senderName: message.senderName,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
        },
      };
    },
    { limit: 40, windowSeconds: 600 },
  );
