import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchFeedTypes,
  listFeedEvents,
  createFeedEvent,
  updateFeedEvent,
  deleteFeedEvent,
  fetchFeedSummary,
  type FeedEvent,
  type FeedEventPost,
  type FeedType,
  type FeedSummaryRow,
} from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PAGE_SIZE = 100;

// Stable palette by feed type name.
const FEED_COLORS: Record<string, string> = {
  Hay: '#f59e0b',
  Silage: '#10b981',
  Pellets: '#06b6d4',
  Grain: '#a855f7',
};
function feedColor(name: string): string {
  return FEED_COLORS[name] ?? '#f97316';
}

export function Feeding() {
  const [feedTypes, setFeedTypes] = useState<FeedType[]>([]);
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<FeedSummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [feedTypeFilter, setFeedTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => {
    listFeedEvents({
      from: from || undefined,
      to: to || undefined,
      feed_type_id: feedTypeFilter ? Number(feedTypeFilter) : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((d) => {
        setEvents(d.rows);
        setTotal(d.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    fetchFeedSummary(from || undefined, to || undefined)
      .then((d) => setSummary(d.rows))
      .catch(() => {});
  }, [from, to, feedTypeFilter, page]);

  useEffect(() => {
    fetchFeedTypes()
      .then((d) => setFeedTypes(d.rows))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setPage(0);
  }, [from, to, feedTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const headerKg = summary.reduce((s, r) => s + r.total_kg, 0);
  const headerCost = summary.reduce((s, r) => s + r.total_cost, 0);

  // Aggregate summary into chart shape: one bar per date, stacked by feed type.
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of summary) {
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      byDate.get(r.date)![r.feed_type_name] = r.total_kg;
    }
    return [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [summary]);

  const feedTypeNames = useMemo(
    () => [...new Set(summary.map((r) => r.feed_type_name))],
    [summary],
  );

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this feed event?')) return;
    setBusy(true);
    try {
      await deleteFeedEvent(id);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !events) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Feeding</h2>
            <p className="text-xs text-muted-foreground">
              Feed events log + daily totals by feed type. Add events as feedings happen.
            </p>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-mono text-primary">{Math.round(headerKg).toLocaleString()}</span>{' '}
              kg
            </span>
            {headerCost > 0 && (
              <span>
                <span className="font-mono text-primary">${Math.round(headerCost).toLocaleString()}</span>
              </span>
            )}
            <span>
              <span className="font-mono text-primary">{total.toLocaleString()}</span> events
            </span>
          </div>
        </div>

        {chartData.length > 0 && (
          <div className="px-4 py-3" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    fontSize: 11,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {feedTypeNames.map((name) => (
                  <Bar
                    key={name}
                    dataKey={name}
                    stackId="kg"
                    fill={feedColor(name)}
                    name={name}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Filters + table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              title="From"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              title="To"
            />
            <select
              value={feedTypeFilter}
              onChange={(e) => setFeedTypeFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">All feed types</option>
              {feedTypes.map((ft) => (
                <option key={ft.id} value={ft.id}>
                  {ft.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
              className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              + Add feed event
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Feed</th>
                <th className="px-2 py-2">Mob / Group</th>
                <th className="px-2 py-2 text-right">Head</th>
                <th className="px-2 py-2 text-right">kg/hd/day</th>
                <th className="px-2 py-2 text-right">Days</th>
                <th className="px-2 py-2 text-right">Total kg</th>
                <th className="px-2 py-2 text-right">$/kg</th>
                <th className="px-2 py-2 text-right">$ Total</th>
                <th className="px-2 py-2">Notes</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {adding && (
                <FeedEventForm
                  feedTypes={feedTypes}
                  onCancel={() => setAdding(false)}
                  onSubmit={async (e) => {
                    setBusy(true);
                    try {
                      await createFeedEvent(e);
                      setAdding(false);
                      reload();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                />
              )}

              {events?.map((r) => {
                if (editingId === r.id) {
                  return (
                    <FeedEventForm
                      key={r.id}
                      feedTypes={feedTypes}
                      initial={r}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (e) => {
                        setBusy(true);
                        try {
                          await updateFeedEvent(r.id, e);
                          setEditingId(null);
                          reload();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    />
                  );
                }
                return (
                  <tr key={r.id} className="border-b border-border/40 align-top hover:bg-accent/10">
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.date}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: `${feedColor(r.feed_type_name)}33`,
                          color: feedColor(r.feed_type_name),
                        }}
                      >
                        {r.feed_type_name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{r.mob_name ?? r.cattle_group ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {r.head_count?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {r.kg_per_head_per_day ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {r.duration_days}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">
                      {Math.round(r.total_kg).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {r.cost_per_unit ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {r.total_cost != null ? `$${Math.round(r.total_cost).toLocaleString()}` : '—'}
                    </td>
                    <td
                      className="px-2 py-1.5 max-w-xs truncate text-muted-foreground"
                      title={r.notes ?? ''}
                    >
                      {r.notes ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingId(r.id);
                            setAdding(false);
                          }}
                          className="rounded border border-border bg-background px-2 py-0.5 text-[10px]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={busy}
                          className="rounded border border-border bg-background px-2 py-0.5 text-[10px] hover:text-destructive disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {events && events.length === 0 && !adding && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                    No feed events. Click "+ Add feed event" to log one.
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
              Page {page + 1} of {totalPages} · {total.toLocaleString()} events
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
    </div>
  );
}

function FeedEventForm({
  initial,
  feedTypes,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial?: FeedEvent;
  feedTypes: FeedType[];
  onSubmit: (e: FeedEventPost) => Promise<void> | void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(initial?.date ?? today);
  const [feedTypeId, setFeedTypeId] = useState<number>(
    initial?.feed_type_id ?? feedTypes[0]?.id ?? 0,
  );
  const [group, setGroup] = useState(initial?.cattle_group ?? initial?.mob_name ?? '');
  const [head, setHead] = useState<number | null>(initial?.head_count ?? null);
  const [kgPerHd, setKgPerHd] = useState<number | null>(initial?.kg_per_head_per_day ?? null);
  const [days, setDays] = useState<number>(initial?.duration_days ?? 1);
  const [totalKgOverride, setTotalKgOverride] = useState<number | null>(null);
  const [costPerUnit, setCostPerUnit] = useState<number | null>(initial?.cost_per_unit ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const computedKg = useMemo(() => {
    if (totalKgOverride != null) return totalKgOverride;
    if (head != null && kgPerHd != null) return head * kgPerHd * days;
    return null;
  }, [head, kgPerHd, days, totalKgOverride]);

  const submit = () => {
    if (!feedTypeId) return;
    void onSubmit({
      date,
      feed_type_id: feedTypeId,
      cattle_group: group || null,
      head_count: head,
      kg_per_head_per_day: kgPerHd,
      duration_days: days,
      total_kg: totalKgOverride ?? undefined,
      cost_per_unit: costPerUnit,
      notes: notes || null,
    });
  };

  return (
    <tr className="border-b border-primary/40 bg-primary/5 align-top">
      <td className="px-2 py-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={feedTypeId}
          onChange={(e) => setFeedTypeId(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {feedTypes.map((ft) => (
            <option key={ft.id} value={ft.id}>
              {ft.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="Mob / cattle group"
          className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          value={head ?? ''}
          onChange={(e) => setHead(e.target.value === '' ? null : Number(e.target.value))}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          step="0.1"
          min={0}
          value={kgPerHd ?? ''}
          onChange={(e) => setKgPerHd(e.target.value === '' ? null : Number(e.target.value))}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="number"
          placeholder={computedKg != null ? String(Math.round(computedKg)) : '—'}
          value={totalKgOverride ?? ''}
          onChange={(e) =>
            setTotalKgOverride(e.target.value === '' ? null : Number(e.target.value))
          }
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          step="0.01"
          min={0}
          value={costPerUnit ?? ''}
          onChange={(e) =>
            setCostPerUnit(e.target.value === '' ? null : Number(e.target.value))
          }
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2 text-right text-muted-foreground">
        {computedKg != null && costPerUnit != null
          ? `$${Math.round(computedKg * costPerUnit).toLocaleString()}`
          : '—'}
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full min-w-[120px] rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end gap-1">
          <button
            onClick={submit}
            disabled={disabled || !feedTypeId || computedKg == null}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {initial ? 'Save' : 'Add'}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
