import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Card } from "../components/ui";
import { getShopPlan } from "../lib/plan.server";

const ANALYTICS_COLORS = ['#6C63FF','#EF4444','#F59E0B','#3B82F6','#8B5CF6'];

function computePeriod(requests: any[], days: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const filtered = requests.filter(r => new Date(r.createdAt) >= cutoff);

  const chart: number[] = Array(days).fill(0);
  filtered.forEach(r => {
    const diff = Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 86400000);
    if (diff < days) chart[days - 1 - diff]++;
  });

  const total = filtered.length;
  const refunded = filtered.filter((r: any) => r.status === 'REFUNDED');
  const totalRefunded = refunded.reduce((s: number, r: any) => s + r.refundAmount, 0);

  // Retained revenue = value that stayed in the store (store credit + exchange)
  const retainedRevenue = refunded
    .filter((r: any) => r.refundType === 'STORE_CREDIT' || r.refundType === 'EXCHANGE')
    .reduce((s: number, r: any) => s + r.refundAmount, 0);
  const retainedRatio = total > 0 ? Math.round((retainedRevenue / Math.max(totalRefunded + retainedRevenue, 1)) * 100) : 0;

  const closed = filtered.filter((r: any) => ['REFUNDED','REJECTED','RECEIVED'].includes(r.status));
  const avgProcessingDays = closed.length > 0
    ? closed.reduce((s: number, r: any) => s + (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()), 0) / closed.length / 86400000
    : 0;
  const exchangeCount = filtered.filter((r: any) => r.refundType === 'EXCHANGE').length;
  const exchangeRate = total > 0 ? Math.round((exchangeCount / total) * 100) : 0;

  const reasonMap: Record<string, number> = {};
  let totalItems = 0;
  filtered.forEach((r: any) => r.items.forEach((it: any) => {
    reasonMap[it.reason] = (reasonMap[it.reason] || 0) + it.quantity;
    totalItems += it.quantity;
  }));
  const topReasons = Object.entries(reasonMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count], i) => ({ name, count, pct: totalItems > 0 ? Math.round((count / totalItems) * 100) : 0, color: ANALYTICS_COLORS[i % ANALYTICS_COLORS.length] }));

  const productMap: Record<string, number> = {};
  filtered.forEach((r: any) => r.items.forEach((it: any) => {
    productMap[it.name] = (productMap[it.name] || 0) + it.quantity;
  }));
  const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  return { total, totalRefunded: Math.round(totalRefunded * 100) / 100, retainedRevenue: Math.round(retainedRevenue * 100) / 100, retainedRatio, avgProcessingDays: Math.round(avgProcessingDays * 10) / 10, exchangeRate, chart, topReasons, topProducts, totalItems };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [returnRequests, plan] = await Promise.all([
    prisma.returnRequest.findMany({ where: { shop }, include: { items: true }, orderBy: { createdAt: 'desc' } }),
    getShopPlan(shop),
  ]);

  const isStarter = plan === 'starter' || plan === 'pro';

  return {
    plan,
    p7:  computePeriod(returnRequests, 7),
    p30: isStarter ? computePeriod(returnRequests, 30) : null,
    p90: isStarter ? computePeriod(returnRequests, 90) : null,
  };
};

export default function AnalyticsPage() {
  const { p7, p30, p90, plan } = useLoaderData<typeof loader>();
  const isStarter = plan === 'starter' || plan === 'pro';
  const [period, setPeriod] = useState(isStarter ? '30 days' : '7 days');

  const pd = period === '7 days' ? p7 : period === '90 days' ? (p90 ?? p7) : (p30 ?? p7);
  const { total, totalRefunded, retainedRevenue, retainedRatio, avgProcessingDays, exchangeRate, chart, topReasons, topProducts } = pd;

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
          <a href="/app/billing"
            className="shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1"
            style={{ background: '#F59E0B' }}>
            Upgrade
          </a>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniKpi label="Total Returns"       value={String(total)}                        delta={total > 0 ? 'in period' : 'No returns yet'} tone="muted" />
        <MiniKpi label="Refund Issued"       value={`$${totalRefunded.toFixed(2)}`}       delta="cash refunded"     tone={totalRefunded > 0 ? 'warn' : 'ok'} />
        <MiniKpi label="Retained Revenue"    value={`$${retainedRevenue.toFixed(2)}`}     delta={`${retainedRatio}% of refunds`} tone="ok" />
        <MiniKpi label="Exchange Rate"       value={`${exchangeRate}%`}                   delta="of all returns"  tone="ok" />
      </div>

      {/* Retained revenue highlight */}
      {retainedRevenue > 0 && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-lg border border-[#22C55E]/20 bg-[#22C55E]/5">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink">
              <span style={{ color: '#22C55E' }}>${retainedRevenue.toFixed(2)}</span> retained via store credit &amp; exchanges
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
        <Card title="Top Returned Products" subtitle="Most-returned items all time">
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
                      <span className="text-muted tabular-nums">{p.count} returns</span>
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
                    <th className="text-right font-semibold py-2.5">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {topReasons.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-muted">No data yet.</td></tr>
                  ) : topReasons.map((r) => (
                    <tr key={r.name} className="border-b border-divider last:border-0">
                      <td className="py-3 px-5">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                          <span className="text-ink">{r.name}</span>
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums text-ink">{r.count}</td>
                      <td className="py-3 text-right tabular-nums text-muted">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
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
