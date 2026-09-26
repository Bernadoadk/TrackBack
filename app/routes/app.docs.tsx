import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader, Icon, TierBadge, useToast } from "../components/ui";
import { ANNUAL_DISCOUNT_PCT, PLANS } from "../lib/plans";
import { EMAIL_VARIABLES } from "../lib/email-templates";
import { PAYOUT_METHODS } from "../lib/i18n";

// ─── Sections ─────────────────────────────────────────────────────────────────

type SectionDef = {
  id: string;
  title: string;
  icon: string;
};

type GroupDef = {
  label: string;
  icon: string;
  sections: SectionDef[];
};

const GROUPS: GroupDef[] = [
  {
    label: "Get started",
    icon: "Sparkles",
    sections: [
      { id: "getting-started", title: "Getting started", icon: "Sparkles" },
      { id: "portal", title: "Customer portal", icon: "Globe" },
    ],
  },
  {
    label: "Daily operations",
    icon: "Zap",
    sections: [
      { id: "returns", title: "Managing returns", icon: "Package" },
      { id: "refunds", title: "Refunds & exchanges", icon: "Wallet" },
      { id: "live-chat", title: "Live chat & WhatsApp", icon: "MessageCircle" },
      { id: "analytics", title: "Analytics & reports", icon: "ChartLine" },
    ],
  },
  {
    label: "Customize",
    icon: "Paintbrush",
    sections: [
      { id: "portal-editor", title: "Portal editor", icon: "Paintbrush" },
      { id: "email-templates", title: "Email templates", icon: "Mail" },
      { id: "settings", title: "Settings", icon: "Settings" },
      { id: "integrations", title: "Webhooks & API", icon: "Webhook" },
    ],
  },
  {
    label: "Reference",
    icon: "BookOpen",
    sections: [
      { id: "billing", title: "Billing & plans", icon: "CreditCard" },
      { id: "compliance", title: "GDPR & EU withdrawal", icon: "ShieldCheck" },
      { id: "faq", title: "FAQ", icon: "MessageCircleQuestionMark" },
    ],
  },
];

const MOBILE_MONEY = PAYOUT_METHODS.filter((m) => m.kind === "phone").map((m) => m.label.en).join(", ");

