import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateSupportConversation,
  markMerchantActive,
  previewOf,
  sendDiscordSupportMessage,
} from "../lib/chat.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  const body = await request.json().catch(() => ({}));
  const conversationId = body.conversationId ? String(body.conversationId) : "";
  const text = String(body.body || "").trim();
  const senderType = String(body.senderType || "MERCHANT").toUpperCase();
  const senderName =
    typeof body.senderName === "string" && body.senderName.trim()
      ? body.senderName.trim()
      : null;

  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 4000) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shop },
    });
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else if (senderType === "MERCHANT" && body.intent === "support") {
    conversation = await getOrCreateSupportConversation(
      shop,
      body.shopName as string | undefined,
    );
  } else {
    return Response.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const isSupportConv = conversation.type === "SUPPORT";

  const message = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderType: "MERCHANT",
      senderName,
      body: text,
    },
  });

  // Update conversation counters
  // - On CLIENT conversation: merchant just replied → reset their own unread, increment customer's
  // - On SUPPORT conversation: merchant just messaged us (support team) → no unread bump (we read it via Discord)
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: message.createdAt,
      lastMessagePreview: previewOf(text),
      unreadByMerchant: 0,
      ...(isSupportConv ? {} : { unreadByCustomer: { increment: 1 } }),
    },
  });

  if (isSupportConv) {
    sendDiscordSupportMessage({
      shop,
      shopName: conversation.customerName,
      body: text,
      conversationId: conversation.id,
    }).catch((e) => console.error("[chat] discord post failed:", e));
  }

  return Response.json({
    ok: true,
    conversationId: conversation.id,
    message: {
      id: message.id,
      senderType: message.senderType,
      senderName: message.senderName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  });
};
