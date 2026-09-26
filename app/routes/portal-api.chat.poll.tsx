// GET /portal-api/chat/poll?shop=&token=&since= — customer side of the chat.
// Requires a signed chat token; unverified tokens only see recent messages.
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getShopPlan } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";
import { sanitizeShop } from "../lib/portal.server";
import { verifyChatToken } from "../lib/tokens.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = sanitizeShop(url.searchParams.get("shop"));
  const token = verifyChatToken(url.searchParams.get("token"));
  if (!shop || !token || token.shop !== shop) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { liveChatEnabled: true } });
  if (!settings?.liveChatEnabled || !hasFeature(await getShopPlan(shop), "liveChat")) {
    return Response.json({ conversationId: null, messages: [] });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { shop_type_customerEmail: { shop, type: "CLIENT", customerEmail: token.email } },
  });
  if (!conversation) return Response.json({ conversationId: null, messages: [] });

  if (conversation.unreadByCustomer > 0) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadByCustomer: 0 } });
    await prisma.chatMessage.updateMany({
      where: { conversationId: conversation.id, senderType: { in: ["MERCHANT", "SUPPORT"] }, readAt: null },
      data: { readAt: new Date() },
    });
  }

  const sinceParam = url.searchParams.get("since");
  const sinceDates: Date[] = [];
  if (sinceParam && !Number.isNaN(new Date(sinceParam).getTime())) sinceDates.push(new Date(sinceParam));
  if (!token.verified) sinceDates.push(new Date(token.since - 1000));
  const after = sinceDates.length ? new Date(Math.max(...sinceDates.map((d) => d.getTime()))) : null;

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return Response.json({
    conversationId: conversation.id,
    messages: messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
};
