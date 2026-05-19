import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader, Icon, useToast } from "../components/ui";

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
      { id: "getting-started", title: "Getting started",  icon: "Sparkles" },
      { id: "portal",          title: "Customer portal",  icon: "Globe" },
    ],
  },
  {
    label: "Daily operations",
    icon: "Zap",
    sections: [
      { id: "returns",         title: "Managing returns", icon: "Package" },
      { id: "live-chat",       title: "Live chat",        icon: "MessageCircle" },
    ],
  },
  {
    label: "Customize",
    icon: "Paintbrush",
    sections: [
      { id: "portal-editor",   title: "Portal editor",    icon: "Paintbrush" },
      { id: "email-templates", title: "Email templates",  icon: "Mail" },
      { id: "settings",        title: "Settings",         icon: "Settings" },
    ],
  },
  {
    label: "Reference",
    icon: "BookOpen",
    sections: [
      { id: "billing",         title: "Billing & plans",  icon: "CreditCard" },
      { id: "compliance",      title: "GDPR & privacy",   icon: "ShieldCheck" },
      { id: "faq",             title: "FAQ",              icon: "MessageCircleQuestion" },
    ],
  },
];

// Helper: which group contains a given section id?
function findGroupOfSection(sectionId: string): GroupDef | undefined {
  return GROUPS.find((g) => g.sections.some((s) => s.id === sectionId));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<string>(GROUPS[0].label);
  const [progress, setProgress] = useState(0);

  const activeIndex = GROUPS.findIndex((g) => g.label === activeTab);
  const activeGroup = GROUPS[activeIndex];
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
        subtitle="Everything you need to set up, run and grow with ReturnFlow."
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
              ReturnFlow handles RMA requests, refunds, store credit, exchanges,
              live chat and analytics — all from your Shopify admin.
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11.5px] text-faint">
              <span className="inline-flex items-center gap-1">
                <Icon name="Clock3" size={12} /> ~5 min read
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
            <Stat icon="Package" label="RMAs" value="Unlimited" />
            <Stat icon="MessageCircle" label="Chat" value="Built-in" />
            <Stat icon="Shield" label="GDPR" value="Compliant" />
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
                className={`relative inline-flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors whitespace-nowrap ${
                  isActive ? "text-ink" : "text-muted hover:text-ink"
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
                ReturnFlow lives inside your Shopify admin. Once installed, your
                customers can request returns from a branded portal you control,
                and you process them from this dashboard.
              </p>
              <Steps>
                <Step n={1} title="Configure your settings">
                  Visit <DocLink to="/app/settings">Settings</DocLink> to set your
                  return window, return address, blocklist and refund options.
                </Step>
                <Step n={2} title="Customize your portal">
                  Head to <DocLink to="/app/portal-editor">Portal Editor</DocLink>
                  {" "}to add your logo, brand colors and tweak the layout.
                </Step>
                <Step n={3} title="Expose the portal">
                  In <DocLink to="/app/settings?tab=Portal">Settings → Portal</DocLink>,
                  copy your portal URL and link it from your storefront navigation
                  or footer.
                </Step>
                <Step n={4} title="Process returns">
                  Customers submit returns → they appear in{" "}
                  <DocLink to="/app/returns">Returns</DocLink>. Approve, refund or
                  ship a label in one click.
                </Step>
              </Steps>
              <Callout kind="tip">
                You can preview your portal at any time via the{" "}
                <strong>Preview portal</strong> link in the sidebar.
              </Callout>
            </Section>

            <Section id="portal" icon="Globe" title="Customer portal">
              <p>
                The portal is where customers file return requests. It runs on
                your store URL (via Shopify App Proxy) and is fully branded.
              </p>
              <h4>Exposing your portal</h4>
              <p>You have three ways to expose it:</p>
              <ul>
                <li>
                  <strong>Link in your store navigation</strong> — add{" "}
                  <Code>/apps/returns</Code> as a menu item in Shopify
                  Online Store → Navigation.
                </li>
                <li>
                  <strong>Share a direct URL</strong> — useful for email
                  campaigns or order confirmations.
                </li>
                <li>
                  <strong>Embed</strong> — paste an iframe snippet on any of your
                  pages (Webflow, WordPress, Squarespace…).
                </li>
              </ul>
              <p>
                All snippets are available in{" "}
                <DocLink to="/app/settings?tab=Portal">Settings → Portal</DocLink>.
              </p>
              <h4>The customer flow</h4>
              <Flow steps={["Find order", "Select items", "Reason", "Refund type", "Confirm"]} />
            </Section>
          </>
        )}

        {activeTab === "Daily operations" && (
          <>
            <Section id="returns" icon="Package" title="Managing returns">
              <p>
                When a customer submits a return, it lands in{" "}
                <DocLink to="/app/returns">Returns</DocLink> with status{" "}
                <Tag>PENDING</Tag>.
              </p>
              <h4>Statuses</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 not-prose">
                {[
                  ["PENDING", "Waiting for your review", "#F59E0B"],
                  ["APPROVED", "Approved — label sent if applicable", "#3B82F6"],
                  ["SHIPPED", "Customer marked as shipped (tracking added)", "#3B82F6"],
                  ["RECEIVED", "Items received at your warehouse", "#22C55E"],
                  ["REFUNDED", "Refund processed via Shopify", "#22C55E"],
                  ["REJECTED", "Request denied — customer notified", "#EF4444"],
                  ["EXPIRED", "Auto-expired after grace period", "#5B5F75"],
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
              <h4>Refund types</h4>
              <ul>
                <li><strong>Original payment</strong> — refund to the card/method used.</li>
                <li><strong>Store credit</strong> — issue a discount code, optionally with a bonus % (configurable in Settings).</li>
                <li><strong>Exchange</strong> — let the customer request a different item; you fulfill via a Shopify draft order.</li>
              </ul>
            </Section>

            <Section id="live-chat" icon="MessageCircle" title="Live chat" badge="Pro plan">
              <p>
                Customers can chat with you directly from the portal. The
                merchant inbox lives at <DocLink to="/app/messages">Messages</DocLink>.
              </p>
              <Callout kind="info">
                Live chat with customers is available on the <strong>Pro</strong>{" "}
                plan. The merchant-to-support chat (the lifebuoy button bottom-right)
                works on all plans.
              </Callout>
              <h4>How it works</h4>
              <ul>
                <li>Customer clicks the chat bubble at the bottom-right of the portal.</li>
                <li>Their message lands in your <strong>Messages</strong> inbox with a red unread badge in the sidebar.</li>
                <li>If you are offline for more than 5 minutes, an email is sent to your store address (configured in Settings → General).</li>
                <li>Polling refreshes the inbox every 4 seconds in real time.</li>
              </ul>
              <h4>Enabling / disabling</h4>
              <p>
                Toggle the chat from{" "}
                <DocLink to="/app/portal-editor">Portal Editor → Live chat</DocLink>.
                You can also pick the bubble icon (chat, mail, headphones, …).
                If your plan is below Pro, the toggle is locked.
              </p>
            </Section>
          </>
        )}

        {activeTab === "Customize" && (
          <>
            <Section id="portal-editor" icon="Paintbrush" title="Portal editor">
              <p>
                Match the portal to your brand. Live preview on the right
                reflects every change.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
                <Feature icon="Palette" title="Theme">
                  Brand color, header background.
                </Feature>
                <Feature icon="Store" title="Header">
                  Store name and logo (upload to Cloudinary).
                </Feature>
                <Feature icon="Type" title="Texts">
                  Customize every label, description and CTA.
                </Feature>
                <Feature icon="MessageCircle" title="Live chat">
                  Enable/disable the in-portal chat widget and pick its bubble icon (Pro plan).
                </Feature>
              </div>
              <Callout kind="tip">
                Hit <Kbd>Save</Kbd> to publish. Customers see the new portal
                instantly — no rebuild required.
              </Callout>
            </Section>

            <Section id="email-templates" icon="Mail" title="Email templates" badge="Starter+">
              <p>
                Every status change can trigger an email to the customer.
                Templates support variables like{" "}
                <Code>{`{{customer_name}}`}</Code>, <Code>{`{{rma_number}}`}</Code>,{" "}
                <Code>{`{{order_number}}`}</Code>, <Code>{`{{refund_amount}}`}</Code>.
              </p>
              <p>
                Edit templates in{" "}
                <DocLink to="/app/email-templates">Email templates</DocLink>.
                Available types:
              </p>
              <ul>
                <li><strong>Request Received</strong> — confirmation right after a customer files a return.</li>
                <li><strong>Approved</strong> — sent when you approve a return (optionally with a shipping label).</li>
                <li><strong>Rejected</strong> — sent when you reject, with reason.</li>
                <li><strong>Refunded</strong> — sent when the refund is processed (with store credit code if applicable).</li>
                <li><strong>Shipped</strong> — sent when the customer adds tracking from the portal.</li>
              </ul>
            </Section>

            <Section id="settings" icon="Settings" title="Settings">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
                <Feature icon="Settings2" title="General">
                  Return window, auto-approve, blocklist, sender email,
                  refund options (store credit, exchanges, bonus %).
                </Feature>
                <Feature icon="Tag" title="Reasons">
                  Custom return reasons shown to customers.
                </Feature>
                <Feature icon="Mail" title="Emails">
                  Customize every email template (see above).
                </Feature>
                <Feature icon="FileText" title="Policy">
                  Edit your public return policy displayed on the portal.
                </Feature>
                <Feature icon="Globe" title="Portal">
                  Get your portal URL, embed code, and the theme block link.
                </Feature>
              </div>
            </Section>
          </>
        )}

        {activeTab === "Reference" && (
          <>
            <Section id="billing" icon="CreditCard" title="Billing & plans">
              <p>
                Manage your subscription from{" "}
                <DocLink to="/app/billing">Billing</DocLink>. Plans use Shopify's
                native billing API — you pay through your Shopify invoice.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 not-prose">
                <PlanCard name="Free" price="$0" features={["10 returns/mo", "Email notifications", "Basic analytics"]} />
                <PlanCard name="Starter" price="$19" features={["100 returns/mo", "Branding & logo", "Email templates", "Advanced analytics"]} popular />
                <PlanCard name="Pro" price="$49" features={["Unlimited returns", "Live chat with customers", "API access", "White-label portal"]} />
              </div>
              <Callout kind="info">
                No trial period — you pay only for the months you use. Cancel anytime
                and you'll be downgraded back to Free at the end of the current billing cycle.
              </Callout>
            </Section>

            <Section id="compliance" icon="ShieldCheck" title="GDPR & privacy">
              <p>
                ReturnFlow is built with mandatory Shopify compliance webhooks:
              </p>
              <ul>
                <li>
                  <Code>customers/data_request</Code> — when a customer asks for
                  a copy of their data, we email the merchant a structured export
                  of all RMAs and chat messages we hold for that customer.
                </li>
                <li>
                  <Code>customers/redact</Code> — when a customer requests
                  deletion, we permanently remove all their data tied to your shop.
                </li>
                <li>
                  <Code>shop/redact</Code> — 48h after app uninstall, we delete
                  all data tied to your shop.
                </li>
              </ul>
              <p>
                All webhooks are HMAC-verified using your app's secret. We never
                store payment card data — billing is fully handled by Shopify.
              </p>
            </Section>

            <Section id="faq" icon="MessageCircleQuestion" title="FAQ">
              <Faq q="Can I import historical returns?">
                Not yet. We're working on a CSV import — reach out via the chat
                button if you need this urgently.
              </Faq>
              <Faq q="Does ReturnFlow handle international returns?">
                Yes. You can configure your return address in Settings → General.
                Shipping label generation depends on your carrier integration.
              </Faq>
              <Faq q="Can I auto-approve all returns?">
                Yes. Toggle <strong>Auto-approve returns</strong> in Settings →
                General. Useful for low-fraud product categories.
              </Faq>
              <Faq q="What happens when I uninstall the app?">
                Your data is kept for 48 hours, then permanently deleted per
                Shopify's mandatory <Code>shop/redact</Code> webhook.
              </Faq>
              <Faq q="How do I contact support?">
                Click the lifebuoy button at the bottom-right of any admin
                page. Our team will reply within a few hours via the chat.
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
      () => {/* ignore */},
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
    tip:  { color: "#22C55E", bg: "rgba(34,197,94,0.10)", icon: "Lightbulb" },
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

function PlanCard({ name, price, features, popular }: { name: string; price: string; features: string[]; popular?: boolean }) {
  return (
    <div
      className={`p-4 rounded-lg border transition-all duration-200 hover:translate-y-[-2px] ${
        popular ? "border-accent shadow-[0_0_0_1px_rgba(108,99,255,0.3),0_10px_30px_-10px_rgba(108,99,255,0.3)]" : "border-border bg-bg/40"
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
