// Read endpoint for the support console — protected by SUPPORT_REPLY_TOKEN.

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = request.headers.get("x-support-token");
  if (!process.env.SUPPORT_REPLY_TOKEN || token !== process.env.SUPPORT_REPLY_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return Response.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  return Response.json({
    conversationId,
    shop: conv.shop,
    shopName: conv.customerName,
    messages: messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
};
