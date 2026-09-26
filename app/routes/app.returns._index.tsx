import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation, useLoaderData, useFetcher, useSearchParams } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Select, StatusBadge, Modal, Textarea, RiskBadge, useToast } from "../components/ui";
import { syncReturnsForShop } from "../lib/returns-sync.server";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoney } from "../lib/money";
import { transitionStatus } from "../lib/returns-service.server";
import { RANGES, STATUS_TABS, baseWhere, listWhere, parseReturnFilters } from "../lib/returns-query";
import { getShopPlan } from "../lib/plan.server";
import { hasFeature } from "../lib/plans";

const PAGE_SIZE = 25;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  if (formData.get("intent") !== "bulk") return null;

  let rmas: string[] = [];
  try {
    rmas = (JSON.parse(String(formData.get("rmas") ?? "[]")) as string[]).slice(0, 50);
  } catch {
    return { ok: false, error: "Invalid selection." };
  }
  const to = String(formData.get("to") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!["APPROVED", "REJECTED", "RECEIVED"].includes(to)) return { ok: false, error: "Unknown action." };
  if (to === "REJECTED" && !reason) return { ok: false, error: "A reason is required to reject." };

  // Same path as the detail page: emails, Shopify sync, audit trail, webhooks.
  let done = 0;
  const failed: string[] = [];
  for (const rma of rmas) {
    const res = await transitionStatus({
      admin, shop, rma, to: to as "APPROVED" | "REJECTED" | "RECEIVED", reason: reason || null, source: "merchant",
    });
    if (res.ok) done++;
    else failed.push(rma);
  }
  return { ok: true, done, failed };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filters = parseReturnFilters(url);

  // Throttled (10 min) backfill of returns created directly in Shopify Admin.
  await syncReturnsForShop(shop, admin);

  const where = listWhere(shop, filters);
  const [rows, total, grouped, currency, plan] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: { items: { select: { quantity: true } } },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.groupBy({ by: ["status"], where: baseWhere(shop, filters), _count: { _all: true } }),
    getShopCurrency(shop, admin),
    getShopPlan(shop),
  ]);

  const counts: Record<string, number> = { All: 0 };
  for (const g of grouped) {
    counts.All += g._count._all;
    const tab = g.status.charAt(0) + g.status.slice(1).toLowerCase();
    counts[tab] = (counts[tab] ?? 0) + g._count._all;
  }

  return {
    filters,
    total,
    counts,
    currency,
    showRisk: hasFeature(plan, "fraud"),
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({
      rma: r.rma,
      order: r.orderName,
      customer: r.customerName || r.customerEmail.split("@")[0],
      email: r.customerEmail,
      date: r.createdAt.toISOString(),
      itemsCount: r.items.reduce((s, it) => s + it.quantity, 0),
      amount: r.refundAmount || r.itemsTotal || r.orderTotal,
      refundType: r.refundType,
      status: r.status,
      requestType: r.requestType,
      keepItem: r.keepItem,
      riskLevel: r.riskLevel,
    })),
  };
};

