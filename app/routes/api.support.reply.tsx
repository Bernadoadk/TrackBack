// Inbound bridge: ReturnFlow support team (you) replies to a merchant.
// Protected by a shared secret SUPPORT_REPLY_TOKEN (env var).
//
// Example call from Discord bot or curl:
//   curl -X POST $APP_URL/api/support/reply \
//        -H 'Content-Type: application/json' \
//        -H "X-Support-Token: $SUPPORT_REPLY_TOKEN" \
//        -d '{"conversationId":"clxxx...","body":"Hi! Here is the answer..."}'
//
// You can also pass `shop` instead of `conversationId` to auto-resolve the
// support conversation for that shop:
//   { "shop": "store.myshopify.com", "body": "..." }

import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  getOrCreateSupportConversation,
  previewOf,
} from "../lib/chat.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const token = request.headers.get("x-support-token");
  if (!process.env.SUPPORT_REPLY_TOKEN || token !== process.env.SUPPORT_REPLY_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const text = String(body.body || "").trim();
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 4000) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  let conversation;
  if (body.conversationId) {
    conversation = await prisma.conversation.findUnique({
      where: { id: String(body.conversationId) },
    });
  } else if (body.shop) {
    conversation = await getOrCreateSupportConversation(String(body.shop));
  }
  if (!conversation || conversation.type !== "SUPPORT") {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const senderName = body.senderName ? String(body.senderName) : "ReturnFlow Support";

  const message = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderType: "SUPPORT",
      senderName,
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
