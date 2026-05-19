import { useEffect, useMemo, useState } from 'react';
import { fetchStockOnHand, type StockOnHandRow } from '../lib/api';
import { cn } from '../lib/utils';

function daysToExitClass(days: number | null): string {
  if (days == null) return '';
  if (days < 0) return 'text-emerald-400 font-semibold'; // already at target
  if (days <= 30) return 'text-emerald-400';
  if (days <= 90) return 'text-amber-400';
  return 'text-muted-foreground';
}

function fmt(n: number | null, opts: { decimals?: number; suffix?: string } = {}): string {
  if (n == null) return '—';
  const { decimals = 0, suffix = '' } = opts;
  const v = decimals === 0 ? Math.round(n).toLocaleString() : n.toFixed(decimals);
  return `${v}${suffix}`;
}

export function StockOnHand() {
  const [rows, setRows] = useState<StockOnHandRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [breedFilter, setBreedFilter] = useState('');
  const [marketFilter, setMarketFilter] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  useEffect(() => {
    fetchStockOnHand()
      .then((d) => setRows(d.rows))
      .catch((e: Error) => setError(e.message));
  }, []);

  const { breeds, markets, properties } = useMemo(() => {
    const breeds = new Set<string>();
    const markets = new Set<string>();
    const properties = new Set<string>();
    for (const r of rows ?? []) {
      if (r.breed_type) breeds.add(r.breed_type);
      if (r.market_class) markets.add(r.market_class);
      if (r.property) properties.add(r.property);
    }
    return {
      breeds: [...breeds].sort(),
      markets: [...markets].sort(),
      properties: [...properties].sort(),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideEmpty && r.head_count === 0) return false;
      if (breedFilter && r.breed_type !== breedFilter) return false;
      if (marketFilter && r.market_class !== marketFilter) return false;
      if (term) {
        const haystack = [r.mob, r.paddock, r.property, r.breed_type, r.market_class]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, breedFilter, marketFilter, hideEmpty]);

  // Group by property → paddock for the visual hierarchy.
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, StockOnHandRow[]>>();
    for (const r of filtered) {
      const propKey = r.property ?? '—';
      const padKey = r.paddock;
      if (!map.has(propKey)) map.set(propKey, new Map());
      const padMap = map.get(propKey)!;
      if (!padMap.has(padKey)) padMap.set(padKey, []);
      padMap.get(padKey)!.push(r);
    }
    return map;
  }, [filtered]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }
  if (!rows) return <div className="text-sm text-muted-foreground">Loading stock on hand…</div>;

  const totalHead = filtered.reduce((s, r) => s + r.head_count, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Stock on Hand</h2>
              <p className="text-xs text-muted-foreground">
                Per-mob aggregates with on-the-fly weight projections from last-weigh + ADG.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono text-primary">{totalHead.toLocaleString()}</span> head ·{' '}
              <span className="font-mono text-primary">{filtered.length}</span> mob
              {filtered.length === 1 ? '' : 's'} · {properties.length} propert
              {properties.length === 1 ? 'y' : 'ies'}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <input
              type="text"
              placeholder="Search paddock / mob / property…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <select
              value={breedFilter}
              onChange={(e) => setBreedFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">All breeds</option>
              {breeds.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">All market classes</option>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
              />
              Hide mobs with no animals
            </label>
          </div>
        </div>

        {/* Desktop / tablet: full table with horizontal scroll */}
        <div className="scroll-touch hidden overflow-x-auto md:block">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="border-b border-border bg-card text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-3 py-2">Paddock / Mob</th>
                <th className="px-2 py-2">Breed</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2 text-right">Head</th>
                <th className="px-2 py-2 text-right">Avg</th>
                <th className="px-2 py-2 text-right">Min</th>
                <th className="px-2 py-2 text-right">Max</th>
                <th className="px-2 py-2">Last Weigh</th>
                <th className="px-2 py-2 text-right">DSLW</th>
                <th className="px-2 py-2 text-right">ADG</th>
                <th className="px-2 py-2 text-right">Est. Wgt</th>
                <th className="px-2 py-2 text-right">Pred. Min</th>
                <th className="px-2 py-2 text-right">Pred. Max</th>
                <th className="px-2 py-2 text-right">Target</th>
                <th className="px-2 py-2 text-right">Days to Exit</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([property, paddocks]) => (
                <PropertyGroup key={property} property={property} paddocks={paddocks} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-muted-foreground">
                    No mobs match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list (≤md). Same grouping, more thumb-friendly density. */}
        <div className="space-y-4 px-2 py-3 md:hidden">
          {[...grouped.entries()].map(([property, paddocks]) => (
            <MobilePropertyGroup key={property} property={property} paddocks={paddocks} />
          ))}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No mobs match your filters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MobilePropertyGroup({
  property,
  paddocks,
}: {
  property: string;
  paddocks: Map<string, StockOnHandRow[]>;
}) {
  const head = [...paddocks.values()].flat().reduce((s, r) => s + r.head_count, 0);
  return (
    <section className="space-y-2">
      <h3 className="sticky top-[140px] z-10 bg-card/95 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary backdrop-blur">
        {property} · {head.toLocaleString()} head
      </h3>
      <div className="space-y-3">
        {[...paddocks.entries()].map(([paddock, mobs]) => (
          <div key={paddock} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
              {paddock}
            </p>
            {mobs.map((r) => (
              <MobileMobCard key={r.mob_id} row={r} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MobileMobCard({ row: r }: { row: StockOnHandRow }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{r.mob}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.breed_type ?? '—'} · {r.market_class ?? '—'}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {r.head_count.toLocaleString()}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">head</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Avg wgt" value={fmt(r.avg_weight, { decimals: 1 })} />
        <Stat label="Est. wgt" value={fmt(r.estimated_weight, { decimals: 1 })} highlight />
        <Stat
          label="Days to exit"
          value={r.days_to_exit == null ? '—' : String(r.days_to_exit)}
          className={daysToExitClass(r.days_to_exit)}
        />
        <Stat label="DSLW" value={r.days_since_last_weigh?.toString() ?? '—'} />
        <Stat label="ADG" value={fmt(r.adg, { decimals: 2 })} />
        <Stat label="Target" value={fmt(r.target_exit_weight)} />
      </dl>
      {r.last_weigh_date && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Last weighed <span className="font-mono">{r.last_weigh_date}</span>
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-mono tabular-nums',
          highlight && 'font-semibold text-primary',
          className,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function PropertyGroup({
  property,
  paddocks,
}: {
  property: string;
  paddocks: Map<string, StockOnHandRow[]>;
}) {
  const head = [...paddocks.values()].flat().reduce((s, r) => s + r.head_count, 0);
  return (
    <>
      <tr className="border-t-2 border-t-border bg-accent/20">
        <td colSpan={15} className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {property} · {head.toLocaleString()} head
        </td>
      </tr>
      {[...paddocks.entries()].map(([paddock, mobs]) => (
        <PaddockGroup key={`${property}-${paddock}`} paddock={paddock} mobs={mobs} />
      ))}
    </>
  );
}

function PaddockGroup({ paddock, mobs }: { paddock: string; mobs: StockOnHandRow[] }) {
  return (
    <>
      {mobs.map((r, idx) => (
        <tr key={r.mob_id} className="border-b border-border/40 hover:bg-accent/10">
          <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
            {idx === 0 && (
              <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
                {paddock}
              </div>
            )}
            <div className="text-muted-foreground">{r.mob}</div>
          </td>
          <td className="px-2 py-1.5 text-muted-foreground">{r.breed_type ?? '—'}</td>
          <td className="px-2 py-1.5 text-muted-foreground">{r.market_class ?? '—'}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
            {r.head_count.toLocaleString()}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(r.avg_weight, { decimals: 1 })}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(r.min_weight)}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(r.max_weight)}</td>
          <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.last_weigh_date ?? '—'}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
            {r.days_since_last_weigh ?? '—'}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
            {fmt(r.adg, { decimals: 2 })}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">
            {fmt(r.estimated_weight, { decimals: 1 })}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
            {fmt(r.pred_min_weight, { decimals: 1 })}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
            {fmt(r.pred_max_weight, { decimals: 1 })}
          </td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
            {fmt(r.target_exit_weight)}
          </td>
          <td className={cn('px-2 py-1.5 text-right font-mono tabular-nums', daysToExitClass(r.days_to_exit))}>
            {r.days_to_exit == null ? '—' : r.days_to_exit}
          </td>
        </tr>
      ))}
    </>
  );
}