export default function ReturnsPage() {
  const { filters, total, counts, currency, rows, showRisk, pageSize } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(filters.q);
  const [selected, setSelected] = useState(new Set<string>());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();
  const toast = useToast();
  const handled = useRef<any>(null);

  const setParam = (updates: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in updates)) next.delete("page");
      return next;
    });
    setSelected(new Set());
  };

  // Debounced search
  useEffect(() => {
    if (query === filters.q) return;
    const id = setTimeout(() => setParam({ q: query || null }), 350);
    return () => clearTimeout(id);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    const d = fetcher.data as any;
    if (!d.ok) toast({ kind: "error", title: "Bulk action failed", body: d.error });
    else toast({
      kind: d.failed?.length ? "warn" : "success",
      title: `${d.done} return${d.done === 1 ? "" : "s"} updated`,
      body: d.failed?.length ? `Skipped (status not allowed): ${d.failed.join(", ")}` : "Customers have been notified.",
    });
    setSelected(new Set());
    setRejectOpen(false);
    setRejectReason("");
  }, [fetcher.state, fetcher.data, toast]);

  const bulk = (to: string, reason = "") =>
    fetcher.submit({ intent: "bulk", to, reason, rmas: JSON.stringify([...selected]) }, { method: "POST" });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams(searchParams);
      const res = await fetch(`/api/returns/export?${params.toString()}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `returns-${new Date().toISOString().split("T")[0]}.csv` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ kind: "error", title: "Export failed" });
    } finally {
      setExporting(false);
    }
  };

  const toggleAll = () => (selected.size === rows.length ? setSelected(new Set()) : setSelected(new Set(rows.map((r) => r.rma))));
  const toggleOne = (rma: string) => {
    const s = new Set(selected);
    if (s.has(rma)) s.delete(rma);
    else s.add(rma);
    setSelected(s);
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const avatarColors = [["#6C63FF", "#8B85FF"], ["#3B82F6", "#60a5fa"], ["#8B5CF6", "#a78bfa"], ["#22C55E", "#4ade80"], ["#F59E0B", "#fbbf24"]];

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Review, approve and track customer return requests."
        right={
          <>
            {(counts.Pending ?? 0) > 0 && (
              <span className="text-[12px] px-2.5 py-1 rounded font-semibold tracking-wide" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F59E0B] mr-1.5 align-middle animate-pulseSoft" />
                {counts.Pending} pending
              </span>
            )}
            {(counts.Shipped ?? 0) > 0 && (
              <span className="text-[12px] px-2.5 py-1 rounded font-semibold tracking-wide" style={{ background: "rgba(16,185,129,0.12)", color: "#10B981" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10B981] mr-1.5 align-middle" />
                {counts.Shipped} in transit
              </span>
            )}
            <Btn variant="secondary" size="sm" icon="Download" onClick={exportCsv} loading={exporting}>Export CSV</Btn>
          </>
        }
      />

      <div className="flex items-center gap-1 border-b border-divider mb-4 overflow-x-auto -mx-1 px-1">
        {STATUS_TABS.map((t) => {
          const active = filters.tab === t;
          const count = counts[t] ?? 0;
          if (count === 0 && !["All", "Pending", "Approved", "Shipped"].includes(t)) return null;
          return (
            <button key={t} onClick={() => setParam({ tab: t === "All" ? null : t })}
              className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
              {t}
              <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded ${active ? "text-accent2 bg-accent/15" : "text-faint bg-white/5"}`}>{count}</span>
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20 flex-wrap">
          <span className="text-[13px] font-medium text-accent2">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <Btn variant="secondary" size="sm" icon="Check" disabled={fetcher.state !== "idle"} onClick={() => bulk("APPROVED")}>Approve</Btn>
            <Btn variant="secondary" size="sm" icon="X" disabled={fetcher.state !== "idle"} onClick={() => setRejectOpen(true)}>Reject</Btn>
            <Btn variant="secondary" size="sm" icon="PackageCheck" disabled={fetcher.state !== "idle"} onClick={() => bulk("RECEIVED")}>Mark received</Btn>
          </div>
          <span className="text-[11.5px] text-muted">Customers are notified and Shopify is updated.</span>
          <button className="ml-auto text-faint hover:text-ink" onClick={() => setSelected(new Set())}><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[280px] max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Icon name="Search" size={14} /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by RMA, order, customer, email…"
            className="w-full h-9 pl-9 pr-3 text-[13px] rounded-md bg-surface border border-border text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </div>
        <Select value={filters.range} onChange={(v: string) => setParam({ range: v === "all" ? null : v })} className="w-[170px]"
          options={RANGES.map((r) => ({ value: r.key, label: r.label }))} />
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] whitespace-nowrap min-w-[820px]">
            <thead className="bg-bg/40">
              <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-divider">
                <th className="font-semibold py-3 pl-5 pr-2 w-8">
                  <input type="checkbox" className="rf-check" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
                </th>
                <th className="text-left font-semibold py-3">RMA</th>
                <th className="text-left font-semibold py-3">Order</th>
                <th className="text-left font-semibold py-3">Customer</th>
                <th className="text-left font-semibold py-3">Date</th>
                <th className="text-left font-semibold py-3">Items</th>
                <th className="text-right font-semibold py-3">Amount</th>
                <th className="text-left font-semibold py-3 pl-4">Status</th>
                <th className="text-right font-semibold py-3 pr-5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-muted">
                  <div className="flex flex-col items-center gap-2">
                    <Icon name="PackageOpen" size={28} className="text-faint" />
                    <div className="text-[13px]">No returns match your filters.</div>
                  </div>
                </td></tr>
              )}
              {rows.map((r, i) => {
                const [c1, c2] = avatarColors[i % 5];
                return (
                  <tr key={r.rma}
                    className={`border-b border-divider last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors ${selected.has(r.rma) ? "bg-accent/[0.04]" : ""}`}
                    onClick={() => navigate(`/app/returns/${r.rma}${location.search}`)}>
                    <td className="py-3.5 pl-5 pr-2 relative z-10" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rf-check" checked={selected.has(r.rma)} onChange={() => toggleOne(r.rma)} />
                    </td>
                    <td className="py-3.5 font-mono text-[12px] text-ink">
                      <div className="flex items-center gap-1.5">
                        {r.rma}
                        {r.requestType === "WITHDRAWAL" && <span title="EU withdrawal" className="text-[9.5px] font-bold px-1 rounded" style={{ background: "rgba(245,158,11,0.14)", color: "#F59E0B" }}>EU</span>}
                        {r.keepItem && <span title="Green return — customer keeps the item"><Icon name="Leaf" size={12} className="text-ok" /></span>}
                      </div>
                    </td>
                    <td className="py-3.5 text-muted">{r.order}</td>
                    <td className="py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full grid place-content-center text-[11px] font-semibold text-white shrink-0" style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
                          {r.customer.split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <div className="text-ink leading-tight flex items-center gap-1.5">{r.customer} {showRisk && <RiskBadge level={r.riskLevel} compact />}</div>
                          <div className="text-[11px] text-muted leading-tight mt-0.5">{r.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 text-muted">{new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td className="py-3.5 text-muted">{r.itemsCount}</td>
                    <td className="py-3.5 text-right tabular-nums text-ink font-medium">{formatMoney(r.amount, currency)}</td>
                    <td className="py-3.5 pl-4"><StatusBadge status={r.status} /></td>
                    <td className="py-3.5 pr-5 text-right relative z-10" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/app/returns/${r.rma}${location.search}`} className="text-[12px] font-medium px-2.5 py-1 rounded border border-border text-ink hover:bg-white/5 hover:border-[#3a3e58] transition">
                        {r.status === "PENDING" ? "Review" : r.status === "APPROVED" || r.status === "RECEIVED" ? "Action" : "View"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-divider bg-bg/20">
          <div className="text-[12.5px] text-muted">
            Showing <span className="text-ink font-medium">{total === 0 ? 0 : (filters.page - 1) * pageSize + 1}–{Math.min(total, filters.page * pageSize)}</span> of <span className="text-ink font-medium">{total}</span> returns
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-1.5">
              <Btn variant="ghost" size="sm" icon="ChevronLeft" disabled={filters.page <= 1} onClick={() => setParam({ page: String(filters.page - 1) })}>Prev</Btn>
              <span className="text-[12px] text-muted tabular-nums">{filters.page} / {pages}</span>
              <Btn variant="ghost" size="sm" iconRight="ChevronRight" disabled={filters.page >= pages} onClick={() => setParam({ page: String(filters.page + 1) })}>Next</Btn>
            </div>
          )}
        </div>
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={`Reject ${selected.size} return${selected.size > 1 ? "s" : ""}?`}
        footer={<>
          <Btn variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Btn>
          <Btn variant="danger" icon="X" disabled={!rejectReason.trim() || fetcher.state !== "idle"} onClick={() => bulk("REJECTED", rejectReason)}>Reject & notify</Btn>
        </>}>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Reason sent to the customers</label>
        <Textarea value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} rows={3} placeholder="e.g. Outside the return window." />
      </Modal>
    </div>
  );
}