// Helper: which group contains a given section id?
function findGroupOfSection(sectionId: string): GroupDef | undefined {
  return GROUPS.find((g) => g.sections.some((s) => s.id === sectionId));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<string>(GROUPS[0].label);
  const [progress, setProgress] = useState(0);

  const activeIndex = GROUPS.findIndex((g) => g.label === activeTab);
  const prevGroup = activeIndex > 0 ? GROUPS[activeIndex - 1] : null;
  const nextGroup = activeIndex < GROUPS.length - 1 ? GROUPS[activeIndex + 1] : null;

  // Reading progress bar
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      const pct = total > 0 ? (doc.scrollTop / total) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, pct)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Honor a #hash on first load — switch to the tab that contains it
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const group = findGroupOfSection(hash);
    if (group) {
      setActiveTab(group.label);
      // Scroll after the tab content has rendered
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (label: string) => {
    if (label === activeTab) return;
    setActiveTab(label);
    history.replaceState(null, "", window.location.pathname); // strip hash on tab change
    // Reset scroll so the new content starts at the top
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      {/* Reading progress bar */}
      <div className="fixed top-0 left-0 right-0 h-[2px] z-50 pointer-events-none">
        <div
          className="h-full transition-[width] duration-150 ease-out"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg,#6C63FF 0%,#8B5CF6 50%,#6C63FF 100%)",
            boxShadow: "0 0 8px rgba(108,99,255,0.55)",
          }}
        />
      </div>

      <PageHeader
        title="Documentation"
        subtitle="Everything you need to set up, run and grow with TrackBack."
        right={
          <a
            href="mailto:bernadoecom@gmail.com"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-[12.5px] font-semibold text-ink bg-surface border border-border hover:border-accent2 transition"
          >
            <Icon name="LifeBuoy" size={14} /> Need help?
          </a>
        }
      />

      {/* ── Hero card ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface mb-6 animate-slideUp">
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 80% 0%, rgba(108,99,255,0.20), transparent 60%), radial-gradient(ellipse 50% 60% at 0% 100%, rgba(139,92,246,0.18), transparent 65%)",
          }}
        />
        <div className="relative p-7 md:p-9 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider mb-3"
              style={{ background: "rgba(108,99,255,0.15)", color: "#8B85FF" }}>
              <Icon name="Sparkles" size={11} /> Welcome
            </div>
            <h2 className="text-[26px] md:text-[30px] font-bold text-ink tracking-tight leading-tight">
              Run returns on autopilot.
            </h2>
            <p className="text-[14px] text-muted mt-2 leading-relaxed">
              TrackBack handles return requests, refunds, cash-on-delivery payouts, store credit,
              gift cards, exchanges, live chat and analytics — in English and French, from your Shopify admin.
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11.5px] text-faint">
              <span className="inline-flex items-center gap-1">
                <Icon name="Clock3" size={12} /> ~8 min read
              </span>
              <span className="w-1 h-1 rounded-full bg-faint" />
              <span className="inline-flex items-center gap-1">
                <Icon name="Layers" size={12} /> {GROUPS.length} categories · {GROUPS.reduce((a, g) => a + g.sections.length, 0)} sections
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={() => switchTab("Get started")}
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md text-[12.5px] font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#6C63FF,#8B5CF6)" }}
              >
                <Icon name="Rocket" size={13} /> Get started
              </button>
              <Link
                to="/app/billing"
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md text-[12.5px] font-semibold text-ink bg-bg/40 border border-border hover:border-accent2 transition"
              >
                <Icon name="CreditCard" size={13} /> See pricing
              </Link>
            </div>
          </div>

          <div className="hidden md:grid grid-cols-2 gap-3 text-center min-w-[220px]">
            <Stat icon="Zap" label="Setup" value="< 5 min" />
            <Stat icon="Languages" label="Languages" value="EN · FR" />
            <Stat icon="Banknote" label="COD refunds" value="Built-in" />
            <Stat icon="Shield" label="GDPR & EU" value="Compliant" />
          </div>
        </div>
      </div>

      {/* ── Top tabs (sticky) ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 -mx-6 md:-mx-10 px-6 md:px-10 mb-6 bg-bg/90 backdrop-blur-md border-b border-divider">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {GROUPS.map((g) => {
            const isActive = g.label === activeTab;
            return (
              <button
                key={g.label}
                onClick={() => switchTab(g.label)}
                className={`relative inline-flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors whitespace-nowrap ${isActive ? "text-ink" : "text-muted hover:text-ink"
                  }`}
              >
                <Icon name={g.icon} size={14} className={isActive ? "text-accent2" : ""} strokeWidth={isActive ? 2.25 : 2} />
                <span>{g.label}</span>
                <span className="text-[10.5px] font-bold tabular-nums text-faint">
                  {g.sections.length}
                </span>
                {isActive && (
                  <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-gradient-to-r from-accent to-accent2 rounded-full shadow-[0_0_8px_rgba(108,99,255,0.6)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Active tab content ────────────────────────────────────────── */}
      <main className="space-y-12 min-w-0">
        {activeTab === "Get started" && (
          <>
            <Section id="getting-started" icon="Sparkles" title="Getting started" badge="New here?">
              <p>
                TrackBack lives inside your Shopify admin. Customers request returns from a branded
                portal on your store — in English or French — and you process everything from this
                dashboard. Every action is mirrored to Shopify's native returns, refunds and inventory.
              </p>
              <Steps>
                <Step n={1} title="Finish the setup wizard">
                  Reply-to email, return address, return window and policy. The address is sent to
                  customers when you approve a return. Track your progress in the{" "}
                  <DocLink to="/app">Dashboard</DocLink> checklist.
                </Step>
                <Step n={2} title="Choose how items come back">
                  In <DocLink to="/app/settings?tab=Returns%20%26%20fees">Settings → Returns & fees</DocLink>:
                  customer ships, prepaid label, drop-off in your store or pickup by your courier.
                </Step>
                <Step n={3} title="Pick your resolutions">
                  In <DocLink to="/app/settings?tab=Refunds">Settings → Refunds</DocLink>: refunds,
                  cash-on-delivery payouts, store credit with a bonus, gift cards, exchanges and green returns.
                </Step>
                <Step n={4} title="Put the portal on your store">
                  In <DocLink to="/app/settings?tab=Portal">Settings → Portal</DocLink>, add the Return
                  button theme block in one click, or link <Code>/apps/returns</Code> from your menu or footer.
                </Step>
              </Steps>
              <Callout kind="tip">
                You can preview your portal at any time via the{" "}
                <strong>Preview portal</strong> link in the sidebar.
              </Callout>
            </Section>

            <Section id="portal" icon="Globe" title="Customer portal">
              <p>
                The portal runs on your store domain at <Code>/apps/returns</Code> (Shopify App Proxy).
                By default it opens inside your theme, with your header and footer — switch to a
                full-page portal in <DocLink to="/app/settings">Settings → General</DocLink> if your theme
                conflicts. It speaks the customer's store language when you enable French.
              </p>
              <h4>The customer flow</h4>
              <Flow steps={["Order", "Items", "Reason & photos", "Refund & return method", "Confirm"]} />
              <ul>
                <li>Customers find their order with its number and their email — no account needed.</li>
                <li>
                  Items that can't be returned are shown with the reason: final sale, discounted,
                  not shipped yet, already returned or outside the return window.
                </li>
                <li>Fees and the store-credit bonus are shown before submitting; the server recalculates everything.</li>
                <li>
                  Orders paid on delivery: customers choose where to receive their refund — {MOBILE_MONEY},
                  bank transfer or cash.
                </li>
                <li>
                  After submitting, customers land on their <strong>return page</strong>: status timeline,
                  return instructions (address, label, store or pickup) and a form to add tracking.
                  Every email links back to it.
                </li>
              </ul>
              <h4>Links you can share</h4>
              <ul>
                <li><Code>/apps/returns</Code> — start a return</li>
                <li><Code>/apps/returns?mode=status</Code> — track a return</li>
                <li><Code>/apps/returns?mode=withdraw</Code> — EU withdrawal form (when enabled)</li>
              </ul>
              <Callout kind="info">
                Selling on another website too? Settings → Portal gives you a direct URL and an iframe
                snippet for Webflow, WordPress and co.
              </Callout>
            </Section>
          </>
        )}

        {activeTab === "Daily operations" && (
          <>
            <Section id="returns" icon="Package" title="Managing returns">
              <p>
                New requests land in <DocLink to="/app/returns">Returns</DocLink> with status{" "}
                <Tag>PENDING</Tag> — or are approved right away with auto-approval. Filter by status,
                period or search, act on several returns at once (approve, reject, mark received) and
                export the current view to CSV. Bulk actions send the same emails and Shopify updates as
                single ones.
              </p>
              <h4>Statuses</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 not-prose">
                {[
                  ["PENDING", "Waiting for your review", "#F59E0B"],
                  ["APPROVED", "Return instructions sent — waiting for the parcel", "#3B82F6"],
                  ["SHIPPED", "Tracking added by the customer or by you", "#10B981"],
                  ["RECEIVED", "Items received — ready to refund", "#8B5CF6"],
                  ["REFUNDED", "Refund, credit, gift card or exchange issued", "#22C55E"],
                  ["REJECTED", "Declined — customer notified with your reason", "#EF4444"],
                  ["EXPIRED", "Not shipped in time — customer notified", "#6B7280"],
                ].map(([k, d, c]) => (
                  <div key={k} className="flex items-center gap-2.5 p-3 rounded-md bg-bg/40 border border-border">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded ring-1 ring-inset"
                      style={{ background: c + "22", color: c, borderColor: c + "44" }}>
                      {k}
                    </span>
                    <span className="text-[12.5px] text-muted">{d}</span>
                  </div>
                ))}
              </div>
              <h4>On each return</h4>
              <ul>
                <li>A timeline of every step and email, plus internal notes for your team.</li>
                <li>The customer's photos, reasons and comments for each item.</li>
                <li>Carrier and tracking number — added by the customer from their return page, or by you.</li>
                <li>
                  A risk badge for customers who return often <TierBadge tier="pro" /> — blocklisted
                  emails can't submit new requests.
                </li>
              </ul>
              <Callout kind="tip">
                Approved returns that are never shipped expire automatically after the delay set in
                Settings → General, and the customer is notified.
              </Callout>
            </Section>

            <Section id="refunds" icon="Wallet" title="Refunds & exchanges">
              <p>
                Once the items are received, click <strong>Issue refund</strong> and choose the resolution.
                Items are restocked in Shopify and the customer gets an email with the details.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
                <Feature icon="CreditCard" title="Original payment">
                  Refunded on the customer's card through Shopify, minus any return fees.
                </Feature>
                <Feature icon="Banknote" title="Manual payout (cash on delivery)">
                  Send the money by mobile money, bank transfer or cash, then record it with its
                  reference. Shopify records the refund.
                </Feature>
                <Feature icon="Coins" title="Store credit · Starter">
                  Credited to the customer's Shopify store-credit balance, bonus included, and usable at checkout.
                </Feature>
                <Feature icon="Gift" title="Gift card · Starter">
                  A Shopify gift card code emailed to the customer — also works for guest orders.
                </Feature>
                <Feature icon="ArrowLeftRight" title="Exchange · Starter">
                  A Shopify draft order for the replacement, discounted by the returned value. Any extra
                  is paid through the emailed invoice; a lower price is refunded or credited.
                </Feature>
                <Feature icon="ShoppingBag" title="Shop Now · Pro">
                  Customers exchange for any product of your store, not only another size or color.
                </Feature>
              </div>
              <Callout kind="info">
                <strong>Green returns</strong> <TierBadge tier="starter" /> — below the amount you set,
                customers keep the item and you refund right after approval. These returns show a
                “Keep item” badge.
              </Callout>
              <h4>Automations <TierBadge tier="pro" /></h4>
              <ul>
                <li>Auto-approve only below a given amount, and never for high-risk customers.</li>
                <li>Issue store credit and exchanges as soon as the items are marked received — optionally card refunds too.</li>
                <li>Cash-on-delivery payouts always stay manual: you send the money yourself.</li>
              </ul>
              <Callout kind="warn">
                A return can only be refunded once: TrackBack locks it while the refund runs, so a
                double click or two teammates can't pay the customer twice.
              </Callout>
            </Section>

            <Section id="live-chat" icon="MessageCircle" title="Live chat & WhatsApp" badge="Pro plan">
              <p>
                Customers chat with you from the portal; conversations land in{" "}
                <DocLink to="/app/messages">Messages</DocLink> with an unread badge in the sidebar. If
                you haven't been active for 5 minutes, the message is also emailed to you.
              </p>
              <h4>WhatsApp</h4>
              <ul>
                <li>
                  Add your WhatsApp number in{" "}
                  <DocLink to="/app/settings?tab=Notifications">Settings → Notifications</DocLink>:
                  customers get a WhatsApp button on their return page.
                </li>
                <li>Each return shows a <strong>WhatsApp</strong> button with a ready-to-send message for its current status.</li>
                <li>
                  Optional: automatic WhatsApp updates at every status change through the Meta WhatsApp
                  Cloud API, with your own WhatsApp Business account and approved template.
                </li>
              </ul>
              <Callout kind="info">
                Toggle the portal chat and pick its bubble icon in{" "}
                <DocLink to="/app/portal-editor">Portal Editor → Live chat</DocLink>. The support chat
                with our team (lifebuoy button, bottom-right) works on every plan.
              </Callout>
            </Section>

            <Section id="analytics" icon="ChartLine" title="Analytics & reports">
              <p>
                <DocLink to="/app/analytics">Analytics</DocLink> shows the last 7 days on every plan.
                Starter and Pro add 30- and 90-day views with:
              </p>
              <ul>
                <li><strong>Return rate</strong> — returns compared with your Shopify orders over the period.</li>
                <li><strong>Retained revenue</strong> — refunds kept in your store as store credit, gift cards or exchanges.</li>
                <li>Resolutions, reasons, top returned products, processing time and fees collected.</li>
              </ul>
              <p>
                With the <strong>weekly report</strong> <TierBadge tier="starter" />, a summary of the
                past week lands in your inbox every Monday. Need raw data? Use <strong>Export CSV</strong>{" "}
                on the Returns page — it exports the current filters.
              </p>
            </Section>
          </>
        )}

        {activeTab === "Customize" && (
          <>
            <Section id="portal-editor" icon="Paintbrush" title="Portal editor" badge="Starter+">
              <p>
                Match the portal to your brand. The live preview on the right reflects every change.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
                <Feature icon="LayoutTemplate" title="Layouts">
                  Classic, minimal, bold, sidebar or compact.
                </Feature>
                <Feature icon="Palette" title="Theme">
                  Brand color, header background and logo.
                </Feature>
                <Feature icon="Languages" title="Texts per language">
                  Customize every label, description and button in English and French.
                </Feature>
                <Feature icon="MessageCircle" title="Live chat · Pro">
                  Enable the in-portal chat and pick its bubble icon.
                </Feature>
              </div>
              <Callout kind="tip">
                Hit <Kbd>Save</Kbd> to publish. Customers see the new portal instantly. On Pro, the
                white-label option removes the “Secured by TrackBack” mention.
              </Callout>
            </Section>

            <Section id="email-templates" icon="Mail" title="Email templates" badge="Starter+">
              <p>
                Eight emails, each in English and French: <strong>request received</strong>,{" "}
                <strong>approved</strong> (with the return instructions), <strong>rejected</strong>,{" "}
                <strong>shipped</strong>, <strong>received</strong>, <strong>refunded</strong>,{" "}
                <strong>expired</strong> and the <strong>EU withdrawal acknowledgment</strong>.
                Customers receive the language they used in the portal, and their replies go to your
                reply-to address. On Free, the built-in templates are sent.
              </p>
              <p>
                Edit them in <DocLink to="/app/email-templates">Email templates</DocLink>. Available variables:
              </p>
              <div className="not-prose flex flex-wrap gap-1.5 my-3">
                {EMAIL_VARIABLES.map((v) => (
                  <Code key={v}>{`{{${v}}}`}</Code>
                ))}
              </div>
              <Callout kind="tip">
                <Code>{`{{return_instructions}}`}</Code> adapts to the chosen method (address, label,
                store or pickup) and <Code>{`{{refund_details}}`}</Code> to the resolution (gift card code,
                payout reference…).
              </Callout>
            </Section>

            <Section id="settings" icon="Settings" title="Settings">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
                <FeatureLink to="/app/settings?tab=General" icon="Settings2" title="General">
                  Return window, address, reply-to email, languages, portal display, auto-approval and automations.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Eligibility" icon="ShieldCheck" title="Eligibility">
                  Final-sale SKUs, tags and product types, discounted items, one return per order, fraud protection.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Returns%20%26%20fees" icon="Truck" title="Returns & fees">
                  Return methods (ship, label, store, pickup), restocking and return shipping fees.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Refunds" icon="Wallet" title="Refunds">
                  Store credit and bonus, gift cards, exchanges, green returns, photos, cash-on-delivery payouts.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Reasons" icon="Tag" title="Reasons">
                  Your own return reasons, with photos required per reason.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Policy" icon="FileText" title="Policy">
                  Return policy shown in the portal and the EU withdrawal button.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Notifications" icon="Bell" title="Notifications">
                  WhatsApp, weekly report and Shopify order tags.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Integrations" icon="Webhook" title="Integrations">
                  Signed webhooks and REST API keys.
                </FeatureLink>
                <FeatureLink to="/app/settings?tab=Portal" icon="Globe" title="Portal">
                  Theme block, portal links and embed code.
                </FeatureLink>
              </div>
            </Section>

            <Section id="integrations" icon="Webhook" title="Webhooks & API" badge="Pro plan">
              <h4>Webhooks</h4>
              <p>
                Add an HTTPS endpoint in{" "}
                <DocLink to="/app/settings?tab=Integrations">Settings → Integrations</DocLink>. TrackBack
                sends a JSON <Code>POST</Code> for <Code>return.created</Code>, <Code>return.approved</Code>,{" "}
                <Code>return.rejected</Code>, <Code>return.shipped</Code>, <Code>return.received</Code>,{" "}
                <Code>return.refunded</Code> and <Code>return.expired</Code>.
              </p>
              <p>
                Each request carries <Code>X-TrackBack-Event</Code> and{" "}
                <Code>X-TrackBack-Signature: sha256=…</Code> — the HMAC-SHA256 of the raw body with your
                signing secret. Use <strong>Send test event</strong> to check your endpoint.
              </p>
              <h4>REST API</h4>
              <p>Generate a key in the same tab, then read your returns from your ERP, WMS or spreadsheet:</p>
              <CodeBlock>{`GET /api/v1/returns?status=PENDING&updated_since=2026-01-01T00:00:00Z&limit=50
GET /api/v1/returns/{rma}
Authorization: Bearer tb_live_…`}</CodeBlock>
              <Callout kind="info">
                The key is shown once — store it safely. Regenerating it revokes the previous one.
              </Callout>
            </Section>
          </>
        )}

        {activeTab === "Reference" && (
          <>
            <Section id="billing" icon="CreditCard" title="Billing & plans">
              <p>
                Manage your subscription from <DocLink to="/app/billing">Billing</DocLink>. Plans use
                Shopify's native billing — you pay through your Shopify invoice. Annual plans save{" "}
                {ANNUAL_DISCOUNT_PCT}%.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 not-prose">
                {PLANS.map((p) => (
                  <PlanCard
                    key={p.id}
                    name={`${p.name} · ${p.summary}`}
                    price={`$${p.price}`}
                    note={p.annualPrice ? `or $${p.annualPrice}/year` : "Free forever"}
                    features={p.features}
                    popular={p.popular}
                  />
                ))}
              </div>
              <Callout kind="info">
                The monthly limit counts return requests (EU withdrawals are never blocked). When it's
                reached, the portal asks customers to contact you until next month or until you upgrade.
                Downgrading keeps your data and settings; features above your plan are simply locked.
              </Callout>
            </Section>

            <Section id="compliance" icon="ShieldCheck" title="GDPR & EU withdrawal">
              <p>TrackBack handles Shopify's mandatory privacy webhooks:</p>
              <ul>
                <li>
                  <Code>customers/data_request</Code> — we email your reply-to address a structured export
                  of the customer's returns, payout details, photos and chat messages.
                </li>
                <li>
                  <Code>customers/redact</Code> — we delete the customer's returns, photos and conversations.
                </li>
                <li>
                  <Code>shop/redact</Code> — 48h after uninstall, all data tied to your shop is deleted.
                </li>
              </ul>
              <p>
                All webhooks are HMAC-verified. Payout account numbers are masked in emails, and we never
                store payment card data — billing is fully handled by Shopify.
              </p>
              <h4>EU withdrawal button</h4>
              <p>
                Since 19 June 2026 (Directive 2023/2673), stores selling to EU consumers must offer an
                online withdrawal function. Enable it in{" "}
                <DocLink to="/app/settings?tab=Policy">Settings → Policy</DocLink>, then add a footer link
                “Withdraw from contract here” to <Code>/apps/returns?mode=withdraw</Code>. Customers
                confirm in two steps without an account and immediately receive an acknowledgment email;
                you'll find the request in Returns.
              </p>
            </Section>

            <Section id="faq" icon="MessageCircleQuestionMark" title="FAQ">
              <Faq q="My customers pay on delivery — how do refunds work?">
                They enter their mobile money number or bank details in the portal. You send the money,
                then click <strong>Issue refund → Manual payout</strong> and add the transaction reference.
                Shopify records the refund, the items are restocked and the customer is notified.
              </Faq>
              <Faq q="Can customers exchange for another size?">
                Yes, on Starter and Pro: they pick the replacement variant in the portal and out-of-stock
                options are disabled. Pro adds “Shop Now” to exchange for any product.
              </Faq>
              <Faq q="Why can't a customer find an older order?">
                Shopify only gives apps access to the last 60 days of orders by default. Keep your return
                window within 60 days, or contact us if you need longer windows.
              </Faq>
              <Faq q="Can I auto-approve returns?">
                Yes, on every plan: turn on <strong>Auto-approve returns</strong> in Settings → General.
                Pro adds conditions (maximum amount, skip high-risk customers) and automatic refunds on receipt.
              </Faq>
              <Faq q="What happens when I uninstall the app?">
                Your data is kept for 48 hours, then permanently deleted per Shopify's mandatory{" "}
                <Code>shop/redact</Code> webhook.
              </Faq>
              <Faq q="How do I contact support?">
                Click the lifebuoy button at the bottom-right of any admin page. Our team will reply
                within a few hours via the chat.
              </Faq>
            </Section>
          </>
        )}

        {/* ── Previous / Next tab navigation ───────────────────────── */}
        {(prevGroup || nextGroup) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {prevGroup ? (
              <button
                onClick={() => switchTab(prevGroup.label)}
                className="group flex items-center gap-3 p-4 rounded-lg border border-border bg-bg/30 hover:bg-bg/60 hover:border-accent2 transition text-left"
              >
                <Icon name="ChevronLeft" size={16} className="text-muted group-hover:text-accent2 group-hover:-translate-x-0.5 transition shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold">Previous</div>
                  <div className="text-[13px] font-semibold text-ink truncate">{prevGroup.label}</div>
                </div>
                <Icon name={prevGroup.icon} size={14} className="text-faint group-hover:text-accent2 transition shrink-0" />
              </button>
            ) : <div className="hidden sm:block" />}
            {nextGroup ? (
              <button
                onClick={() => switchTab(nextGroup.label)}
                className="group flex items-center gap-3 p-4 rounded-lg border border-border bg-bg/30 hover:bg-bg/60 hover:border-accent2 transition text-left sm:text-right sm:flex-row-reverse"
              >
                <Icon name="ChevronRight" size={16} className="text-muted group-hover:text-accent2 group-hover:translate-x-0.5 transition shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold">Next</div>
                  <div className="text-[13px] font-semibold text-ink truncate">{nextGroup.label}</div>
                </div>
                <Icon name={nextGroup.icon} size={14} className="text-faint group-hover:text-accent2 transition shrink-0" />
              </button>
            ) : <div className="hidden sm:block" />}
          </div>
        )}

        {/* ── Footer CTA ───────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 md:p-8 mt-8 animate-slideUp">
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 60% 70% at 50% 0%, rgba(108,99,255,0.18), transparent 60%)",
            }}
          />
          <div className="relative flex flex-col md:flex-row items-center md:items-start gap-5 md:gap-8 text-center md:text-left">
            <div className="w-12 h-12 rounded-full grid place-content-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)', boxShadow: '0 8px 22px -8px rgba(108,99,255,0.6)' }}>
              <Icon name="Heart" size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-semibold text-ink">Still have questions?</div>
              <div className="text-[13px] text-muted mt-1">
                Real humans on the other side. We typically reply within an hour.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center md:justify-end shrink-0">
              <a href="mailto:bernadoecom@gmail.com"
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md text-[12.5px] font-semibold text-white"
                style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                <Icon name="Mail" size={13} /> Email support
              </a>
              <a href="https://return-flow-web.vercel.app/changelog.html" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-md text-[12.5px] font-semibold text-ink bg-bg/40 border border-border hover:border-accent2 transition">
                <Icon name="Sparkles" size={13} /> Changelog
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Section({ id, icon, title, badge, children }: {
  id: string;
  icon: string;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const copyAnchor = () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast?.({ kind: 'success', title: 'Link copied' }),
      () => {/* ignore */ },
    );
  };

  return (
    <section id={id} className="scroll-mt-20 animate-slideUp">
      <div className="group flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-lg grid place-content-center text-white shrink-0"
          style={{
            background: "linear-gradient(135deg,#6C63FF,#8B5CF6)",
            boxShadow: "0 4px 14px -2px rgba(108,99,255,0.5)",
          }}
        >
          <Icon name={icon} size={16} strokeWidth={2.25} />
        </div>
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">{title}</h2>
        {badge && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset"
            style={{
              background: "rgba(108,99,255,0.14)",
              color: "#8B85FF",
              borderColor: "rgba(108,99,255,0.25)",
            }}
          >
            {badge}
          </span>
        )}
        <button
          onClick={copyAnchor}
          title="Copy link to this section"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-md grid place-content-center text-faint hover:text-accent2 hover:bg-bg/60 transition"
        >
          <Icon name="Link2" size={13} />
        </button>
      </div>
      <div className="prose-rf">{children}</div>
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <div className="not-prose grid gap-3 my-5">{children}</div>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-bg/40 border border-border hover:border-accent2 hover:translate-y-[-1px] transition-all duration-200">
      <div
        className="w-7 h-7 rounded-md grid place-content-center text-white text-[12px] font-bold shrink-0"
        style={{ background: "linear-gradient(135deg,#6C63FF,#8B5CF6)" }}
      >
        {n}
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-ink mb-0.5">{title}</div>
        <div className="text-[13px] text-muted leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Callout({ kind, children }: { kind: "tip" | "info" | "warn"; children: ReactNode }) {
  const cfg = {
    tip: { color: "#22C55E", bg: "rgba(34,197,94,0.10)", icon: "Lightbulb" },
    info: { color: "#3B82F6", bg: "rgba(59,130,246,0.10)", icon: "Info" },
    warn: { color: "#F59E0B", bg: "rgba(245,158,11,0.10)", icon: "TriangleAlert" },
  }[kind];
  return (
    <div
      className="not-prose my-4 flex items-start gap-3 p-3.5 rounded-lg border"
      style={{ background: cfg.bg, borderColor: cfg.color + "33" }}
    >
      <Icon name={cfg.icon} size={15} style={{ color: cfg.color }} className="mt-0.5 shrink-0" />
      <div className="text-[13px] text-ink leading-relaxed">{children}</div>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="p-3.5 rounded-lg bg-bg/40 border border-border hover:border-accent2 hover:translate-y-[-1px] transition-all duration-200">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon name={icon} size={14} className="text-accent2" />
        <div className="text-[12.5px] font-semibold text-ink">{title}</div>
      </div>
      <div className="text-[12.5px] text-muted leading-relaxed">{children}</div>
    </div>
  );
}

