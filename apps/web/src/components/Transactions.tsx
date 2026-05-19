import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionListResponse,
  type TransactionRow,
  type TransactionPost,
} from '../lib/api';
import { cn } from '../lib/utils';

function sourceBadge(source: TransactionRow['source']): string {
  if (source === 'Actual') return 'bg-emerald-500/20 text-emerald-200';
  if (source === 'Forecast') return 'bg-amber-500/20 text-amber-200';
  return 'bg-violet-500/20 text-violet-200';
}

const PAGE_SIZE = 100;

export function Transactions() {
  const [data, setData] = useState<TransactionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<'' | 'IN' | 'OUT'>('');
  const [source, setSource] = useState<'' | 'Actual' | 'Forecast' | 'Predicted'>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = useCallback(() => {
    listTransactions({
      from: from || undefined,
      to: to || undefined,
      type: type || undefined,
      source: source || undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, to, type, source, q, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reset to page 0 when filters change.
  useEffect(() => {
    setPage(0);
  }, [from, to, type, source, q]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this prediction?')) return;
    setBusy(true);
    try {
      await deleteTransaction(id);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Transactions</h2>
            <p className="text-xs text-muted-foreground">
              Actual + Forecast rows come from the spreadsheet (read-only). Predicted rows are
              created here and survive re-imports.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {data && (
                <>
                  <span className="font-mono text-primary">
                    {data.total.toLocaleString()}
                  </span>{' '}
                  matching
                </>
              )}
            </div>
            <button
              onClick={() => setAdding(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              + Add Predicted
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            title="From date"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            title="To date"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as '' | 'IN' | 'OUT')}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">All types</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as '' | TransactionRow['source'])}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">All sources</option>
            <option value="Actual">Actual</option>
            <option value="Forecast">Forecast</option>
            <option value="Predicted">Predicted</option>
          </select>
          <input
            type="text"
            placeholder="Search description / herd / counterparty / txn#…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 py-1 text-sm"
          />
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
              <th className="px-2 py-2">Txn #</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-2 py-2">Class</th>
              <th className="px-2 py-2">Herd</th>
              <th className="px-2 py-2 text-right">Head</th>
              <th className="px-2 py-2">Counterparty</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <TransactionFormRow
                onCancel={() => setAdding(false)}
                onSubmit={async (t) => {
                  setBusy(true);
                  try {
                    await createTransaction(t);
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

            {data?.rows.map((r) => {
              const isEditing = editingId === r.id;
              const isPredicted = r.source === 'Predicted';
              if (isEditing) {
                return (
                  <TransactionFormRow
                    key={r.id}
                    initial={r}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (t) => {
                      setBusy(true);
                      try {
                        await updateTransaction(r.id, t);
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
                  <td className="px-2 py-1.5 font-mono">{r.txn_number ?? '—'}</td>
                  <td className="px-2 py-1.5 font-medium">{r.type}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px]', sourceBadge(r.source))}>
                      {r.source}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{r.livestock_class ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.herd ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {Math.abs(r.head_count).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5">{r.origin_destination ?? '—'}</td>
                  <td className="px-2 py-1.5 max-w-xs truncate text-muted-foreground" title={r.description ?? ''}>
                    {r.description ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {isPredicted ? (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditingId(r.id)}
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
                    ) : (
                      <span className="text-[10px] text-muted-foreground">read-only</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && data.rows.length === 0 && !adding && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  No transactions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && totalPages > 1 && (
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
            {Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
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

function TransactionFormRow({
  initial,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial?: TransactionRow;
  onSubmit: (t: TransactionPost) => Promise<void> | void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(initial?.date ?? today);
  const [type, setType] = useState<'IN' | 'OUT'>(initial?.type ?? 'IN');
  const [head, setHead] = useState(initial ? Math.abs(initial.head_count) : 0);
  const [livestockClass, setLivestockClass] = useState(initial?.livestock_class ?? '');
  const [herd, setHerd] = useState(initial?.herd ?? '');
  const [counterparty, setCounterparty] = useState(initial?.origin_destination ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const submit = () => {
    if (head <= 0) return;
    void onSubmit({
      date,
      type,
      head_count: head,
      livestock_class: livestockClass || undefined,
      herd: herd || undefined,
      origin_destination: counterparty || undefined,
      description: description || undefined,
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
      <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
        (auto)
      </td>
      <td className="px-2 py-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'IN' | 'OUT')}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
      </td>
      <td className="px-2 py-2 text-[10px] text-muted-foreground">Predicted</td>
      <td className="px-2 py-2">
        <input
          type="text"
          placeholder="feeder_steer"
          value={livestockClass}
          onChange={(e) => setLivestockClass(e.target.value)}
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          placeholder="FB / F1 / EUHQB"
          value={herd}
          onChange={(e) => setHerd(e.target.value)}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="number"
          min={1}
          value={head || ''}
          onChange={(e) => setHead(Number(e.target.value))}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full min-w-[200px] rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end gap-1">
          <button
            onClick={submit}
            disabled={disabled || head <= 0}
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
