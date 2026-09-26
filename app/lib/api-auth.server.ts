import prisma from "../db.server";
import { getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";
import { rateLimit } from "./rate-limit.server";
import { sha256 } from "./tokens.server";

/** Authenticates a REST API call (Pro): "Authorization: Bearer tb_live_…". */
export async function authenticateApiKey(request: Request): Promise<{ shop: string } | Response> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("tb_live_") || key.length > 200) {
    return Response.json({ error: "Missing or invalid API key" }, { status: 401 });
  }
  const settings = await prisma.shopSettings.findFirst({ where: { apiKeyHash: sha256(key) }, select: { shop: true } });
  if (!settings) return Response.json({ error: "Invalid API key" }, { status: 401 });
  if (!hasFeature(await getShopPlan(settings.shop), "api")) {
    return Response.json({ error: "The TrackBack API requires the Pro plan" }, { status: 403 });
  }
  if (!(await rateLimit(`api:${settings.shop}`, 120, 60))) {
    return Response.json({ error: "Rate limit exceeded (120 requests/minute)" }, { status: 429 });
  }
  return { shop: settings.shop };
}
