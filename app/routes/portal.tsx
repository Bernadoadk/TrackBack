import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import ChatWidget from "../components/ChatWidget";
import { Notice, PortalProvider, useEmbedAutoHeight, usePortal } from "../components/portal/kit";
import { ReturnFlow } from "../components/portal/return-flow";
import { PortalCard, PortalShell } from "../components/portal/shells";
import { StatusScreen } from "../components/portal/status-view";
import { WithdrawalFlow } from "../components/portal/withdrawal-flow";
import type { PortalView, StatusView } from "../lib/portal-types";
import { buildPortalConfig, loadPortalContext, lookupStatus, sanitizeShop } from "../lib/portal.server";
import { getOfflineAdmin } from "../lib/returns-service.server";
import { getShopCurrency } from "../lib/shop-currency.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop =
    sanitizeShop(url.searchParams.get("shop")) ??
    (process.env.NODE_ENV !== "production" ? "example.myshopify.com" : null);
  if (!shop) throw new Response("Not found", { status: 404 });

  const ctx = await loadPortalContext(shop);
  let currency = ctx?.settings.currency || "USD";
  if (ctx && currency === "USD") {
    // "USD" is also the column default: verify it once with Shopify.
    const admin = await getOfflineAdmin(shop);
    if (admin) currency = await getShopCurrency(shop, admin as any).catch(() => currency);
  }

  const mode = url.searchParams.get("mode");
  let view: PortalView =
    mode === "withdraw" && ctx?.settings.euWithdrawalEnabled ? "withdrawal" : mode === "status" ? "status" : "return";
  let initialStatus: StatusView | null = null;
  const statusToken = url.searchParams.get("t");
  if (statusToken && ctx) {
    const res = await lookupStatus({ shop, statusToken });
    if (res.view) {
      initialStatus = res.view;
      view = "status";
    }
  }

  const cfg = buildPortalConfig({
    shop,
    settings: ctx?.settings ?? null,
    plan: ctx?.plan ?? "free",
    currency,
    request,
    view,
    initialStatus,
    embed: url.searchParams.get("embed") === "1",
  });
  return { cfg };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.cfg.storeName} — ${data.cfg.texts.returnCenter}` : "Returns" },
  { name: "robots", content: "noindex" },
];

export default function PortalPage() {
  const { cfg } = useLoaderData<typeof loader>();
  return (
    <PortalProvider cfg={cfg}>
      <PortalApp />
    </PortalProvider>
  );
}

function PortalApp() {
  const { cfg, t } = usePortal();
  const [view, setView] = useState<PortalView>(cfg.initialView);
  const [statusView, setStatusView] = useState<StatusView | null>(cfg.initialStatus);
  const [flowKey, setFlowKey] = useState(0);
  const [chatIdentity, setChatIdentity] = useState<{ chatToken: string; email: string; name: string } | null>(null);
  useEmbedAutoHeight(cfg.embed);

  if (cfg.unavailable) {
    return (
      <PortalShell>
        <PortalCard>
          <Notice>{t("errUnavailable")}</Notice>
        </PortalCard>
      </PortalShell>
    );
  }

  const newReturn = () => {
    setFlowKey((k) => k + 1);
    setView("return");
  };

  return (
    <>
      {view === "return" && (
        <ReturnFlow
          key={flowKey}
          onTrack={() => {
            setStatusView(null);
            setView("status");
          }}
          onWithdraw={() => setView("withdrawal")}
          onIdentified={setChatIdentity}
        />
      )}
      {view === "status" && (
        <PortalShell>
          <PortalCard>
            <StatusScreen key={statusView?.rma ?? "lookup"} initial={statusView} onNewReturn={newReturn} />
          </PortalCard>
        </PortalShell>
      )}
      {view === "withdrawal" && (
        <WithdrawalFlow
          onExit={newReturn}
          onTrack={(v) => {
            setStatusView(v);
            setView("status");
          }}
        />
      )}
      {cfg.chat.enabled && (
        <ChatWidget
          shop={cfg.shop}
          brandColor={cfg.brandColor}
          storeName={cfg.storeName}
          texts={cfg.texts}
          verifiedToken={chatIdentity?.chatToken}
          prefillEmail={chatIdentity?.email}
          prefillName={chatIdentity?.name}
          icon={cfg.chat.icon}
          inline={cfg.embed}
        />
      )}
    </>
  );
}
