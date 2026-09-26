import prisma from "../db.server";

/**
 * Fixed-window rate limiter backed by Postgres (works across serverless
 * instances, unlike an in-memory Map). Returns true when the call is allowed.
 * Fails open on database errors: a limiter outage must not take the portal down.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = new Date();
  try {
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    if (!row || now.getTime() - row.windowStart.getTime() > windowSeconds * 1000) {
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now },
        update: { count: 1, windowStart: now },
      });
      return true;
    }
    if (row.count >= limit) return false;
    await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  } catch (e) {
    console.error("[rate-limit] failed (allowing request):", e);
    return true;
  }
}

/** Best-effort client IP behind Vercel / Cloudflare / the Shopify app proxy. */
export function clientIp(request: Request): string {
  const h = request.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
}

/** Housekeeping — called by the daily cron. */
export async function purgeRateLimits(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
}
