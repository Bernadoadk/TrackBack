import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateSupportConversation,
  markMerchantActive,
} from "../lib/chat.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  // Try to grab a friendly shop name
  let shopName: string | undefined;
  try {
    const r = await admin.graphql(`#graphql query { shop { name } }`);
    const j = await r.json();
    shopName = j?.data?.shop?.name ?? undefined;
  } catch { /* ignore */ }

  const conv = await getOrCreateSupportConversation(shop, shopName);

  // Load messages
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return Response.json({
    conversationId: conv.id,
    shopName: conv.customerName ?? shop,
    messages: messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
};
