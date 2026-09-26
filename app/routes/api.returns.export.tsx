// GET /api/returns/export?tab=&q=&range= — CSV export of the filtered returns
// (all pages). Called with fetch() from the embedded admin (session token).
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listWhere, parseReturnFilters } from "../lib/returns-query";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const filters = parseReturnFilters(new URL(request.url));
  const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { currency: true } });

  const rows = await prisma.returnRequest.findMany({
    where: listWhere(shop, filters),
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const header = [
    "RMA", "Type", "Order", "Customer", "Email", "Phone", "Status", "Resolution", "Return method",
    `Items total (${settings?.currency ?? ""})`, "Fees", "Refund amount", "Items", "Reasons", "Created", "Refunded at",
  ];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([
      r.rma, r.requestType, r.orderName, r.customerName, r.customerEmail, r.customerPhone ?? "", r.status, r.refundType,
      r.keepItem ? "keep item" : r.returnMethod,
      r.itemsTotal || r.items.reduce((s, it) => s + it.price * it.quantity, 0),
      r.feeAmount, r.refundAmount,
      r.items.map((it) => `${it.name}${it.variantName && it.variantName !== "Default Title" ? ` (${it.variantName})` : ""} x${it.quantity}`).join(" | "),
      Array.from(new Set(r.items.map((it) => it.reason))).join(" | "),
      r.createdAt.toISOString(), r.refundedAt?.toISOString() ?? "",
    ].map(cell).join(","));
  }

  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="returns-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
