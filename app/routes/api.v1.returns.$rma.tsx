// GET /api/v1/returns/:rma — Pro plan — Authorization: Bearer tb_live_…
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticateApiKey } from "../lib/api-auth.server";
import { serializeReturn } from "../lib/webhooks-out.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateApiKey(request);
  if (auth instanceof Response) return auth;
  const rr = await prisma.returnRequest.findFirst({
    where: { shop: auth.shop, rma: String(params.rma ?? "").toUpperCase() },
    include: { items: true, settings: { select: { currency: true } } },
  });
  if (!rr) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ data: serializeReturn(rr) });
};
