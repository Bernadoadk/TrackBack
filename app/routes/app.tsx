import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigation, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncBillingFromShopify } from "../lib/plan.server";
import { getOnboardingState } from "../lib/onboarding.server";
import { Sidebar, ToastProvider, Icon } from "../components/ui";
import { useEffect, useState } from "react";
import SupportChatWidget from "../components/SupportChatWidget";
import ThemeToggle from "../components/ThemeToggle";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': any;
      's-link': any;
    }
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Onboarding gate — block all /app/* routes until the merchant has either
  // completed setup or explicitly skipped. The wizard route opts out.
  // We DON'T gate /app/settings either, so a merchant who skipped can still
  // go fix things from the standard settings page.
  const url = new URL(request.url);
  const isOnOnboarding = url.pathname.startsWith('/app/onboarding');
  const isOnSettings = url.pathname.startsWith('/app/settings');
  const onboarding = await getOnboardingState(shop);
  if (!isOnOnboarding && !isOnSettings && onboarding.status === 'pending') {
    // Preserve Shopify embedded-auth params (shop, host, id_token, embedded…)
    // across the redirect — otherwise authenticate.admin() loses context on
    // the next request and bounces to /auth/login.
    throw redirect(`/app/onboarding?${url.searchParams.toString()}`);
  }

  // Sync with Shopify FIRST — this is the source of truth for the plan.
  // Doing it here (in the top-level admin layout loader) means every admin
  // navigation refreshes the cache, so the UI never gets stuck on a stale
  // "pending" or wrongly-active state.
  const planName = await syncBillingFromShopify(admin, shop);

  const [pendingCount, shopData, unreadAgg] = await Promise.all([
    prisma.returnRequest.count({ where: { shop, status: 'PENDING' } }),
    admin.graphql(`#graphql
      query { shop { name } }
    `).then(r => r.json()).catch(() => ({ data: { shop: { name: null } } })),
    prisma.conversation.aggregate({
      where: { shop, type: 'CLIENT' },
      _sum: { unreadByMerchant: true },
    }),
  ]);
  const unreadCount = unreadAgg._sum.unreadByMerchant ?? 0;

  const shopName: string = shopData?.data?.shop?.name ?? shop.replace('.myshopify.com', '');

  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  firstDayOfMonth.setHours(0, 0, 0, 0);
  const usedThisMonth = await prisma.returnRequest.count({
    where: { shop, createdAt: { gte: firstDayOfMonth } }
  });

  const PLAN_LIMITS: Record<string, number> = { free: 10, starter: 100, pro: 999999 };
  const planLimit: number = PLAN_LIMITS[planName] ?? 10;

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    pendingCount,
    unreadCount,
    shop,
    shopName,
    planName,
    usedThisMonth,
    planLimit,
    onboardingStatus: onboarding.status,
    onboardingMissing: onboarding.missingFields,
  };
};

export default function App() {
  const { apiKey, pendingCount, unreadCount, shop, shopName, planName, usedThisMonth, planLimit, onboardingStatus } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav style={{ display: 'none' }}>
        <s-link href="/app">Home</s-link>
      </s-app-nav>
      <ToastProvider>
        {/* Global Loading Bar — gradient + glow */}
        <div className="fixed top-0 left-0 right-0 h-[2px] z-[9999] pointer-events-none overflow-hidden"
             style={{ opacity: isLoading ? 1 : 0, transition: 'opacity 0.25s ease' }}>
          <div className="h-full relative"
               style={{
                 width: isLoading ? '72%' : '100%',
                 background: 'linear-gradient(90deg, #6C63FF 0%, #8B5CF6 50%, #6C63FF 100%)',
                 transition: 'width 2s cubic-bezier(0.1, 0.8, 0.3, 1)',
                 boxShadow: '0 0 12px rgba(108,99,255,0.6), 0 0 24px rgba(139,92,246,0.4)',
               }}>
            <div className="absolute inset-0 opacity-60"
                 style={{
                   background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                   backgroundSize: '200% 100%',
                   animation: 'shimmer 1.4s linear infinite',
                 }} />
          </div>
        </div>
        {/* Theme toggle — top-right corner */}
        <div className="fixed top-3 right-3 md:top-4 md:right-4 z-[9990]">
          <ThemeToggle />
        </div>

        <div className="min-h-screen flex text-ink relative">
          <Sidebar pendingCount={pendingCount} unreadCount={unreadCount} shop={shop} shopName={shopName} planName={planName} usedThisMonth={usedThisMonth} planLimit={planLimit} onboardingStatus={onboardingStatus} />
          <main className="flex-1 min-w-0 bg-bg h-screen overflow-y-auto relative">
            {/* Soft ambient gradient behind content */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-[400px]"
                 style={{
                   background: 'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(108,99,255,0.08), transparent 60%), radial-gradient(ellipse 60% 40% at 90% 0%, rgba(139,92,246,0.06), transparent 60%)',
                 }} />

            {/* Top bar (mobile) */}
            <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-divider bg-surface relative z-10">
              <div className="w-7 h-7 rounded-md grid place-content-center text-white shadow-[0_4px_14px_-2px_rgba(108,99,255,0.5)]"
                   style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                <Icon name="RefreshCcw" size={14} strokeWidth={2.5} />
              </div>
              <div className="font-semibold text-[15px] tracking-tight">ReturnFlow</div>
            </div>

            <div className="px-6 md:px-10 py-8 max-w-[1280px] mx-auto relative z-10 animate-fadeIn">
              <Outlet />
            </div>
          </main>
        </div>
        <SupportChatWidget />
      </ToastProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
