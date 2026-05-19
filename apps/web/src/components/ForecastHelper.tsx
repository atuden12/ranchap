import { useEffect, useState } from 'react';
import {
  fetchForecastHelper,
  type ForecastHelperResult,
  type MonthKey,
} from '../lib/api';
import { cn } from '../lib/utils';

interface ForecastHelperProps {
  months: MonthKey[];
  defaultTarget: MonthKey | null;
  /** Bumped by the parent whenever the grid is refetched, so helper stays in sync. */
  refreshKey: number;
}

function actionColor(action: 'destock' | 'acquire' | 'on_track' | undefined): string {
  if (action === 'destock') return 'border-destructive/50 bg-destructive/10';
  if (action === 'acquire') return 'border-emerald-500/40 bg-emerald-500/10';
  if (action === 'on_track') return 'border-amber-500/40 bg-amber-500/10';
  return 'border-border bg-card';
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

export function ForecastHelper({ months, defaultTarget, refreshKey }: ForecastHelperProps) {
  const [target, setTarget] = useState<MonthKey | null>(defaultTarget);
  const [result, setResult] = useState<ForecastHelperResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to 3 months ahead of "current" if defaultTarget isn't useful.
  useEffect(() => {
    if (!target && defaultTarget) setTarget(defaultTarget);
  }, [defaultTarget, target]);

  useEffect(() => {
    if (!target) {
      setResult(null);
      return;
    }
    setError(null);
    fetchForecastHelper(target)
      .then(setResult)
      .catch((e: Error) => setError(e.message));
  }, [target, refreshKey]);

  if (months.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Forecast Helper</h2>
        <p className="text-xs text-muted-foreground">
          Pick a target month — see projected closing vs. rainfall-adjusted capacity, plus
          a headline action.
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        <label className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Target month</span>
          <select
            value={target ?? ''}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">— select —</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Projected closing" value={formatNum(result.projected_closing)} unit="head" />
            <Stat
              label="Rainfall-adj. capacity"
              value={formatNum(result.rainfall_adjusted_capacity)}
              unit="head"
            />
            <Stat
              label="Rolling 3mo rainfall"
              value={formatPct(result.rolling_pct)}
              unit="of avg"
            />
          </div>
        )}

        {result?.recommendation && (
          <div className={cn('rounded-md border px-4 py-3', actionColor(result.recommendation.action))}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {result.recommendation.action.replace('_', ' ')}
            </p>
            <p className="mt-1 text-xl font-semibold">{result.recommendation.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">{result.recommendation.detail}</p>
          </div>
        )}

        {result?.destock_suggestions && result.destock_suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Suggested destock — mobs reaching their first market band by {result.target}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2">Mob</th>
                  <th className="py-2 pr-2">Paddock</th>
                  <th className="py-2 pr-2">Band</th>
                  <th className="py-2 pr-2 text-right">Head</th>
                  <th className="py-2 pr-2 text-right">Cumulative</th>
                  <th className="py-2 pr-2">Median exit</th>
                </tr>
              </thead>
              <tbody>
                {result.destock_suggestions.map((s, i) => (
                  <tr key={i} className="border-b border-border/40 align-top">
                    <td className="py-1.5 pr-2">{s.mob_name ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{s.paddock_name ?? '—'}</td>
                    <td className="py-1.5 pr-2">{s.band}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                      {s.head_count}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums font-semibold">
                      {s.cumulative_head}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                      {s.median_exit_date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">
              Mobs ranked by median predicted exit date. Cumulative column shows running total —
              stops once it covers the destock requirement.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}
