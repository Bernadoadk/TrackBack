import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  let shop = "";
  try {
    const auth = await authenticate.public.appProxy(request);
    if (auth?.session) shop = auth.session.shop;
  } catch {
    // fall through
  }
  if (!shop) shop = url.searchParams.get("shop") || "";
  if (!shop) return Response.json({ error: "Missing shop" }, { status: 400 });

  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const since = url.searchParams.get("since");
  if (!email) return Response.json({ error: "Missing email" }, { status: 400 });

  const conversation = await prisma.conversation.findUnique({
    where: {
      shop_type_customerEmail: { shop, type: "CLIENT", customerEmail: email },
    },
  });

  if (!conversation) {
    return Response.json({ conversationId: null, messages: [] });
  }

  // Mark merchant messages as read by customer
  if (conversation.unreadByCustomer > 0) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadByCustomer: 0 },
    });
    await prisma.chatMessage.updateMany({
      where: {
        conversationId: conversation.id,
        senderType: { in: ["MERCHANT", "SUPPORT"] },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
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
