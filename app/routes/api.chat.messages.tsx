import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { markMerchantActive } from "../lib/chat.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  const since = url.searchParams.get("since");
  if (!conversationId) {
    return Response.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, shop },
  });
  if (!conv) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return Response.json({
    conversationId,
    messages: messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
};
