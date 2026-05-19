import { useEffect, useMemo, useState } from 'react';
import { fetchAdgMatrix, updateAdgMatrix, type AdgMatrixCell } from '../lib/api';
import { cn } from '../lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function titleCase(snake: string): string {
  return snake
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

export function AdgMatrix() {
  const [cells, setCells] = useState<AdgMatrixCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAdgMatrix()
      .then((d) => setCells(d.rows))
      .catch((e: Error) => setError(e.message));
  }, []);

  // Group by class
  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const c of cells) {
      if (!map.has(c.livestock_class)) map.set(c.livestock_class, new Map());
      map.get(c.livestock_class)!.set(c.month, c.adg);
    }
    return map;
  }, [cells]);

  const classes = useMemo(() => [...grouped.keys()].sort(), [grouped]);

  const key = (cls: string, month: number) => `${cls}|${month}`;

  const change = (cls: string, month: number, value: number) => {
    setCells((prev) => {
      const next = prev.slice();
      const idx = next.findIndex((c) => c.livestock_class === cls && c.month === month);
      if (idx >= 0) next[idx] = { ...next[idx]!, adg: value };
      else next.push({ livestock_class: cls, month, adg: value });
      return next;
    });
    setDirty((d) => new Set(d).add(key(cls, month)));
  };

  const save = async (cls: string, month: number) => {
    const k = key(cls, month);
    setSavingKey(k);
    try {
      const value = grouped.get(cls)?.get(month) ?? 0;
      await updateAdgMatrix({ livestock_class: cls, month, adg: value });
      setDirty((d) => {
        const next = new Set(d);
        next.delete(k);
        return next;
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  if (error && cells.length === 0) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">ADG Matrix</h2>
        <p className="text-xs text-muted-foreground">
          Average Daily Gain (kg/day) per livestock class × calendar month. Applied to weight
          projections when an animal has no per-row ADG override. Edit a cell, then click Save.
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-3 py-2">Class</th>
              {MONTHS.map((m, i) => (
                <th key={i} className="px-2 py-2 text-center">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => (
              <tr key={cls} className="border-b border-border/40">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium">
                  {titleCase(cls)}
                </td>
                {MONTHS.map((_, idx) => {
                  const month = idx + 1;
                  const value = grouped.get(cls)?.get(month) ?? 0;
                  const k = key(cls, month);
                  const isDirty = dirty.has(k);
                  const isSaving = savingKey === k;
                  return (
                    <td key={month} className="px-1 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="5"
                          value={value}
                          onChange={(e) => change(cls, month, Number(e.target.value))}
                          className={cn(
                            'w-14 rounded border bg-background px-1 py-0.5 text-right font-mono text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
                            isDirty ? 'border-amber-500/60' : 'border-border',
                          )}
                        />
                        {isDirty && (
                          <button
                            onClick={() => save(cls, month)}
                            disabled={isSaving}
                            className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
                            title="Save"
                          >
                            ✓
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Cells with unsaved changes are outlined amber — click ✓ to commit. The Forecasted Weights
        view picks up changes on next page refresh.
      </p>
    </div>
  );
}
