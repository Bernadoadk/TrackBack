import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { markMerchantActive } from "../lib/chat.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body.conversationId || "");
  if (!conversationId) {
    return Response.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, shop },
  });
  if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { unreadByMerchant: 0 },
  });

  await prisma.chatMessage.updateMany({
    where: {
      conversationId: conv.id,
      senderType: "CLIENT",
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return Response.json({ ok: true });
};
