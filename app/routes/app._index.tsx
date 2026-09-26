import { Link, useLocation, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, StatusBadge, Card, PageHeader } from "../components/ui";
import { syncReturnsForShop } from "../lib/returns-sync.server";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoney } from "../lib/money";
import { getShopPlan } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";
import { realReturnAddress } from "../lib/notifications.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Throttled (10 min) import of returns created directly in the Shopify Admin.
  await syncReturnsForShop(shop, admin);

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [grouped, refundedAgg, recent, settings, currency, reasonRows, withdrawalsPending, riskyPending, plan] = await Promise.all([
    prisma.returnRequest.groupBy({ by: ['status'], where: { shop }, _count: { _all: true } }),
    prisma.returnRequest.aggregate({
      where: { shop, status: 'REFUNDED', refundedAt: { gte: firstDayOfMonth } },
      _sum: { refundAmount: true },
    }),
    prisma.returnRequest.findMany({
      where: { shop },
      include: { items: { select: { quantity: true, reason: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    getShopCurrency(shop, admin),
    prisma.returnItem.groupBy({
      by: ['reason'],
      where: { returnRequest: { shop } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    }),
    prisma.returnRequest.count({ where: { shop, requestType: 'WITHDRAWAL', status: 'PENDING' } }),
    prisma.returnRequest.count({ where: { shop, status: 'PENDING', riskLevel: 'high' } }),
    getShopPlan(shop),
  ]);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }

  return {
    shop,
    currency,
    counts,
    total,
    refundedThisMonth: refundedAgg._sum.refundAmount ?? 0,
    withdrawalsPending,
    riskyPending: hasFeature(plan, 'fraud') ? riskyPending : 0,
    reasons: reasonRows.map((r) => ({ name: r.reason, count: r._sum.quantity ?? 0 })),
    recent: recent.map((r) => ({
      rma: r.rma,
      order: r.orderName,
      customer: r.customerName || r.customerEmail.split('@')[0],
      itemsCount: r.items.reduce((s, i) => s + i.quantity, 0),
      reason: r.items[0]?.reason || 'N/A',
      date: new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: r.status,
    })),
    checklist: {
      onboarding: !!settings?.onboardingCompletedAt,
      address: !!realReturnAddress(settings?.returnAddress),
      sender: !!settings?.fromEmail && settings.fromEmail !== 'returns@acmestore.com',
      logo: !!settings?.logoUrl,
      methods: !!settings?.returnMethods,
    },
  };
};

function KpiCard({ label, value, sub, subTone, icon, accentColor }: any) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 relative overflow-hidden group rf-lift rf-hairline hover:border-[#3a3e58]">
      {/* Animated gradient ring on hover */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(120px 80px at 100% 0%, ${accentColor}1A, transparent 70%)`,
        }} />

      <div className="flex items-start justify-between relative">
        <div className="text-[12px] font-medium text-muted uppercase tracking-wider">{label}</div>
        <div className="w-9 h-9 rounded-lg grid place-content-center transition-transform duration-300 ease-spring group-hover:scale-110 group-hover:-rotate-3"
          style={{
            background: `linear-gradient(135deg, ${accentColor}28, ${accentColor}10)`,
            color: accentColor,
            boxShadow: `inset 0 1px 0 ${accentColor}1F, 0 2px 8px -2px ${accentColor}25`,
          }}>
          <Icon name={icon} size={16} strokeWidth={2.25} />
        </div>
      </div>
      <div className="mt-3 text-[28px] font-semibold text-ink tracking-tight tabular-nums leading-none">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
        <span className="font-medium" style={{ color: subTone === 'ok' ? '#22C55E' : subTone === 'warn' ? '#F59E0B' : '#8B8FA8' }}>{sub}</span>
      </div>

      {/* Decorative orb */}
      <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full opacity-[0.06] pointer-events-none transition-all duration-500 ease-smooth group-hover:opacity-[0.12] group-hover:scale-110"
        style={{ background: `radial-gradient(circle, ${accentColor} 0%, transparent 70%)` }} />
    </div>
  );
}

export default function DashboardPage() {
  const { shop, currency, counts, total, refundedThisMonth, withdrawalsPending, riskyPending, reasons, recent, checklist: cl } = useLoaderData<typeof loader>();
  const location = useLocation();
  const search = location.search;
  const withParam = (path: string, param: string) => `${path}${search}${search ? '&' : '?'}${param}`;

  const pendingCount = counts.PENDING ?? 0;
  const approvedCount = counts.APPROVED ?? 0;
  const shippedCount = counts.SHIPPED ?? 0;
  const receivedCount = counts.RECEIVED ?? 0;

  const actionItems = [
    ...(pendingCount > 0 ? [{ label: `${pendingCount} pending return${pendingCount > 1 ? 's' : ''} awaiting review`, icon: 'Clock', color: '#F59E0B', link: withParam('/app/returns', 'tab=Pending') }] : []),
    ...(withdrawalsPending > 0 ? [{ label: `${withdrawalsPending} EU withdrawal${withdrawalsPending > 1 ? 's' : ''} to process (14-day refund deadline)`, icon: 'FileX', color: '#F59E0B', link: withParam('/app/returns', 'tab=Pending') }] : []),
    ...(riskyPending > 0 ? [{ label: `${riskyPending} pending request${riskyPending > 1 ? 's' : ''} from high-risk customers`, icon: 'ShieldAlert', color: '#EF4444', link: withParam('/app/returns', 'tab=Pending') }] : []),
    ...(receivedCount > 0 ? [{ label: `${receivedCount} received — ready to refund`, icon: 'PackageCheck', color: '#8B5CF6', link: withParam('/app/returns', 'tab=Received') }] : []),
    ...(approvedCount > 0 ? [{ label: `${approvedCount} approved — awaiting customer shipment`, icon: 'Package', color: '#3B82F6', link: withParam('/app/returns', 'tab=Approved') }] : []),
    ...(shippedCount > 0 ? [{ label: `${shippedCount} package${shippedCount > 1 ? 's' : ''} in transit`, icon: 'Truck', color: '#10B981', link: withParam('/app/returns', 'tab=Shipped') }] : []),
  ];

  const checklist = [
    { label: 'Install TrackBack', done: true },
    { label: 'Complete the setup wizard', done: cl.onboarding },
    { label: 'Set a real return address', done: cl.address },
    { label: 'Set your reply-to email', done: cl.sender },
    { label: 'Choose your return methods', done: cl.methods },
    { label: 'Upload your logo', done: cl.logo },
  ];
  const completedCount = checklist.filter(c => c.done).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const reasonTotal = reasons.reduce((s, r) => s + r.count, 0);
  const colors = ['#6C63FF', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444'];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{greeting}, {shop.split('.')[0]} <span className="ml-1">👋</span></>}
        subtitle={today} />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 rf-stagger">
        <KpiCard label="Pending Review" value={pendingCount} sub="Requires action" subTone="warn" icon="Clock" accentColor="#F59E0B" />
        <KpiCard label="In Transit" value={shippedCount} sub="Awaiting receipt" subTone="ok" icon="Truck" accentColor="#10B981" />
        <KpiCard label="Refunded This Month" value={formatMoney(refundedThisMonth, currency)} sub="Total value" subTone="ok" icon="DollarSign" accentColor="#22C55E" />
        <KpiCard label="Total Returns" value={total} sub="All time" subTone="muted" icon="TrendingDown" accentColor="#6C63FF" />
      </div>

      {/* Action items (AfterShip-style to-do) */}
      {actionItems.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-5 rf-hairline animate-slideUp">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-md grid place-content-center shadow-[inset_0_1px_0_rgba(245,158,11,0.2)]"
              style={{ background: 'linear-gradient(135deg,#F59E0B28,#F59E0B10)', color: '#F59E0B' }}>
              <Icon name="ListChecks" size={14} />
            </div>
            <span className="text-[13px] font-semibold text-ink tracking-tight">Action items</span>
            <span className="ml-auto text-[11.5px] px-2 py-0.5 rounded-full font-semibold ring-1 ring-inset ring-warn/20"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
              {actionItems.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {actionItems.map((item, i) => (
              <Link key={i} to={item.link}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/[0.05] transition-all duration-200 ease-smooth group hover:translate-x-[2px]">
                <div className="w-8 h-8 rounded-lg grid place-content-center shrink-0 transition-transform duration-200 group-hover:scale-110"
                  style={{
                    background: `linear-gradient(135deg, ${item.color}28, ${item.color}10)`,
                    color: item.color,
                    boxShadow: `inset 0 1px 0 ${item.color}1F`,
                  }}>
                  <Icon name={item.icon} size={14} />
                </div>
                <span className="text-[13px] text-muted group-hover:text-ink transition-colors flex-1">{item.label}</span>
                <Icon name="ArrowRight" size={13} className="text-faint group-hover:text-accent2 group-hover:translate-x-1 transition-all duration-200" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent returns */}
      <Card
        title="Recent Returns"
        subtitle="Latest 5 requests across all statuses"
        action={
          <Link to={`/app/returns${location.search}`}
            className="text-[12.5px] text-accent2 hover:text-white transition-colors flex items-center gap-1 font-medium">
            View all <Icon name="ArrowRight" size={12} />
          </Link>
        }>
        <div className="-mx-5 -mb-5 border-t border-divider">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] whitespace-nowrap min-w-[700px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-faint">
                  <th className="text-left font-semibold py-2.5 px-5">RMA</th>
                  <th className="text-left font-semibold py-2.5">Order</th>
                  <th className="text-left font-semibold py-2.5">Customer</th>
                  <th className="text-left font-semibold py-2.5">Items</th>
                  <th className="text-left font-semibold py-2.5">Reason</th>
                  <th className="text-left font-semibold py-2.5">Date</th>
                  <th className="text-left font-semibold py-2.5">Status</th>
                  <th className="text-right font-semibold py-2.5 px-5"></th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted">No returns yet.</td>
                  </tr>
                ) : recent.map((r) => (
                  <tr key={r.rma}
                    className="border-t border-divider hover:bg-white/[0.025] transition-colors relative group">
                    <td className="py-3 px-5 font-mono text-[12px] text-ink">{r.rma}</td>
                    <td className="py-3 text-muted">{r.order}</td>
                    <td className="py-3 text-ink">{r.customer}</td>
                    <td className="py-3 text-muted">{r.itemsCount} {r.itemsCount === 1 ? 'item' : 'items'}</td>
                    <td className="py-3 text-muted">{r.reason}</td>
                    <td className="py-3 text-muted">{r.date}</td>
                    <td className="py-3"><StatusBadge status={r.status} /></td>
                    <td className="py-3 px-5 text-right relative z-10">
                      <Link to={`/app/returns/${r.rma}${location.search}`}
                        className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-md border border-border text-ink hover:bg-white/[0.06] hover:border-accent/40 hover:text-accent2 transition-all duration-150 rf-press">
                        {r.status === 'PENDING' ? 'Review' : 'View'}
                        <Icon name="ArrowRight" size={11} className="opacity-0 group-hover:opacity-100 -ml-1 group-hover:ml-0 transition-all duration-200" />
                      </Link>
                    </td>
                    <td className="absolute inset-0 z-0 hidden group-hover:block cursor-pointer">
                      <Link to={`/app/returns/${r.rma}${location.search}`} className="block w-full h-full" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-divider px-5 py-3">
            <Link to={`/app/returns${location.search}`}
              className="text-[12.5px] font-medium text-muted hover:text-ink transition-colors flex items-center gap-1.5">
              View all returns
              <Icon name="ArrowRight" size={12} />
            </Link>
          </div>
        </div>
      </Card>

      {reasons.length > 0 && (
        <Card title="Top return reasons" subtitle="All time, by number of items">
          <div className="space-y-2.5">
            {reasons.map((r, i) => {
              const pct = reasonTotal > 0 ? Math.round((r.count / reasonTotal) * 100) : 0;
              return (
                <div key={r.name}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1">
                    <span className="text-ink">{r.name}</span>
                    <span className="text-muted tabular-nums">{r.count} · {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[i % colors.length] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Setup checklist */}
        <Card title="Setup Checklist" subtitle={`${completedCount} of ${checklist.length} complete`} className="lg:col-span-2">
          <div className="space-y-2">
            {checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5">
                <div className="w-5 h-5 rounded-full grid place-content-center shrink-0"
                  style={c.done
                    ? { background: '#22C55E22', color: '#22C55E' }
                    : { background: '#2E3148', color: '#5B5F75', border: '1px dashed #3a3e58' }}>
                  {c.done && <Icon name="Check" size={11} strokeWidth={3} />}
                </div>
                <div className={`text-[13px] ${c.done ? 'text-muted line-through' : 'text-ink'}`}>{c.label}</div>
              </div>
            ))}
            <div className="mt-4 pt-4 border-t border-divider">
              <div className="flex items-center justify-between text-[11.5px] mb-1.5">
                <span className="text-muted">Progress</span>
                <span className="text-ink font-medium">{Math.round(completedCount / checklist.length * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: (completedCount / checklist.length * 100) + '%', background: 'linear-gradient(90deg,#6C63FF,#8B5CF6)' }} />
              </div>
            </div>
          </div>
        </Card>

        {/* How to expose your Portal Page */}
        <Card title="Expose your Portal Page" subtitle="How customers reach your returns" className="lg:col-span-3 relative overflow-hidden">
          {/* decorative aura */}
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-[0.07] pointer-events-none"
            style={{ background: 'radial-gradient(circle, #6C63FF, transparent 70%)' }} />
          <div className="flex flex-col h-full relative">
            <div className="text-[13px] text-muted mb-4 leading-relaxed">
              Choose how to expose your return portal to customers — link it in your store
              navigation, share a direct URL, or embed it on your website.
            </div>
            <ul className="space-y-2 mb-5 text-[12.5px] text-ink">
              <li className="flex items-start gap-2">
                <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-accent2" strokeWidth={2.5} />
                <span>Add a link in your Shopify store nav or footer</span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-accent2" strokeWidth={2.5} />
                <span>Share a direct portal URL with your customers</span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="Check" size={13} className="mt-0.5 shrink-0 text-accent2" strokeWidth={2.5} />
                <span>Embed the portal on any page of your website</span>
              </li>
            </ul>
            <div className="mt-auto">
              <Link to={withParam('/app/settings', 'tab=Portal')}
                className="group inline-flex items-center justify-center gap-2 px-4 h-10 rounded-md text-white text-[13px] font-semibold transition-all rf-press
                            bg-gradient-to-b from-[#7B73FF] to-[#6259EE] hover:from-[#8B85FF] hover:to-[#6C63FF]
                            shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_8px_22px_-6px_rgba(108,99,255,0.55)]
                            hover:shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_12px_28px_-6px_rgba(108,99,255,0.65)]">
                <Icon name="Settings" size={14} className="transition-transform group-hover:rotate-90" />
                Open Portal settings
                <Icon name="ArrowRight" size={13} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
