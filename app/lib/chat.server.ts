import prisma from "../db.server";

/**
 * Presence + notification throttling are stored in the database (not in
 * process memory) so they behave correctly on serverless, where every request
 * may hit a different instance.
 */
const MERCHANT_OFFLINE_THRESHOLD_MIN = 5;
const MIN_MINUTES_BETWEEN_EMAILS = 15;

/** Records merchant activity (admin inbox / chat API calls). Throttled to 1 write/min. */
export async function markMerchantActive(shop: string) {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    await prisma.shopSettings.updateMany({
      where: { shop, OR: [{ merchantLastSeenAt: null }, { merchantLastSeenAt: { lt: oneMinuteAgo } }] },
      data: { merchantLastSeenAt: new Date() },
    });
  } catch (e) {
    console.error("[chat] markMerchantActive failed:", e);
  }
}

export async function isMerchantOffline(shop: string): Promise<boolean> {
  const s = await prisma.shopSettings.findUnique({ where: { shop }, select: { merchantLastSeenAt: true } });
  const ts = s?.merchantLastSeenAt?.getTime();
  if (!ts) return true;
  return Date.now() - ts > MERCHANT_OFFLINE_THRESHOLD_MIN * 60 * 1000;
}

/** Atomically claims the right to send an offline email for this conversation. */
export async function claimOfflineEmailSlot(conversationId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MIN_MINUTES_BETWEEN_EMAILS * 60 * 1000);
  const res = await prisma.conversation.updateMany({
    where: { id: conversationId, OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: cutoff } }] },
    data: { lastNotifiedAt: new Date() },
  });
  return res.count > 0;
}

export async function getOrCreateClientConversation(params: {
  shop: string;
  customerEmail: string;
  customerName?: string;
}) {
  const email = params.customerEmail.trim().toLowerCase();
  const existing = await prisma.conversation.findUnique({
    where: {
      shop_type_customerEmail: {
        shop: params.shop,
        type: "CLIENT",
        customerEmail: email,
      },
    },
  });
  if (existing) {
    if (params.customerName && !existing.customerName) {
      return prisma.conversation.update({
        where: { id: existing.id },
        data: { customerName: params.customerName },
      });
    }
    return existing;
  }
  return prisma.conversation.create({
    data: {
      shop: params.shop,
      type: "CLIENT",
      customerEmail: email,
      customerName: params.customerName ?? null,
    },
  });
}

export async function getOrCreateSupportConversation(shop: string, shopName?: string) {
  const existing = await prisma.conversation.findUnique({
    where: {
      shop_type_customerEmail: { shop, type: "SUPPORT", customerEmail: shop },
    },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: {
      shop,
      type: "SUPPORT",
      customerEmail: shop,
      customerName: shopName ?? shop,
    },
  });
}

export function previewOf(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed;
}

export async function sendDiscordSupportMessage(params: {
  shop: string;
  shopName?: string | null;
  body: string;
  conversationId: string;
}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ?? "";
  const replyUrl = appUrl
    ? `${appUrl}/support-console?conv=${encodeURIComponent(params.conversationId)}`
    : null;

  try {
    const embed: any = {
      author: {
        name: `${params.shopName || params.shop}`,
      },
      description: params.body.slice(0, 1800),
      color: 0x6c63ff,
      footer: { text: `conv ${params.conversationId}` },
      timestamp: new Date().toISOString(),
    };

    const body: any = {
      username: "TrackBack Support",
      allowed_mentions: { parse: [] },
      embeds: [embed],
    };

    if (replyUrl) {
      // Components require a bot in many cases; use a plain content line with a markdown link
      // for guaranteed compatibility with webhooks.
      body.content = `📩 **New support message** — [Click to reply →](${replyUrl})`;
    } else {
      body.content = `📩 **New support message** — conv \`${params.conversationId}\``;
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[chat] Discord webhook failed:", e);
  }
}
