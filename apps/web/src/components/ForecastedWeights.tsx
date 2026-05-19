import { useEffect, useMemo, useState } from 'react';
import {
  fetchForecastedWeights,
  type AnimalForecast,
  type ForecastedWeightsResponse,
} from '../lib/api';
import { cn } from '../lib/utils';

const PAGE_SIZE = 100;

/** Deterministic palette by band name — keeps colors stable across renders. */
const BAND_COLORS: Record<string, string> = {
  EUHQB: 'bg-amber-500/30 text-amber-100',
  'Feeder Steer EU': 'bg-emerald-500/25 text-emerald-100',
  'Feeder Steer Non-EU': 'bg-cyan-500/25 text-cyan-100',
  'Feeder Heifer EU': 'bg-rose-500/25 text-rose-100',
  'Feeder Heifer Non-EU': 'bg-violet-500/25 text-violet-100',
};

function bandColor(name: string | null): string {
  if (!name) return '';
  return BAND_COLORS[name] ?? 'bg-primary/20';
}

function fmtDate(iso: string): { mmm: string; day: string } {
  const d = new Date(iso);
  return {
    mmm: d.toLocaleString('en-US', { month: 'short' }),
    day: String(d.getDate()),
  };
}

export function ForecastedWeights() {
  const [data, setData] = useState<ForecastedWeightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sexFilter, setSexFilter] = useState('');
  const [breedFilter, setBreedFilter] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [paddockFilter, setPaddockFilter] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetchForecastedWeights()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const breeds = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.animals.map((a) => a.breed_type).filter(Boolean))].sort() as string[];
  }, [data]);

  const paddocks = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.animals.map((a) => a.paddock_name).filter(Boolean))].sort() as string[];
  }, [data]);

  const filtered = useMemo<AnimalForecast[]>(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.animals.filter((a) => {
      if (sexFilter && a.sex !== sexFilter) return false;
      if (breedFilter && a.breed_type !== breedFilter) return false;
      if (paddockFilter && a.paddock_name !== paddockFilter) return false;
      if (bandFilter && a.predicted_band !== bandFilter) return false;
      if (term) {
        const haystack = [a.eid, a.visual_id, a.mob_name, a.paddock_name, a.livestock_class]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [data, search, sexFilter, breedFilter, paddockFilter, bandFilter]);

  // Reset page if filter result shrinks below current page.
  useEffect(() => {
    setPage(0);
  }, [search, sexFilter, breedFilter, paddockFilter, bandFilter]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }
  if (!data) return <div className="text-sm text-muted-foreground">Loading forecasted weights…</div>;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Band distribution among filtered set — for the summary chips.
  const bandCounts = new Map<string, number>();
  let noBand = 0;
  for (const a of filtered) {
    if (a.predicted_band) {
      bandCounts.set(a.predicted_band, (bandCounts.get(a.predicted_band) ?? 0) + 1);
    } else {
      noBand++;
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Forecasted Weights</h2>
            <p className="text-xs text-muted-foreground">
              Projected weight per animal at future dates · cells colored by market band entry ·
              today: <span className="font-mono">{data.today}</span>
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono text-primary">{filtered.length.toLocaleString()}</span> /{' '}
            <span className="font-mono">{data.animals.length.toLocaleString()}</span> animals
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <input
            type="text"
            placeholder="Search EID / Visual / mob / paddock…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={paddockFilter}
            onChange={(e) => setPaddockFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">All paddocks</option>
            {paddocks.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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
            value={sexFilter}
            onChange={(e) => setSexFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">M+F</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
          <select
            value={bandFilter}
            onChange={(e) => setBandFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">All predicted bands</option>
            {data.bands.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {[...bandCounts.entries()].map(([name, count]) => (
            <span
              key={name}
              className={cn('rounded-md px-2 py-1 font-medium', bandColor(name))}
            >
              {name}: {count}
            </span>
          ))}
          {noBand > 0 && (
            <span className="rounded-md bg-muted/40 px-2 py-1 font-medium text-muted-foreground">
              no band: {noBand}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-card text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-20 bg-card px-2 py-2 border-b border-border">Visual</th>
              <th className="px-2 py-2 border-b border-border">EID</th>
              <th className="px-2 py-2 border-b border-border">Sex</th>
              <th className="px-2 py-2 border-b border-border">Mob</th>
              <th className="px-2 py-2 border-b border-border">Paddock</th>
              <th className="px-2 py-2 border-b border-border text-right">Last Wgt</th>
              <th className="px-2 py-2 border-b border-border text-right">ADG</th>
              <th className="px-2 py-2 border-b border-border text-right">Pred Exit</th>
              <th className="px-2 py-2 border-b border-border">Pred Band</th>
              {data.date_columns.map((d) => {
                const fd = fmtDate(d);
                return (
                  <th key={d} className="border-b border-l border-border px-2 py-1 text-center font-mono">
                    <div>{fd.mmm}</div>
                    <div className="text-muted-foreground">{fd.day}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((a) => (
              <AnimalRow key={a.id} animal={a} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9 + data.date_columns.length}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No animals match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-border bg-background px-2 py-1 disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages} · rows {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md border border-border bg-background px-2 py-1 disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function AnimalRow({ animal: a }: { animal: AnimalForecast }) {
  return (
    <tr className="hover:bg-accent/10">
      <td className="sticky left-0 z-10 bg-card px-2 py-1.5 font-mono border-b border-border/40">
        {a.visual_id ?? '—'}
      </td>
      <td className="px-2 py-1.5 font-mono text-muted-foreground border-b border-border/40">
        {a.eid ?? '—'}
      </td>
      <td className="px-2 py-1.5 border-b border-border/40">{a.sex ?? '—'}</td>
      <td className="px-2 py-1.5 border-b border-border/40">{a.mob_name ?? '—'}</td>
      <td className="px-2 py-1.5 text-muted-foreground border-b border-border/40">
        {a.paddock_name ?? '—'}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums border-b border-border/40">
        {Math.round(a.last_weight)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground border-b border-border/40">
        {a.adg.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground border-b border-border/40">
        {a.predicted_exit_date ?? '—'}
      </td>
      <td
        className={cn(
          'px-2 py-1.5 font-medium border-b border-border/40',
          a.predicted_band && bandColor(a.predicted_band),
        )}
      >
        {a.predicted_band ?? '—'}
      </td>
      {a.projections.map((w, i) => {
        const band = a.band_hits[i];
        // First-entry cell gets a stronger badge; later same-band cells get a softer one.
        const firstHit = a.band_hits.findIndex((b) => b != null) === i;
        return (
          <td
            key={i}
            className={cn(
              'border-l border-b border-border/40 px-2 py-1.5 text-center font-mono tabular-nums',
              band && bandColor(band),
              firstHit && 'ring-1 ring-inset ring-primary/60',
            )}
            title={band ?? ''}
          >
            {Math.round(w)}
          </td>
        );
      })}
    </tr>
  );
}
