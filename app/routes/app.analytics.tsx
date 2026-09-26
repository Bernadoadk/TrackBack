import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Card } from "../components/ui";
import { ensureBillingSynced } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoney } from "../lib/money";
import { countOrders } from "../lib/shopify-queries.server";

const ANALYTICS_COLORS = ['#6C63FF','#EF4444','#F59E0B','#3B82F6','#8B5CF6'];
const RESOLUTION_META: Record<string, { label: string; color: string }> = {
  ORIGINAL_PAYMENT: { label: 'Original payment', color: '#8B8FA8' },
  MANUAL: { label: 'Manual payout (COD)', color: '#F59E0B' },
  STORE_CREDIT: { label: 'Store credit', color: '#6C63FF' },
  GIFT_CARD: { label: 'Gift card', color: '#EC4899' },
  EXCHANGE: { label: 'Exchange', color: '#3B82F6' },
};

type Req = {
  createdAt: Date;
  refundedAt: Date | null;
  status: string;
  refundType: string;
  refundAmount: number;
  feeAmount: number;
  items: { name: string; reason: string; quantity: number; price: number }[];
};

function computePeriod(requests: Req[], days: number, ordersInPeriod: number | null) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const filtered = requests.filter(r => r.createdAt >= cutoff);

  const chart: number[] = Array(days).fill(0);
  filtered.forEach(r => {
    const diff = Math.floor((now.getTime() - r.createdAt.getTime()) / 86400000);
    if (diff < days) chart[days - 1 - diff]++;
  });

  const total = filtered.length;
  const refunded = filtered.filter(r => r.status === 'REFUNDED');
  const cashRefunded = refunded
    .filter(r => r.refundType === 'ORIGINAL_PAYMENT' || r.refundType === 'MANUAL')
    .reduce((s, r) => s + r.refundAmount, 0);
  const retainedRevenue = refunded
    .filter(r => r.refundType === 'STORE_CREDIT' || r.refundType === 'GIFT_CARD' || r.refundType === 'EXCHANGE')
    .reduce((s, r) => s + r.refundAmount, 0);
  const retainedRatio = cashRefunded + retainedRevenue > 0 ? Math.round((retainedRevenue / (cashRefunded + retainedRevenue)) * 100) : 0;
  const feesCollected = refunded.reduce((s, r) => s + (r.feeAmount || 0), 0);

  const withTime = refunded.filter(r => r.refundedAt);
  const avgProcessingDays = withTime.length > 0
    ? withTime.reduce((s, r) => s + (r.refundedAt!.getTime() - r.createdAt.getTime()), 0) / withTime.length / 86400000
    : 0;
  const exchangeCount = filtered.filter(r => r.refundType === 'EXCHANGE').length;
  const exchangeRate = total > 0 ? Math.round((exchangeCount / total) * 100) : 0;

  const reasonMap: Record<string, { count: number; value: number }> = {};
  let totalItems = 0;
  filtered.forEach(r => r.items.forEach(it => {
    const e = reasonMap[it.reason] ?? (reasonMap[it.reason] = { count: 0, value: 0 });
    e.count += it.quantity;
    e.value += it.price * it.quantity;
    totalItems += it.quantity;
  }));
  const topReasons = Object.entries(reasonMap)
    .sort((a, b) => b[1].count - a[1].count).slice(0, 6)
    .map(([name, v], i) => ({ name, count: v.count, value: Math.round(v.value * 100) / 100, pct: totalItems > 0 ? Math.round((v.count / totalItems) * 100) : 0, color: ANALYTICS_COLORS[i % ANALYTICS_COLORS.length] }));

  const productMap: Record<string, { count: number; value: number }> = {};
  filtered.forEach(r => r.items.forEach(it => {
    const e = productMap[it.name] ?? (productMap[it.name] = { count: 0, value: 0 });
    e.count += it.quantity;
    e.value += it.price * it.quantity;
  }));
  const topProducts = Object.entries(productMap).sort((a, b) => b[1].count - a[1].count).slice(0, 5)
    .map(([name, v]) => ({ name, count: v.count, value: Math.round(v.value * 100) / 100 }));

  const resolutionMap: Record<string, { count: number; amount: number }> = {};
  refunded.forEach(r => {
    const e = resolutionMap[r.refundType] ?? (resolutionMap[r.refundType] = { count: 0, amount: 0 });
    e.count++;
    e.amount += r.refundAmount;
  });
  const resolutions = Object.entries(resolutionMap).sort((a, b) => b[1].count - a[1].count)
    .map(([type, v]) => ({ type, count: v.count, amount: Math.round(v.amount * 100) / 100 }));

  const returnRate = ordersInPeriod && ordersInPeriod > 0 ? Math.round((total / ordersInPeriod) * 1000) / 10 : null;

  return {
    total,
    totalRefunded: Math.round(cashRefunded * 100) / 100,
    retainedRevenue: Math.round(retainedRevenue * 100) / 100,
    retainedRatio,
    feesCollected: Math.round(feesCollected * 100) / 100,
    avgProcessingDays: Math.round(avgProcessingDays * 10) / 10,
    exchangeRate,
    returnRate,
    chart, topReasons, topProducts, resolutions, totalItems,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const since90 = new Date(Date.now() - 90 * 86400000);

  const [rows, plan, currency] = await Promise.all([
    prisma.returnRequest.findMany({
      where: { shop, createdAt: { gte: since90 } },
      select: {
        createdAt: true, refundedAt: true, status: true, refundType: true, refundAmount: true, feeAmount: true,
        items: { select: { name: true, reason: true, quantity: true, price: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    ensureBillingSynced(admin, shop),
    getShopCurrency(shop, admin),
  ]);

  const advanced = hasFeature(plan, 'advancedAnalytics');
  const iso = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const [o30, o90] = advanced ? await Promise.all([countOrders(admin, iso(30)), countOrders(admin, iso(90))]) : [null, null];

  return {
    advanced,
    currency,
    p7: computePeriod(rows, 7, null),
    p30: advanced ? computePeriod(rows, 30, o30) : null,
    p90: advanced ? computePeriod(rows, 90, o90) : null,
  };
};

export default function AnalyticsPage() {
  const { p7, p30, p90, advanced, currency } = useLoaderData<typeof loader>();
  const isStarter = advanced;
  const [period, setPeriod] = useState(isStarter ? '30 days' : '7 days');
  const location = useLocation();
  const billingHref = `/app/billing${location.search}`;

  const pd = period === '7 days' ? p7 : period === '90 days' ? (p90 ?? p7) : (p30 ?? p7);
  const { total, totalRefunded, retainedRevenue, retainedRatio, avgProcessingDays, exchangeRate, chart, topReasons, topProducts, resolutions, returnRate, feesCollected } = pd;

  const data = chart;
  const max = Math.max(...data, 1);

  const W = 720, H = 200, PAD_L = 28, PAD_R = 8, PAD_T = 12, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const points = data.map((v, i) => [PAD_L + i * stepX, PAD_T + innerH - (v / max) * innerH]);
  const linePath = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${(W - PAD_R).toFixed(1)},${(H - PAD_B).toFixed(1)} L${PAD_L},${(H - PAD_B).toFixed(1)} Z`;

  const cx = 90, cy = 90, rO = 78, rI = 50;
  let acc = 0;
  const donutSlices = topReasons.map((r) => {
    const start = acc / 100, end = (acc + r.pct) / 100;
    acc += r.pct;
    return { ...r, path: donutPath(cx, cy, rO, rI, start, end) };
  });

  const peakValue = Math.max(...data);
  const peakDay = data.indexOf(peakValue) + 1;
  const periodLabel = period === '7 days' ? 'Last 7 days' : period === '90 days' ? 'Last 90 days' : 'Last 30 days';
  const resolutionTotal = resolutions.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Spot patterns and reduce return rates."
        right={
          <div className="inline-flex items-center bg-surface border border-border rounded-md p-0.5">
            {['7 days', '30 days', '90 days'].map(p => {
              const locked = !isStarter && p !== '7 days';
              return (
                <button key={p}
                  onClick={() => !locked && setPeriod(p)}
                  title={locked ? 'Requires Starter plan' : undefined}
                  className={`px-3 h-7 text-[12px] font-medium rounded transition-colors flex items-center gap-1 ${
                    period === p ? 'bg-accent/15 text-accent2' : locked ? 'text-faint cursor-not-allowed' : 'text-muted hover:text-ink'
                  }`}>
                  {locked && <span>🔒</span>}
                  {p}
                </button>
              );
            })}
          </div>
        } />

      {!isStarter && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/8">
          <span className="text-[12.5px] text-ink flex-1">
            <span className="font-semibold">You're seeing the last 7 days only.</span>
            {" "}Upgrade to Starter for 30 & 90-day analytics.
          </span>
          <Link to={billingHref}
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#F59E0B' }}>
            Upgrade
          </Link>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniKpi label="Total Returns" value={String(total)} delta={total > 0 ? 'in period' : 'No returns yet'} tone="muted" />
        <MiniKpi label="Return Rate" value={returnRate === null ? '—' : `${returnRate}%`} delta={returnRate === null ? (advanced ? 'no orders' : 'Starter plan') : 'of orders'} tone={returnRate !== null && returnRate > 15 ? 'warn' : 'ok'} />
        <MiniKpi label="Cash Refunded" value={formatMoney(totalRefunded, currency)} delta="card + manual" tone={totalRefunded > 0 ? 'warn' : 'ok'} />
        <MiniKpi label="Retained Revenue" value={formatMoney(retainedRevenue, currency)} delta={`${retainedRatio}% of refunds`} tone="ok" />
        <MiniKpi label="Exchange Rate" value={`${exchangeRate}%`} delta="of all returns" tone="ok" />
        <MiniKpi label="Avg. Processing" value={avgProcessingDays > 0 ? `${avgProcessingDays} d` : '—'} delta="request → refund" tone="muted" />
        <MiniKpi label="Fees Collected" value={formatMoney(feesCollected, currency)} delta="restocking + shipping" tone="muted" />
        <MiniKpi label="Items Returned" value={String(pd.totalItems)} delta="units" tone="muted" />
      </div>

      {/* Retained revenue highlight */}
      {retainedRevenue > 0 && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-lg border border-[#22C55E]/20 bg-[#22C55E]/5">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink">
              <span style={{ color: '#22C55E' }}>{formatMoney(retainedRevenue, currency)}</span> retained via store credit &amp; exchanges
            </div>
            <div className="text-[12px] text-muted mt-0.5">Revenue that stayed in your store instead of going back to the customer.</div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card title="Returns Over Time" subtitle={periodLabel} className="lg:col-span-3">
          {total === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-muted text-[13px]">No data yet — returns will appear here.</div>
          ) : (
            <div className="w-full overflow-hidden">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
                <defs>
                  <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#6C63FF" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#6C63FF" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map(t => {
                  const y = PAD_T + innerH * t;
                  const v = Math.round(max * (1 - t));
                  return (
                    <g key={t}>
                      <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#2E3148" strokeDasharray="3 4" />
                      <text x={PAD_L - 6} y={y + 3} fontSize="9" fill="#5B5F75" textAnchor="end">{v}</text>
                    </g>
                  );
                })}
                {data.map((_, i) => i % 5 === 0 ? (
                  <text key={i} x={PAD_L + i * stepX} y={H - 6} fontSize="9" fill="#5B5F75" textAnchor="middle">Day {i + 1}</text>
                ) : null)}
                <path d={areaPath} fill="url(#lg)" />
                <path d={linePath} fill="none" stroke="#8B85FF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={i === points.length - 1 ? 4 : 2.2}
                          fill={i === points.length - 1 ? '#fff' : '#8B85FF'} stroke="#6C63FF" strokeWidth={i === points.length - 1 ? 2 : 0} />
                ))}
              </svg>
            </div>
          )}
          <div className="flex items-center justify-between mt-3 text-[12px] text-muted">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent2"></span> Returns / day</div>
            {peakValue > 0 && <div>Peak: <span className="text-ink font-medium">{peakValue} returns</span> on Day {peakDay}</div>}
          </div>
        </Card>

        <Card title="Return Reasons Breakdown" className="lg:col-span-2">
          {topReasons.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-muted text-[13px]">No data yet.</div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="relative shrink-0">
                <svg width="180" height="180" viewBox="0 0 180 180">
                  {donutSlices.map((s, i) => (
                    <path key={i} d={s.path} fill={s.color} opacity="0.92">
                      <title>{s.name}: {s.pct}%</title>
                    </path>
                  ))}
                  <text x="90" y="86" fontSize="22" fontWeight="600" fill="#F0F0F5" textAnchor="middle">{total}</text>
                  <text x="90" y="104" fontSize="10" fill="#8B8FA8" textAnchor="middle">total returns</text>
                </svg>
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                {topReasons.map(r => (
                  <div key={r.name} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
                    <span className="text-muted truncate flex-1">{r.name}</span>
                    <span className="text-ink tabular-nums font-medium">{r.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Top Returned Products" subtitle={periodLabel}>
          {topProducts.length === 0 ? (
            <div className="py-6 text-center text-muted text-[13px]">No products yet.</div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => {
                const pct = topProducts[0].count > 0 ? (p.count / topProducts[0].count) * 100 : 0;
                return (
                  <div key={p.name}>
                    <div className="flex items-center justify-between text-[13px] mb-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-faint w-4 text-right tabular-nums text-[11.5px]">{i + 1}</span>
                        <span className="text-ink">{p.name}</span>
                      </div>
                      <span className="text-muted tabular-nums">{p.count} · {formatMoney(p.value, currency)}</span>
                    </div>
                    <div className="ml-6 h-1.5 rounded-full bg-bg overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                           style={{ width: pct + '%', background: 'linear-gradient(90deg,#6C63FF,#8B85FF)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Return Reason Details">
          <div className="-mx-5">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] whitespace-nowrap min-w-[400px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-divider">
                    <th className="text-left font-semibold py-2.5 px-5">Reason</th>
                    <th className="text-right font-semibold py-2.5">Count</th>
                    <th className="text-right font-semibold py-2.5">Value</th>
                    <th className="text-right font-semibold py-2.5 pr-5">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {topReasons.length === 0 ? (
                    <tr><td colSpan={4} className="py-6 text-center text-muted">No data yet.</td></tr>
                  ) : topReasons.map((r) => (
                    <tr key={r.name} className="border-b border-divider last:border-0">
                      <td className="py-3 px-5">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                          <span className="text-ink">{r.name}</span>
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums text-ink">{r.count}</td>
                      <td className="py-3 text-right tabular-nums text-ink">{formatMoney(r.value, currency)}</td>
                      <td className="py-3 text-right tabular-nums text-muted pr-5">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Resolutions" subtitle={`Completed returns by resolution · ${periodLabel}`}>
        {resolutions.length === 0 ? (
          <div className="py-6 text-center text-muted text-[13px]">No completed returns in this period.</div>
        ) : (
          <div className="space-y-3">
            <div className="h-2.5 rounded-full overflow-hidden flex bg-bg">
              {resolutions.map((r) => (
                <div key={r.type} style={{ width: `${(r.count / resolutionTotal) * 100}%`, background: RESOLUTION_META[r.type]?.color ?? '#8B8FA8' }} title={RESOLUTION_META[r.type]?.label ?? r.type} />
              ))}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {resolutions.map((r) => (
                <div key={r.type} className="rounded-md border border-divider p-3">
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span className="w-2 h-2 rounded-sm" style={{ background: RESOLUTION_META[r.type]?.color ?? '#8B8FA8' }} />
                    {RESOLUTION_META[r.type]?.label ?? r.type}
                  </div>
                  <div className="mt-1 text-[16px] font-semibold text-ink tabular-nums">{r.count}</div>
                  <div className="text-[11.5px] text-muted tabular-nums">{formatMoney(r.amount, currency)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MiniKpi({ label, value, delta, tone }: any) {
  const color = tone === 'ok' ? '#22C55E' : tone === 'warn' ? '#F59E0B' : tone === 'danger' ? '#EF4444' : '#8B8FA8';
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[11.5px] text-muted font-medium">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold text-ink tracking-tight tabular-nums">{value}</span>
        <span className="text-[11.5px] tabular-nums" style={{ color }}>{delta}</span>
      </div>
    </div>
  );
}

function donutPath(cx: number, cy: number, rO: number, rI: number, start: number, end: number) {
  if (end - start >= 0.999) end = start + 0.999;
  const a0 = (start - 0.25) * Math.PI * 2;
  const a1 = (end   - 0.25) * Math.PI * 2;
  const large = end - start > 0.5 ? 1 : 0;
  const x0 = cx + Math.cos(a0) * rO, y0 = cy + Math.sin(a0) * rO;
  const x1 = cx + Math.cos(a1) * rO, y1 = cy + Math.sin(a1) * rO;
  const x2 = cx + Math.cos(a1) * rI, y2 = cy + Math.sin(a1) * rI;
  const x3 = cx + Math.cos(a0) * rI, y3 = cy + Math.sin(a0) * rI;
  return `M${x0},${y0} A${rO},${rO} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rI},${rI} 0 ${large} 0 ${x3},${y3} Z`;
}
