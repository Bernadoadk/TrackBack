// shop/update — keeps the cached shop currency in sync (it drives every
// amount shown in the admin, the portal and the emails).
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhooks.shop.update] ${topic} for ${shop}`);
  try {
    const currency = typeof (payload as any)?.currency === "string" ? (payload as any).currency : null;
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      await prisma.shopSettings.updateMany({ where: { shop }, data: { currency } });
    }
  } catch (err) {
    console.error("[webhooks.shop.update] failed:", err);
  }
  return new Response();
};
