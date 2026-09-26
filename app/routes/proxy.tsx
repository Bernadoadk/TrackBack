// Shopify App Proxy: {shop}/apps/returns → {app}/proxy
//
// The request signature is verified (authenticate.public.appProxy), then the
// portal is rendered *inside the store theme* (header, footer, domain) as a
// Liquid page embedding the portal in an auto-resizing iframe. Merchants can
// switch to a full-page portal in Settings → Portal (portalDisplayMode).
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { sanitizeShop } from "../lib/portal.server";
import { authenticate } from "../shopify.server";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  try {
    await authenticate.public.appProxy(request);
  } catch (e) {
    if (e instanceof Response && e.status >= 300 && e.status < 400) throw e;
    return new Response("Unauthorized", { status: 401 });
  }
  const shop = sanitizeShop(url.searchParams.get("shop"));
  if (!shop) return new Response("Bad request", { status: 400 });

  const appUrl = (process.env.SHOPIFY_APP_URL || url.origin).replace(/\/$/, "");
  const params = new URLSearchParams({ shop });
  for (const key of ["t", "mode", "lang"]) {
    const v = url.searchParams.get(key);
    if (v) params.set(key, v.slice(0, 2048));
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { portalDisplayMode: true } });
  if (settings?.portalDisplayMode === "standalone") {
    throw redirect(`${appUrl}/portal?${params.toString()}`);
  }

  params.set("embed", "1");
  const src = `${appUrl}/portal?${params.toString()}`;
  const appOrigin = new URL(appUrl).origin;
  // Storefront language (Liquid) unless the link already carries ?lang=.
  const langSuffix = url.searchParams.get("lang") ? "" : "&amp;lang={{ request.locale.iso_code }}";

  const liquid = `<div class="trackback-portal" style="max-width:1100px;margin:0 auto;padding:0 8px;">
  <iframe id="trackback-portal-frame" title="{{ shop.name | escape }}" src="${attr(src)}${langSuffix}"
    style="display:block;width:100%;min-height:760px;border:0;background:transparent;" allow="clipboard-write"></iframe>
</div>
<script>
(function () {
  var frame = document.getElementById("trackback-portal-frame");
  var origin = ${JSON.stringify(appOrigin)};
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || !frame) return;
    if (e.data.type === "trackback:height" && e.data.height) frame.style.height = (e.data.height + 8) + "px";
    if (e.data.type === "trackback:scrollTop") {
      var r = frame.getBoundingClientRect();
      window.scrollTo({ top: window.pageYOffset + r.top - 80, behavior: "smooth" });
    }
  });
})();
</script>`;

  return new Response(liquid, { headers: { "Content-Type": "application/liquid" } });
};
