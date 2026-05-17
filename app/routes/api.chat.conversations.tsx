import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { markMerchantActive } from "../lib/chat.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  const conversations = await prisma.conversation.findMany({
    where: { shop },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });

  const totalUnread = conversations.reduce(
    (acc, c) => acc + (c.unreadByMerchant || 0),
    0,
  );

  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      type: c.type,
      customerEmail: c.customerEmail,
      customerName: c.customerName,
      unreadByMerchant: c.unreadByMerchant,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessagePreview: c.lastMessagePreview ?? "",
      closed: c.closed,
    })),
    totalUnread,
  });
};
