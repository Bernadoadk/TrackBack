import type { ReturnReason, ShopSettings } from "@prisma/client";
import { loadPortalContext, sanitizeShop } from "./portal.server";
import { clientIp, rateLimit } from "./rate-limit.server";

export interface PortalApiContext {
  shop: string;
  settings: ShopSettings & { reasons: ReturnReason[] };
  plan: string;
  body: any;
  ip: string;
}

const MAX_BODY = 8 * 1024 * 1024;

/**
 * Wrapper for the public portal JSON endpoints: POST only, JSON body with a
 * `shop`, per-IP rate limit, never leaks stack traces.
 */
export async function handlePortalApi(
  request: Request,
  name: string,
  handler: (ctx: PortalApiContext) => Promise<unknown>,
  limits: { limit: number; windowSeconds: number } = { limit: 30, windowSeconds: 600 },
): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "errGeneric" }, { status: 405 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return Response.json({ error: "photoError" }, { status: 413 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "errGeneric" }, { status: 400 });
  }
  const shop = sanitizeShop(body?.shop);
  if (!shop) return Response.json({ error: "errUnavailable" }, { status: 400 });

  const ip = clientIp(request);
  const allowed = await rateLimit(`portal:${name}:${shop}:${ip}`, limits.limit, limits.windowSeconds);
  if (!allowed) return Response.json({ error: "errTooMany" }, { status: 429 });

  const ctx = await loadPortalContext(shop);
  if (!ctx) return Response.json({ error: "errUnavailable" }, { status: 404 });

  try {
    const result = await handler({ shop, settings: ctx.settings, plan: ctx.plan, body, ip });
    return Response.json(result);
  } catch (e) {
    console.error(`[portal-api:${name}] failed:`, e);
    return Response.json({ error: "errGeneric" }, { status: 500 });
  }
}
