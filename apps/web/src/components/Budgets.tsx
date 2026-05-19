import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBudgetSummary, type BudgetSummary } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CATEGORY_COLORS: Record<string, string> = {
  'External Purchase': '#f97316',
  'Internal Transfer': '#06b6d4',
  Freight: '#a855f7',
};
function categoryColor(name: string | null): string {
  if (!name) return '#888';
  return CATEGORY_COLORS[name] ?? '#10b981';
}

function fmt$(n: number | null | undefined): string {
  if (n == null || n === 0) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

export function Budgets() {
  const [data, setData] = useState<BudgetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const reload = useCallback(() => {
    fetchBudgetSummary(from || undefined, to || undefined, 'IN')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Monthly chart shape: one bar per month, stacked by category.
  const { chartData, categories } = useMemo(() => {
    if (!data) return { chartData: [], categories: [] as string[] };
    const months = new Map<string, Record<string, number | string>>();
    const cats = new Set<string>();
    for (const m of data.monthly) {
      const cat = m.category ?? 'Uncategorized';
      cats.add(cat);
      if (!months.has(m.month)) months.set(m.month, { month: m.month });
      months.get(m.month)![cat] = (Number(months.get(m.month)![cat]) || 0) + m.total_cost;
    }
    return {
      chartData: [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month))),
      categories: [...cats],
    };
  }, [data]);

  if (error && !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading budget summary…</div>;
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Budgets · Cost Tracking</h2>
              <p className="text-xs text-muted-foreground">
                Inbound cost summary from External Purchase + Internal Transfer budgets. Revenue
                tracking comes later.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
          <Kpi label="Total cost" value={fmt$(data.kpis.total_cost)} />
          <Kpi label="Freight" value={fmt$(data.kpis.total_freight)} />
          <Kpi label="Head" value={data.kpis.total_head.toLocaleString()} />
          <Kpi label="Transactions" value={data.kpis.n_transactions.toLocaleString()} />
        </div>
      </div>

      {/* Monthly chart */}
      {chartData.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Monthly cost by category</h3>
          </div>
          <div className="px-4 py-3" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#888' }}
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    fontSize: 11,
                  }}
                  formatter={(v: number) => fmt$(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {categories.map((cat) => (
                  <Bar key={cat} dataKey={cat} stackId="cost" fill={categoryColor(cat)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="By counterparty"
          rows={data.by_counterparty.map((r) => ({
            label: r.counterparty,
            cost: r.total_cost,
            head: r.total_head,
            n: r.n,
            extra: null,
          }))}
        />
        <BreakdownTable
          title="By livestock class"
          rows={data.by_class.map((r) => ({
            label: r.livestock_class,
            cost: r.total_cost,
            head: r.total_head,
            n: r.n,
            extra: r.avg_price_per_kg != null ? `$${r.avg_price_per_kg.toFixed(2)}/kg` : null,
          }))}
        />
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    cost: number;
    head: number;
    n: number;
    extra: string | null;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Name</th>
            <th className="px-2 py-2 text-right">Head</th>
            <th className="px-2 py-2 text-right">Cost</th>
            <th className="px-2 py-2 text-right">Extra</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/40 hover:bg-accent/10">
              <td className="px-3 py-1.5">{r.label}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {r.head.toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">
                {fmt$(r.cost)}
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{r.extra ?? '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                No cost data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
