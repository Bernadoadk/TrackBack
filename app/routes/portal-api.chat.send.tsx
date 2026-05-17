import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateClientConversation,
  isMerchantOffline,
  previewOf,
  shouldSendOfflineEmail,
} from "../lib/chat.server";
import { sendChatEmail } from "../lib/chat-mailer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let shop = "";
  try {
    const auth = await authenticate.public.appProxy(request);
    if (auth?.session) shop = auth.session.shop;
  } catch {
    // fall through to body shop
  }

  const body = await request.json().catch(() => ({}));
  if (!shop) shop = String(body.shop || "").trim();
  if (!shop) return Response.json({ error: "Missing shop" }, { status: 400 });

  const email = String(body.email || "").trim().toLowerCase();
  const name = body.name ? String(body.name).trim() : undefined;
  const text = String(body.body || "").trim();

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: "Empty message" }, { status: 400 });
  }
  if (text.length > 4000) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  const conversation = await getOrCreateClientConversation({
    shop,
    customerEmail: email,
    customerName: name,
  });

  const message = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderType: "CLIENT",
      senderName: name ?? email.split("@")[0],
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

  // Notify merchant by email if they appear offline
  if (isMerchantOffline(shop) && shouldSendOfflineEmail(shop, conversation.id)) {
    sendChatEmail({
      shop,
      to: shop, // merchant email is fetched server-side from settings
      customerName: name ?? email.split("@")[0],
      customerEmail: email,
      bodyPreview: previewOf(text),
    }).catch((e) => console.error("[chat] email notify failed:", e));
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
