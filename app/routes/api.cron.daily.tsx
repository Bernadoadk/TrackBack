// GET /api/cron/daily — Vercel Cron (see vercel.json). Protected by CRON_SECRET:
// Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically.
//
// For every shop: expire approved returns that were never shipped, send the
// Monday weekly report, then purge old rate-limit rows. Time-boxed so a large
// install base never exceeds the function timeout (the next run continues).
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { purgeRateLimits } from "../lib/rate-limit.server";
import { maybeSendWeeklyReport } from "../lib/reports.server";
import { runShopMaintenance } from "../lib/returns-service.server";
import { safeEqual } from "../lib/tokens.server";

const TIME_BUDGET_MS = 45_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const isMonday = new Date().getUTCDay() === 1;
  const shops = await prisma.shopSettings.findMany({
    select: { shop: true },
    orderBy: { lastMaintenanceAt: { sort: "asc", nulls: "first" } },
    take: 500,
  });

  let processed = 0;
  let expired = 0;
  let reports = 0;
  for (const { shop } of shops) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const res = await runShopMaintenance(shop, { force: true });
      expired += res.expired;
      if (isMonday && (await maybeSendWeeklyReport(shop))) reports++;
      processed++;
    } catch (e) {
      console.error(`[cron] ${shop} failed:`, e);
    }
  }
  await purgeRateLimits().catch(() => {});

  return Response.json({ shops: shops.length, processed, expired, reports, ms: Date.now() - started });
};
