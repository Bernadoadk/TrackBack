import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export const meta: MetaFunction = () => [
  { title: "TrackBack — Returns & exchanges for Shopify" },
  {
    name: "description",
    content: "Branded return portal, exchanges, store credit, cash-on-delivery refunds and WhatsApp updates — at a price small stores can afford.",
  },
  // The marketing site (trackback-web.vercel.app) is the page that should rank for
  // "TrackBack": keep this app login page out of search results.
  { name: "robots", content: "noindex, follow" },
];

const FEATURES = [
  { icon: "🌍", title: "Branded portal in English & French", body: "Customers find their order, pick items and a resolution in a few clicks — right inside your store." },
  { icon: "🔁", title: "Exchanges & store credit", body: "Self-service size/color exchanges, store credit with bonus, gift cards and green returns keep revenue in your store." },
  { icon: "💸", title: "Cash-on-delivery refunds", body: "Collect Wave, Orange Money, MTN MoMo, M-Pesa or bank details and record payouts in Shopify." },
  { icon: "💬", title: "WhatsApp & live chat", body: "Answer customers where they already are, with one-click WhatsApp messages and a built-in chat." },
  { icon: "⚖️", title: "EU withdrawal button", body: "The two-step “Withdraw from contract” flow required in the EU since June 2026, built in." },
  { icon: "📊", title: "Analytics that matter", body: "Return rate, retained revenue, top reasons and products — plus a weekly email report." },
];

export default function Landing() {
  const { showForm } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="max-w-5xl mx-auto px-6 py-14">
        <img src="/trackback_logo.png" alt="TrackBack" className="h-12 w-auto" />
        <h1 className="mt-8 text-[34px] md:text-[44px] font-bold tracking-tight leading-[1.1] max-w-2xl">
          Returns that keep customers — and revenue.
        </h1>
        <p className="mt-4 text-[15px] text-muted max-w-xl leading-relaxed">
          TrackBack gives Shopify stores a branded return portal, exchanges, store credit and automatic Shopify sync, with plans starting free.
        </p>
        {showForm && (
          <Form method="post" action="/auth/login" className="mt-8 flex flex-col sm:flex-row gap-2 max-w-md">
            <input
              name="shop"
              placeholder="your-store.myshopify.com"
              className="flex-1 h-11 px-3.5 rounded-lg bg-surface border border-border text-[14px] focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
            <button type="submit" className="h-11 px-5 rounded-lg text-white text-[14px] font-semibold bg-gradient-to-b from-[#7B73FF] to-[#6259EE]">
              Log in
            </button>
          </Form>
        )}
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[22px]">{f.icon}</div>
              <div className="mt-2 text-[14.5px] font-semibold">{f.title}</div>
              <div className="mt-1 text-[13px] text-muted leading-relaxed">{f.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
