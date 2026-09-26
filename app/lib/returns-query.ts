import type { Prisma } from "@prisma/client";

export const STATUS_TABS = ["All", "Pending", "Approved", "Shipped", "Received", "Refunded", "Rejected", "Expired"] as const;
export const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

export interface ReturnFilters {
  tab: string;
  q: string;
  range: string;
  page: number;
}

export function parseReturnFilters(url: URL): ReturnFilters {
  const tab = url.searchParams.get("tab") ?? "All";
  const range = url.searchParams.get("range") ?? "all";
  return {
    tab: (STATUS_TABS as readonly string[]).includes(tab) ? tab : "All",
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 80),
    range: RANGES.some((r) => r.key === range) ? range : "all",
    page: Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1),
  };
}

function rangeStart(range: string): Date | null {
  const now = new Date();
  if (range === "7" || range === "30" || range === "90") return new Date(now.getTime() - Number(range) * 86400000);
  if (range === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

/** Where clause without the status tab (used for tab counts). */
export function baseWhere(shop: string, f: ReturnFilters): Prisma.ReturnRequestWhereInput {
  const start = rangeStart(f.range);
  return {
    shop,
    ...(start ? { createdAt: { gte: start } } : {}),
    ...(f.q
      ? {
          OR: [
            { rma: { contains: f.q, mode: "insensitive" } },
            { orderName: { contains: f.q, mode: "insensitive" } },
            { customerName: { contains: f.q, mode: "insensitive" } },
            { customerEmail: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export function listWhere(shop: string, f: ReturnFilters): Prisma.ReturnRequestWhereInput {
  const where = baseWhere(shop, f);
  return f.tab === "All" ? where : { ...where, status: f.tab.toUpperCase() };
}
