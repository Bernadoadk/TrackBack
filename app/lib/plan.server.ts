import prisma from "../db.server";

export const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  starter: 100,
  pro: 999999,
};

// Ordered plan levels for comparison
const PLAN_LEVEL: Record<string, number> = { free: 0, starter: 1, pro: 2 };

export async function getShopPlan(shop: string): Promise<string> {
  const billing = await prisma.billingSubscription.findUnique({ where: { shop } });
  if (!billing || billing.status !== 'active') return 'free';
  return billing.plan ?? 'free';
}

export function planAtLeast(plan: string, required: string): boolean {
  return (PLAN_LEVEL[plan] ?? 0) >= (PLAN_LEVEL[required] ?? 0);
}
