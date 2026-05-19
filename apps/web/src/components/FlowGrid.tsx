import { useMemo, useState } from 'react';
import { type FlowGridData, type MonthKey } from '../lib/api';
import { cn } from '../lib/utils';
import { CellDrawer } from './CellDrawer';
import { Sparkline } from './Sparkline';

type RowKey = keyof FlowGridData['rows'];

interface RowDef {
  key: RowKey;
  label: string;
  /** Visual grouping — adds a top border to the first row of each band. */
  groupStart?: boolean;
  /** "header" rows are bold + a touch larger. */
  emphasis?: 'header' | 'normal' | 'muted';
  format?: 'integer' | 'percent' | 'signed_integer';
}

const ROW_DEFS: RowDef[] = [
  { key: 'opening_actual', label: 'On Farm Opening (Actual)', groupStart: true, emphasis: 'header' },
  { key: 'opening_budget', label: 'On Farm Opening (Budget)', emphasis: 'muted' },

  { key: 'inflow_actual', label: 'Inflow Actual (A)', groupStart: true, emphasis: 'header' },
  { key: 'inflow_forecast', label: 'Inflow Forecast (B)', emphasis: 'muted' },
  { key: 'inflow_predicted', label: 'Inflow Predictions (P)', emphasis: 'muted' },

  { key: 'exits_actual', label: 'Exits Actual (A)', groupStart: true, emphasis: 'header' },
  { key: 'exits_forecast', label: 'Exits Forecast', emphasis: 'muted' },
  { key: 'exits_predicted', label: 'Exits Predictions (P)', emphasis: 'muted' },

  { key: 'closing_actual', label: 'Total on Farm Closing (Actual)', groupStart: true, emphasis: 'header' },
  { key: 'closing_budget', label: 'Total on Farm Closing (Budget)', emphasis: 'muted' },

  { key: 'sundown_capacity', label: 'Sundown Normal Capacity', groupStart: true },
  { key: 'warabah_capacity', label: 'Warabah Normal Capacity' },
  { key: 'nutrition_increase', label: 'Potential Nutrition Increase' },
  { key: 'total_capacity', label: 'Total Grazing Capacity', emphasis: 'header' },
  { key: 'rainfall_adjusted_capacity', label: 'Rainfall-Adjusted Capacity (rolling 3mo)', emphasis: 'header' },
  {
    key: 'capacity_variance',
    label: 'Capacity Variance',
    emphasis: 'header',
    format: 'signed_integer',
  },

  { key: 'historical_rainfall', label: 'Historical Avg Rainfall (mm)', groupStart: true, emphasis: 'muted' },
  { key: 'actual_rainfall', label: 'Actual Rainfall (mm)', emphasis: 'muted' },
  { key: 'pct_of_avg', label: '% of Average', emphasis: 'muted', format: 'percent' },
  { key: 'rolling_3mo_pct', label: 'Rolling 3-Month %', emphasis: 'muted', format: 'percent' },
];

function formatCell(value: number | null, format: RowDef['format'] = 'integer'): string {
  if (value == null) return '';
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'signed_integer') {
    const rounded = Math.round(value);
    return rounded > 0 ? `+${rounded.toLocaleString()}` : rounded.toLocaleString();
  }
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(1);
}

function formatMonth(key: MonthKey): { mmm: string; yy: string } {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y!, m! - 1, 1);
  return {
    mmm: date.toLocaleString('en-US', { month: 'short' }),
    yy: String(y).slice(2),
  };
}

function varianceColor(value: number | null): string {
  if (value == null) return '';
  if (value < 0) return 'text-destructive font-semibold';
  if (value < 500) return 'text-amber-400 font-semibold';
  return 'text-emerald-400 font-semibold';
}

interface FlowGridProps {
  data: FlowGridData;
  onChanged: () => void;
}

