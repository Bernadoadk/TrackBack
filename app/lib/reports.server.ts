import prisma from "../db.server";
import { isRealEmail, sendPlainEmail } from "./mailer.server";
import { formatMoney } from "./money";
import { getShopPlan } from "./plan.server";
import { hasFeature } from "./plans";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday summary of the past 7 days (Starter+). Idempotent per week. */
export async function maybeSendWeeklyReport(shop: string, now = new Date()) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings?.weeklyReportEnabled || !isRealEmail(settings.fromEmail)) return false;
  if (settings.lastWeeklyReportAt && now.getTime() - settings.lastWeeklyReportAt.getTime() < 6 * DAY_MS) return false;
  if (!hasFeature(await getShopPlan(shop), "weeklyReport")) return false;

  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [requests, refunded, pending, reasons] = await Promise.all([
    prisma.returnRequest.count({ where: { shop, createdAt: { gte: since } } }),
    prisma.returnRequest.findMany({
      where: { shop, refundedAt: { gte: since } },
      select: { refundType: true, refundAmount: true },
    }),
    prisma.returnRequest.count({ where: { shop, status: "PENDING" } }),
    prisma.returnItem.groupBy({
      by: ["reason"],
      where: { returnRequest: { shop, createdAt: { gte: since } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 3,
    }),
  ]);
  const currency = settings.currency || "USD";
  const cash = refunded.filter((r) => r.refundType === "ORIGINAL_PAYMENT" || r.refundType === "MANUAL").reduce((s, r) => s + r.refundAmount, 0);
  const retained = refunded.filter((r) => ["STORE_CREDIT", "GIFT_CARD", "EXCHANGE"].includes(r.refundType)).reduce((s, r) => s + r.refundAmount, 0);
  const fr = settings.defaultLocale === "fr";
  const reasonLines = reasons.map((r) => `• ${r.reason} (${r._sum.quantity ?? 0})`).join("\n") || (fr ? "• —" : "• —");

  const text = fr
    ? `Votre semaine TrackBack\n\nNouvelles demandes : ${requests}\nRetours finalisés : ${refunded.length}\nRemboursé : ${formatMoney(cash, currency)}\nRevenu conservé (avoir, carte cadeau, échange) : ${formatMoney(retained, currency)}\nEn attente de votre validation : ${pending}\n\nPrincipaux motifs :\n${reasonLines}\n`
    : `Your TrackBack week\n\nNew requests: ${requests}\nCompleted returns: ${refunded.length}\nRefunded: ${formatMoney(cash, currency)}\nRevenue retained (store credit, gift cards, exchanges): ${formatMoney(retained, currency)}\nWaiting for your review: ${pending}\n\nTop reasons:\n${reasonLines}\n`;

  const sent = await sendPlainEmail({
    to: settings.fromEmail,
    fromName: "TrackBack",
    subject: fr ? `📊 Votre semaine de retours — ${requests} demande(s)` : `📊 Your returns this week — ${requests} request(s)`,
    text,
  });
  if (sent) await prisma.shopSettings.update({ where: { shop }, data: { lastWeeklyReportAt: now } });
  return sent;
}
