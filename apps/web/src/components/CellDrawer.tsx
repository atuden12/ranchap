import { useEffect, useState } from 'react';
import {
  fetchCellDetail,
  patchCapacity,
  patchRainfall,
  createPrediction,
  deletePrediction,
  type CellDetail,
  type MonthKey,
} from '../lib/api';
import { cn } from '../lib/utils';

interface CellDrawerProps {
  rowKey: string | null;
  rowLabel: string;
  month: MonthKey | null;
  /** Called after a successful mutation so the parent can refetch the grid. */
  onChanged: () => void;
  onClose: () => void;
}

export function CellDrawer({ rowKey, rowLabel, month, onChanged, onClose }: CellDrawerProps) {
  const [detail, setDetail] = useState<CellDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const open = rowKey != null && month != null;

  useEffect(() => {
    if (!open) {
      setDetail(null);
      setError(null);
      return;
    }
    setDetail(null);
    setError(null);
    fetchCellDetail(rowKey!, month!)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [open, rowKey, month, reloadCount]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const reload = () => {
    setReloadCount((c) => c + 1);
    onChanged();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{month ?? ''}</p>
            <h2 className="text-lg font-semibold tracking-tight">{rowLabel}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
              Error: {error}
            </div>
          )}
          {!detail && !error && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
          {detail && (
            <DetailBody
              detail={detail}
              rowKey={rowKey!}
              month={month!}
              onChanged={reload}
              onError={(e) => setError(e)}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function DetailBody({
  detail,
  rowKey,
  month,
  onChanged,
  onError,
}: {
  detail: CellDetail;
  rowKey: string;
  month: MonthKey;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  if (detail.kind === 'transactions') {
    return (
      <TransactionsView
        detail={detail}
        rowKey={rowKey}
        month={month}
        onChanged={onChanged}
        onError={onError}
      />
    );
  }
  if (detail.kind === 'capacity') {
    return (
      <CapacityEditor
        detail={detail}
        month={month}
        rowKey={rowKey}
        onChanged={onChanged}
        onError={onError}
      />
    );
  }
  if (detail.kind === 'rainfall') {
    return (
      <RainfallEditor
        detail={detail}
        month={month}
        rowKey={rowKey}
        onChanged={onChanged}
        onError={onError}
      />
    );
  }
  if (detail.kind === 'opening') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{detail.source}</p>
        {detail.opening ? (
          <p>
            Explicit checkpoint:{' '}
            <span className="font-mono font-semibold text-primary">
              {detail.opening.head_count.toLocaleString()}
            </span>{' '}
            head
          </p>
        ) : (
          <p className="text-muted-foreground">
            No explicit opening checkpoint — value is rolled forward from the prior month's closing.
          </p>
        )}
      </div>
    );
  }
  // derived
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Formula</p>
      <p className="rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs">
        {detail.description}
      </p>
      <p className="text-xs text-muted-foreground">
        Click the input rows above this one to see their underlying transactions or values.
      </p>
    </div>
  );
}

function parseMonth(m: MonthKey): { year: number; month: number } {
  const [y, mm] = m.split('-').map(Number);
  return { year: y!, month: mm! };
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  unit?: string;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value ?? ''}
          onChange={(e) => {
            const s = e.target.value;
            onChange(s === '' ? null : Number(s));
          }}
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    </label>
  );
}

function CapacityEditor({
  detail,
  month,
  rowKey,
  onChanged,
  onError,
}: {
  detail: Extract<CellDetail, { kind: 'capacity' }>;
  month: MonthKey;
  rowKey: string;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [base, setBase] = useState<number | null>(detail.capacity?.base_capacity ?? null);
  const [nutrition, setNutrition] = useState<number | null>(
    detail.capacity?.nutrition_increase ?? null,
  );
  const [saving, setSaving] = useState(false);
  const property = detail.property as 'Sundown' | 'Warabah';
  const isNutritionRow = rowKey === 'nutrition_increase';

  const save = async () => {
    setSaving(true);
    try {
      const { year, month: mm } = parseMonth(month);
      await patchCapacity({
        property,
        year,
        month: mm,
        base_capacity: base ?? 0,
        nutrition_increase: nutrition ?? 0,
      });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{property}</p>
      {!isNutritionRow && (
        <NumberField label="Base capacity" value={base} onChange={setBase} unit="head" step={100} />
      )}
      <NumberField
        label="Nutrition increase"
        value={nutrition}
        onChange={setNutrition}
        unit="head"
        step={100}
      />
      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function RainfallEditor({
  detail,
  month,
  rowKey,
  onChanged,
  onError,
}: {
  detail: Extract<CellDetail, { kind: 'rainfall' }>;
  month: MonthKey;
  rowKey: string;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [actual, setActual] = useState<number | null>(detail.rainfall?.mm_actual ?? null);
  const [historical, setHistorical] = useState<number | null>(
    detail.rainfall?.mm_historical_avg ?? null,
  );
  const [saving, setSaving] = useState(false);
  const isHistRow = rowKey === 'historical_rainfall';

  const save = async () => {
    setSaving(true);
    try {
      const { year, month: mm } = parseMonth(month);
      await patchRainfall({
        year,
        month: mm,
        mm_actual: actual,
        mm_historical_avg: historical,
      });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Shared baseline — rainfall applies to both Sundown and Warabah per the project spec.
      </p>
      <NumberField label="Actual rainfall" value={actual} onChange={setActual} unit="mm" step={0.1} />
      <NumberField
        label="Historical average"
        value={historical}
        onChange={setHistorical}
        unit="mm"
        step={0.1}
      />
      {!isHistRow && (
        <p className="text-[11px] text-muted-foreground">
          The current month's % of average is auto-scaled by how much of the month has elapsed.
        </p>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function TransactionsView({
  detail,
  rowKey,
  month,
  onChanged,
  onError,
}: {
  detail: Extract<CellDetail, { kind: 'transactions' }>;
  rowKey: string;
  month: MonthKey;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const isPredicted = rowKey === 'inflow_predicted' || rowKey === 'exits_predicted';
  const txType = rowKey.startsWith('inflow') ? 'IN' : 'OUT';

  return (
    <div className="space-y-4">
      {isPredicted && (
        <AddPrediction
          month={month}
          type={txType}
          onCreated={onChanged}
          onError={onError}
        />
      )}

      {detail.transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions recorded for this month.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {detail.transactions.length} transaction
              {detail.transactions.length === 1 ? '' : 's'}
            </p>
            <p className="text-sm">
              Total head:{' '}
              <span className="font-mono font-semibold text-primary">
                {detail.total.toLocaleString()}
              </span>
            </p>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Class</th>
                <th className="py-2 pr-2">Herd</th>
                <th className="py-2 pr-2 text-right">Head</th>
                <th className="py-2 pr-2">Counterparty</th>
                <th className="py-2 pr-2">Description</th>
                {isPredicted && <th className="py-2 pr-2" aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {detail.transactions.map((t) => (
                <tr key={t.id} className="border-b border-border/40 align-top">
                  <td className="py-1.5 pr-2 font-mono text-muted-foreground">{t.date}</td>
                  <td className="py-1.5 pr-2">{t.livestock_class ?? '—'}</td>
                  <td className="py-1.5 pr-2">{t.herd ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {Math.abs(t.head_count).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-2">{t.origin_destination ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{t.description ?? '—'}</td>
                  {isPredicted && (
                    <td className="py-1.5 pr-2 text-right">
                      <button
                        onClick={async () => {
                          try {
                            await deletePrediction(t.id);
                            onChanged();
                          } catch (e) {
                            onError((e as Error).message);
                          }
                        }}
                        className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddPrediction({
  month,
  type,
  onCreated,
  onError,
}: {
  month: MonthKey;
  type: 'IN' | 'OUT';
  onCreated: () => void;
  onError: (e: string) => void;
}) {
  const [day, setDay] = useState(15);
  const [head, setHead] = useState(0);
  const [livestockClass, setLivestockClass] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (head <= 0) {
      onError('head_count must be > 0');
      return;
    }
    setSaving(true);
    try {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      await createPrediction({
        date,
        type,
        head_count: head,
        livestock_class: livestockClass || undefined,
        origin_destination: counterparty || undefined,
        description: description || undefined,
      });
      setHead(0);
      setLivestockClass('');
      setCounterparty('');
      setDescription('');
      onCreated();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Add prediction ({type === 'IN' ? 'inflow' : 'exit'})
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Day of month</span>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Head count</span>
          <input
            type="number"
            min={1}
            value={head || ''}
            onChange={(e) => setHead(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Livestock class (snake_case)</span>
          <input
            type="text"
            value={livestockClass}
            onChange={(e) => setLivestockClass(e.target.value)}
            placeholder="feeder_steer"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {type === 'IN' ? 'Origin / counterparty' : 'Destination / counterparty'}
          </span>
          <input
            type="text"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
      </div>
      <button
        onClick={submit}
        disabled={saving || head <= 0}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Add prediction'}
      </button>
    </div>
  );
}