export function FlowGrid({ data, onChanged }: FlowGridProps) {
  const [selectedCell, setSelectedCell] = useState<{
    rowKey: RowKey;
    rowLabel: string;
    month: MonthKey;
  } | null>(null);

  const yearGroups = useMemo(() => {
    const groups: Array<{ year: string; months: MonthKey[] }> = [];
    for (const m of data.months) {
      const [y] = m.split('-');
      const g = groups[groups.length - 1];
      if (g && g.year === y) g.months.push(m);
      else groups.push({ year: y!, months: [m] });
    }
    return groups;
  }, [data]);

  const sparkMonths = useMemo(() => data.months.slice(-12), [data.months]);

  if (data.months.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        No flow data yet. Run <code>npm run import -- --file &lt;xlsx&gt;</code> first.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Flow</h2>
          <p className="text-xs text-muted-foreground">
            Monthly head movement, capacity vs. rainfall-adjusted demand.
            {data.current_month && (
              <>
                {' '}
                Current month:{' '}
                <span className="font-mono text-primary">{data.current_month}</span>
              </>
            )}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {data.months.length} months · {data.months[0]} → {data.months[data.months.length - 1]}
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 w-72 border-b border-border bg-card px-3 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ left: 0 }}
              >
                Year
              </th>
              <th
                className="sticky top-0 z-30 w-28 border-b border-l border-border bg-card px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ left: '18rem' }}
              />
              {yearGroups.map((g) => (
                <th
                  key={g.year}
                  colSpan={g.months.length}
                  className="border-b border-l border-border bg-card px-2 py-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {g.year}
                </th>
              ))}
            </tr>
            <tr>
              <th
                className="sticky left-0 top-7 z-30 w-72 border-b border-border bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
                style={{ left: 0 }}
              >
                Row
              </th>
              <th
                className="sticky top-7 z-30 w-28 border-b border-l border-border bg-card px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ left: '18rem' }}
              >
                Trend (12mo)
              </th>
              {data.months.map((m) => {
                const fm = formatMonth(m);
                const isCurrent = m === data.current_month;
                return (
                  <th
                    key={m}
                    className={cn(
                      'border-b border-border bg-card px-2 py-1 text-center text-[10px] font-medium tabular-nums',
                      isCurrent && 'bg-primary/10 text-primary',
                    )}
                  >
                    <div>{fm.mmm}</div>
                    <div className="text-muted-foreground">{fm.yy}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {ROW_DEFS.map((row) => {
              const values = data.rows[row.key] ?? {};
              const sparkValues = sparkMonths.map((m) => values[m] ?? null);
              return (
                <tr
                  key={row.key}
                  className={cn(row.groupStart && 'border-t-2 border-t-border')}
                >
                  <td
                    className={cn(
                      'sticky z-20 w-72 border-b border-border bg-card px-3 py-1.5',
                      row.emphasis === 'header' && 'font-semibold',
                      row.emphasis === 'muted' && 'text-muted-foreground',
                      row.groupStart && 'border-t-2 border-t-border',
                    )}
                    style={{ left: 0 }}
                  >
                    {row.label}
                  </td>
                  <td
                    className={cn(
                      'sticky z-20 w-28 border-b border-l border-border bg-card px-2 py-1',
                      row.groupStart && 'border-t-2 border-t-border',
                    )}
                    style={{ left: '18rem' }}
                  >
                    <Sparkline values={sparkValues} />
                  </td>
                  {data.months.map((m) => {
                    const v = values[m] ?? null;
                    const isCurrent = m === data.current_month;
                    const variance = row.key === 'capacity_variance';
                    const isSelected =
                      selectedCell?.rowKey === row.key && selectedCell?.month === m;
                    return (
                      <td
                        key={m}
                        onClick={() =>
                          setSelectedCell({ rowKey: row.key, rowLabel: row.label, month: m })
                        }
                        className={cn(
                          'cursor-pointer border-b border-border px-2 py-1.5 text-right tabular-nums hover:bg-accent/30',
                          isCurrent && 'bg-primary/5',
                          isSelected && 'bg-primary/20 ring-1 ring-primary',
                          variance && varianceColor(v),
                          row.emphasis === 'header' && 'font-semibold',
                          row.emphasis === 'muted' && 'text-muted-foreground',
                        )}
                      >
                        {formatCell(v, row.format)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Capacity Variance colors: <span className="text-emerald-400">green</span> &gt; +500 head ·
        <span className="text-amber-400"> amber</span> 0 to +500 ·
        <span className="text-destructive"> red</span> &lt; 0 (overstocked). Click any cell to
        drill in or edit.
      </div>
      <CellDrawer
        rowKey={selectedCell?.rowKey ?? null}
        rowLabel={selectedCell?.rowLabel ?? ''}
        month={selectedCell?.month ?? null}
        onChanged={onChanged}
        onClose={() => setSelectedCell(null)}
      />
    </div>
  );
}