function FeatureLink({ to, icon, title, children }: { to: string; icon: string; title: string; children: ReactNode }) {
  return (
    <Link to={to} className="block">
      <Feature icon={icon} title={title}>{children}</Feature>
    </Link>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="not-prose my-4 p-3.5 rounded-lg bg-[#0f1117] border border-border text-[#e2e8f0] font-mono text-[11.5px] leading-relaxed overflow-x-auto">
      {children}
    </pre>
  );
}

function PlanCard({ name, price, note, features, popular }: { name: string; price: string; note?: string; features: string[]; popular?: boolean }) {
  return (
    <div
      className={`p-4 rounded-lg border transition-all duration-200 hover:translate-y-[-2px] ${popular ? "border-accent shadow-[0_0_0_1px_rgba(108,99,255,0.3),0_10px_30px_-10px_rgba(108,99,255,0.3)]" : "border-border bg-bg/40"
        }`}
      style={popular ? { background: "rgba(108,99,255,0.06)" } : undefined}
    >
      {popular && (
        <div className="text-[9.5px] font-bold uppercase tracking-wider text-accent2 mb-1.5">
          ⭐ Popular
        </div>
      )}
      <div className="text-[14px] font-semibold text-ink">{name}</div>
      <div className="text-[22px] font-bold text-ink mt-0.5">
        {price}<span className="text-[12px] font-normal text-muted">/mo</span>
      </div>
      {note && <div className="text-[11px] text-muted mt-0.5">{note}</div>}
      <ul className="mt-3 space-y-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-[12px] text-ink">
            <Icon name="Check" size={11} strokeWidth={2.5} className="mt-0.5 shrink-0 text-accent2" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="not-prose border-b border-divider last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 py-3.5 text-left group"
        aria-expanded={open}
      >
        <span className="text-[13.5px] font-semibold text-ink group-hover:text-accent2 transition-colors">
          {q}
        </span>
        <Icon
          name="ChevronDown"
          size={14}
          className="text-muted transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <div
        className="grid transition-all duration-300 ease-smooth"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="text-[13px] text-muted leading-relaxed pb-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <div className="not-prose flex items-center gap-1 my-5 overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1 shrink-0">
          <div className="px-2.5 py-1 rounded-md bg-bg/40 border border-border text-[11.5px] font-medium text-ink">
            {s}
          </div>
          {i < steps.length - 1 && (
            <Icon name="ChevronRight" size={13} className="text-faint" />
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-bg/40 border border-border">
      <div className="flex items-center justify-center gap-1.5 mb-0.5">
        <Icon name={icon} size={12} className="text-accent2" />
        <div className="text-[10.5px] uppercase tracking-wide text-faint font-semibold">{label}</div>
      </div>
      <div className="text-[14px] font-bold text-ink">{value}</div>
    </div>
  );
}

function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-accent2 hover:text-accent underline underline-offset-2 decoration-accent2/40 hover:decoration-accent transition-colors"
    >
      {children}
    </Link>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-[11.5px] font-mono bg-bg/60 border border-border text-accent2">
      {children}
    </code>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded border border-border bg-bg/60 text-[11px] font-mono text-ink">
      {children}
    </kbd>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ring-inset"
      style={{ background: "rgba(245,158,11,0.14)", color: "#F59E0B", borderColor: "rgba(245,158,11,0.25)" }}
    >
      {children}
    </span>
  );
}
