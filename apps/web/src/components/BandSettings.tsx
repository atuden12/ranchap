import { useEffect, useState } from 'react';
import {
  fetchBands,
  createBand,
  updateBand,
  deleteBand,
  type MarketBand,
} from '../lib/api';
import { cn } from '../lib/utils';

export function BandSettings({ onChanged }: { onChanged?: () => void }) {
  const [bands, setBands] = useState<MarketBand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fetchBands()
      .then((d) => {
        setBands(d.bands);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(reload, []);

  const change = (id: number, patch: Partial<MarketBand>) => {
    setBands((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const save = async (b: MarketBand) => {
    setBusy(true);
    try {
      await updateBand(b.id, {
        name: b.name,
        sex: b.sex,
        min_weight_kg: b.min_weight_kg,
        max_weight_kg: b.max_weight_kg,
        priority: b.priority,
      });
      reload();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this market band?')) return;
    setBusy(true);
    try {
      await deleteBand(id);
      reload();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [draft, setDraft] = useState<Omit<MarketBand, 'id'>>({
    name: '',
    sex: null,
    min_weight_kg: 0,
    max_weight_kg: 0,
    priority: 100,
  });

  const add = async () => {
    if (!draft.name || draft.min_weight_kg <= 0 || draft.max_weight_kg <= draft.min_weight_kg) {
      setError('Need name + valid min/max (max > min).');
      return;
    }
    setBusy(true);
    try {
      await createBand(draft);
      setDraft({ name: '', sex: null, min_weight_kg: 0, max_weight_kg: 0, priority: 100 });
      reload();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Market Bands</h2>
        <p className="text-xs text-muted-foreground">
          Liveweight ranges used to classify projected animal weights. Priority decides which
          band wins when ranges overlap (lower number = preferred).
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">Name</th>
            <th className="px-2 py-2">Sex</th>
            <th className="px-2 py-2 text-right">Min (kg)</th>
            <th className="px-2 py-2 text-right">Max (kg)</th>
            <th className="px-2 py-2 text-right">Priority</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.id} className="border-t border-border/40">
              <td className="px-4 py-1.5">
                <input
                  type="text"
                  value={b.name}
                  onChange={(e) => change(b.id, { name: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </td>
              <td className="px-2 py-1.5">
                <select
                  value={b.sex ?? ''}
                  onChange={(e) =>
                    change(b.id, { sex: e.target.value === '' ? null : (e.target.value as 'M' | 'F') })
                  }
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  <option value="">M+F</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  step="1"
                  value={b.min_weight_kg}
                  onChange={(e) => change(b.id, { min_weight_kg: Number(e.target.value) })}
                  className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  step="1"
                  value={b.max_weight_kg}
                  onChange={(e) => change(b.id, { max_weight_kg: Number(e.target.value) })}
                  className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  step="1"
                  value={b.priority}
                  onChange={(e) => change(b.id, { priority: Number(e.target.value) })}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
                />
              </td>
              <td className="px-2 py-1.5 text-right">
                <button
                  onClick={() => save(b)}
                  disabled={busy}
                  className="mr-2 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => remove(b.id)}
                  disabled={busy}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}

          <tr className={cn('border-t-2 border-t-border bg-accent/10')}>
            <td className="px-4 py-2">
              <input
                type="text"
                placeholder="New band name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </td>
            <td className="px-2 py-2">
              <select
                value={draft.sex ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    sex: e.target.value === '' ? null : (e.target.value as 'M' | 'F'),
                  }))
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="">M+F</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </td>
            <td className="px-2 py-2">
              <input
                type="number"
                value={draft.min_weight_kg || ''}
                onChange={(e) => setDraft((d) => ({ ...d, min_weight_kg: Number(e.target.value) }))}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
              />
            </td>
            <td className="px-2 py-2">
              <input
                type="number"
                value={draft.max_weight_kg || ''}
                onChange={(e) => setDraft((d) => ({ ...d, max_weight_kg: Number(e.target.value) }))}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
              />
            </td>
            <td className="px-2 py-2">
              <input
                type="number"
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: Number(e.target.value) }))}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm"
              />
            </td>
            <td className="px-2 py-2 text-right">
              <button
                onClick={add}
                disabled={busy}
                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Add band
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
