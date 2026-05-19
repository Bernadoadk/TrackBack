// ---------- Dashboard ----------
function KpiCard({ label, value, sub, subTone, icon, accentColor }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5 relative overflow-hidden group hover:border-[#3a3e58] transition-colors">
      <div className="flex items-start justify-between">
        <div className="text-[12px] font-medium text-muted">{label}</div>
        <div className="w-8 h-8 rounded-md grid place-content-center"
          style={{ background: accentColor + '18', color: accentColor }}>
          <Icon name={icon} size={15} strokeWidth={2.25} />
        </div>
      </div>
      <div className="mt-3 text-[26px] font-semibold text-ink tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px]">
        <span style={{ color: subTone === 'ok' ? '#22C55E' : subTone === 'warn' ? '#F59E0B' : '#8B8FA8' }}>{sub}</span>
      </div>
      <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full opacity-[0.04] pointer-events-none"
        style={{ background: accentColor }} />
    </div>
  );
}

function DashboardPage({ onNavigate, onOpenReturn, returns }) {
  const recent = returns.slice(0, 5);
  const checklist = [
    { label: 'Install TrackBack', done: true },
    { label: 'Set return address', done: true },
    { label: 'Upload your logo', done: false },
    { label: 'Customize email templates', done: false },
  ];
  const completedCount = checklist.filter(c => c.done).length;
  const today = new Date('2026-05-16T09:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Good morning, Acme Store <span className="ml-1">👋</span></>}
        subtitle={today} />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Pending Review" value="12" sub="+3 since yesterday" subTone="warn" icon="Clock" accentColor="#F59E0B" />
        <KpiCard label="Approved" value="8" sub="this week" subTone="muted" icon="CircleCheck" accentColor="#3B82F6" />
        <KpiCard label="Refunded This Month" value="$2,847" sub="+12% vs last month" subTone="ok" icon="DollarSign" accentColor="#22C55E" />
        <KpiCard label="Return Rate" value="4.2%" sub="industry avg: 8%" subTone="ok" icon="TrendingDown" accentColor="#6C63FF" />
      </div>

      {/* Hero KPI: Revenue retained — the headline metric */}
      <div className="relative overflow-hidden rounded-lg border p-5 flex items-center justify-between gap-5 flex-wrap"
        style={{
          background: 'linear-gradient(135deg, rgba(108,99,255,0.12) 0%, rgba(139,92,246,0.06) 60%, transparent 100%), #1A1D27',
          borderColor: 'rgba(108,99,255,0.35)',
          boxShadow: '0 8px 24px rgba(108,99,255,0.10)',
        }}>
        <div className="absolute -right-12 -bottom-12 w-56 h-56 rounded-full opacity-[0.10] pointer-events-none" style={{ background: '#6C63FF' }} />
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg grid place-content-center" style={{ background: 'rgba(108,99,255,0.25)', color: '#8B85FF' }}>
            <Icon name="TrendingUp" size={22} strokeWidth={2.25} />
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-wider font-semibold" style={{ color: '#8B85FF' }}>Revenue Retained This Month</div>
            <div className="text-[28px] font-bold text-ink tracking-tight tabular-nums mt-0.5">$1,240</div>
            <div className="text-[12px] text-muted mt-0.5">via store credit &amp; exchanges · <span className="text-ok">+44% vs last month</span></div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-[12px]">
          <div>
            <div className="text-faint uppercase tracking-wider text-[10.5px] font-semibold">Store credit</div>
            <div className="text-ink text-[16px] font-semibold tabular-nums mt-0.5">$890</div>
          </div>
          <div className="w-px h-8 bg-divider"></div>
          <div>
            <div className="text-faint uppercase tracking-wider text-[10.5px] font-semibold">Exchanges</div>
            <div className="text-ink text-[16px] font-semibold tabular-nums mt-0.5">$350</div>
          </div>
        </div>
      </div>

      {/* Recent returns */}
      <Card
        title="Recent Returns"
        subtitle="Latest 5 requests across all statuses"
        action={
          <button onClick={() => onNavigate('returns')}
            className="text-[12.5px] text-accent2 hover:text-white transition-colors flex items-center gap-1 font-medium">
            View all <Icon name="ArrowRight" size={12} />
          </button>
        }>
        <div className="-mx-5 -mb-5 border-t border-divider">
          <table className="w-full text-[13px]">
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
              {recent.map((r) => (
                <tr key={r.rma} onClick={() => onOpenReturn(r.rma)}
                  className="border-t border-divider hover:bg-white/[0.02] cursor-pointer transition-colors">
                  <td className="py-3 px-5 font-mono text-[12px] text-ink">{r.rma}</td>
                  <td className="py-3 text-muted">{r.order}</td>
                  <td className="py-3 text-ink">{r.customer}</td>
                  <td className="py-3 text-muted">{r.itemsCount} {r.itemsCount === 1 ? 'item' : 'items'}</td>
                  <td className="py-3 text-muted">{r.reason}</td>
                  <td className="py-3 text-muted">{r.date}</td>
                  <td className="py-3"><StatusBadge status={r.status} /></td>
                  <td className="py-3 px-5 text-right">
                    <button onClick={(e) => { e.stopPropagation(); onOpenReturn(r.rma); }}
                      className="text-[12px] font-medium px-2.5 py-1 rounded border border-border text-ink hover:bg-white/5 hover:border-[#3a3e58] transition">
                      {r.status === 'PENDING' ? 'Review' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-divider px-5 py-3">
            <button onClick={() => onNavigate('returns')}
              className="text-[12.5px] font-medium text-muted hover:text-ink transition-colors flex items-center gap-1.5">
              View all returns
              <Icon name="ArrowRight" size={12} />
            </button>
          </div>
        </div>
      </Card>

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
                  style={{ width: (completedCount / checklist.length * 100) + '%', background: 'linear-gradient(90deg,#6C63FF,#8B85FF)' }} />
              </div>
            </div>
          </div>
        </Card>

        {/* Returns Overview (was Top Return Reasons) */}
        <Card title="Returns Overview" subtitle="This week · 47 returns" className="lg:col-span-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {/* Top reasons */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-faint font-semibold mb-3">Top reasons</div>
              <div className="space-y-2.5">
                {TOP_REASONS.map((r) => (
                  <div key={r.name}>
                    <div className="flex items-center justify-between text-[12.5px] mb-1">
                      <span className="text-ink">{r.name}</span>
                      <span className="text-muted tabular-nums">{r.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: r.pct + '%', background: r.color, boxShadow: `0 0 8px ${r.color}55` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Refund methods breakdown */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-faint font-semibold mb-3">Refund methods</div>
              <div className="space-y-2.5">
                {[
                  { label: 'Refunded to card', pct: 58, color: '#8B8FA8' },
                  { label: 'Store credit issued', pct: 28, color: '#6C63FF' },
                  { label: 'Exchanges', pct: 14, color: '#3B82F6' },
                ].map(m => (
                  <div key={m.label}>
                    <div className="flex items-center justify-between text-[12.5px] mb-1">
                      <span className="text-ink flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: m.color }} />
                        {m.label}
                      </span>
                      <span className="text-muted tabular-nums">{m.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: m.pct + '%', background: m.color, boxShadow: `0 0 8px ${m.color}55` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-divider text-[11.5px] text-muted leading-relaxed">
                <span className="text-accent2 font-semibold">42%</span> of refund value stayed in store this week.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

window.DashboardPage = DashboardPage;
