// GET /api/v1/returns?status=PENDING&updated_since=2026-01-01T00:00:00Z&limit=50&cursor=<id>
// Pro plan — Authorization: Bearer tb_live_…
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticateApiKey } from "../lib/api-auth.server";
import { RETURN_STATUSES } from "../lib/returns-logic";
import { serializeReturn } from "../lib/webhooks-out.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateApiKey(request);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const since = url.searchParams.get("updated_since");
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const cursor = url.searchParams.get("cursor");

  if (status && !(RETURN_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: `Unknown status. Use one of ${RETURN_STATUSES.join(", ")}` }, { status: 400 });
  }
  const sinceDate = since ? new Date(since) : null;
  if (since && Number.isNaN(sinceDate!.getTime())) return Response.json({ error: "Invalid updated_since" }, { status: 400 });

  const rows = await prisma.returnRequest.findMany({
    where: {
      shop: auth.shop,
      ...(status ? { status } : {}),
      ...(sinceDate ? { updatedAt: { gte: sinceDate } } : {}),
    },
    include: { items: true, settings: { select: { currency: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return Response.json({
    data: page.map(serializeReturn),
    next_cursor: rows.length > limit ? page[page.length - 1].id : null,
  });
};
