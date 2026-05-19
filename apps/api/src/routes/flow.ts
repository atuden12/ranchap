import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  rainfallAdjustedCapacity,
  rollingPctOfAvg,
  currentMonthAdjustedPct,
  DEFAULT_ADG_KG_PER_DAY,
  projectAnimalWeight,
  classifyByWeight,
  type MarketBand,
  type Sex,
} from '@ranchapp/shared';

export const flowRouter = Router();

/** Month key in "YYYY-MM" format. */
type MonthKey = string;

function mk(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parseMonthKey(k: MonthKey): { year: number; month: number } {
  const [y, m] = k.split('-').map(Number);
  return { year: y!, month: m! };
}

function rangeMonths(min: MonthKey, max: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  const start = parseMonthKey(min);
  const end = parseMonthKey(max);
  let y = start.year;
  let m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    out.push(mk(y, m));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * GET /api/flow/grid
 * Full monthly grid for the Flow view.
 *
 * Output shape:
 *   {
 *     months: ["2023-01", ..., "2026-06"],
 *     current_month: "2026-05",
 *     rows: {
 *       opening_actual: { "2023-01": 14615, ... },
 *       inflow_actual: { ... },
 *       ...
 *       rainfall_adjusted_capacity: { ... },
 *       capacity_variance: { ... },
 *     }
 *   }
 *
 * Values are integers (or null when missing). Closing balances roll forward
 * from the prior month unless an explicit opening_balance row overrides.
 */
flowRouter.get('/grid', (_req, res) => {
  const db = getDb();

  // Month range: union across all source tables, hard-bounded to a plausible
  // cattle-ops window. The bound stops a single malformed row (Excel quirks,
  // stray numbers parsed as dates) from blowing the grid out to 7000+ years.
  const MIN_YEAR = 2020;
  const MAX_YEAR = 2035;
  const range = db
    .prepare(
      `
      WITH all_months AS (
        SELECT substr(date, 1, 7) AS m FROM transaction_event
          WHERE CAST(substr(date, 1, 4) AS INTEGER) BETWEEN ? AND ?
        UNION SELECT printf('%04d-%02d', year, month) FROM capacity_override
          WHERE year BETWEEN ? AND ?
        UNION SELECT printf('%04d-%02d', year, month) FROM monthly_rainfall
          WHERE year BETWEEN ? AND ?
        UNION SELECT printf('%04d-%02d', year, month) FROM opening_balance
          WHERE year BETWEEN ? AND ?
      )
      SELECT MIN(m) AS min_m, MAX(m) AS max_m FROM all_months WHERE m IS NOT NULL
    `,
    )
    .get(MIN_YEAR, MAX_YEAR, MIN_YEAR, MAX_YEAR, MIN_YEAR, MAX_YEAR, MIN_YEAR, MAX_YEAR) as {
    min_m: string | null;
    max_m: string | null;
  };

  if (!range.min_m || !range.max_m) {
    res.json({ months: [], current_month: null, rows: {} });
    return;
  }

  const months = rangeMonths(range.min_m, range.max_m);

  // --- Pull data -----------------------------------------------------------

  type TxAgg = { month: string; type: 'IN' | 'OUT'; source: string; total: number };
  const txRows = db
    .prepare(
      `
      SELECT
        substr(date, 1, 7) AS month,
        type,
        source,
        SUM(ABS(head_count)) AS total
      FROM transaction_event
      GROUP BY month, type, source
    `,
    )
    .all() as TxAgg[];

  type CapRow = {
    property: string;
    year: number;
    month: number;
    base_capacity: number;
    nutrition_increase: number;
  };
  const capRows = db
    .prepare(
      `
      SELECT p.name AS property, co.year, co.month, co.base_capacity, co.nutrition_increase
      FROM capacity_override co
      JOIN property p ON p.id = co.property_id
    `,
    )
    .all() as CapRow[];

  type RainRow = {
    year: number;
    month: number;
    mm_actual: number | null;
    mm_historical_avg: number | null;
  };
  const rainRows = db
    .prepare(
      `
      SELECT mr.year, mr.month, mr.mm_actual, mr.mm_historical_avg
      FROM monthly_rainfall mr
      JOIN property p ON p.id = mr.property_id
      WHERE p.name = 'Sundown'
    `,
    )
    .all() as RainRow[];

  type OpeningRow = { year: number; month: number; source: string; head_count: number };
  const openingRows = db
    .prepare('SELECT year, month, source, head_count FROM opening_balance')
    .all() as OpeningRow[];

  // --- Index for O(1) lookups ---------------------------------------------

  const initRow = (): Record<MonthKey, number | null> =>
    Object.fromEntries(months.map((m) => [m, null]));

  const inflow_actual = initRow();
  const inflow_forecast = initRow();
  const inflow_predicted = initRow();
  const exits_actual = initRow();
  const exits_forecast = initRow();
  const exits_predicted = initRow();

  for (const r of txRows) {
    const bucket =
      r.type === 'IN' && r.source === 'Actual'
        ? inflow_actual
        : r.type === 'IN' && r.source === 'Forecast'
          ? inflow_forecast
          : r.type === 'IN' && r.source === 'Predicted'
            ? inflow_predicted
            : r.type === 'OUT' && r.source === 'Actual'
              ? exits_actual
              : r.type === 'OUT' && r.source === 'Forecast'
                ? exits_forecast
                : r.type === 'OUT' && r.source === 'Predicted'
                  ? exits_predicted
                  : null;
    if (bucket && r.month in bucket) bucket[r.month] = r.total;
  }

  const sundown_capacity = initRow();
  const warabah_capacity = initRow();
  const nutrition_increase = initRow();
  for (const c of capRows) {
    const key = mk(c.year, c.month);
    if (!(key in sundown_capacity)) continue;
    if (c.property === 'Sundown') {
      sundown_capacity[key] = c.base_capacity;
      // Nutrition is stored on Sundown only.
      nutrition_increase[key] = c.nutrition_increase ?? 0;
    } else if (c.property === 'Warabah') {
      warabah_capacity[key] = c.base_capacity;
    }
  }

  const historical_rainfall = initRow();
  const actual_rainfall = initRow();
  for (const r of rainRows) {
    const key = mk(r.year, r.month);
    if (!(key in historical_rainfall)) continue;
    historical_rainfall[key] = r.mm_historical_avg;
    actual_rainfall[key] = r.mm_actual;
  }

  const opening_actual_seed = initRow();
  const opening_budget_seed = initRow();
  for (const o of openingRows) {
    const key = mk(o.year, o.month);
    if (!(key in opening_actual_seed)) continue;
    if (o.source === 'Actual') opening_actual_seed[key] = o.head_count;
    else if (o.source === 'Budget') opening_budget_seed[key] = o.head_count;
  }

  // --- Derived rows --------------------------------------------------------

  const opening_actual = initRow();
  const opening_budget = initRow();
  const closing_actual = initRow();
  const closing_budget = initRow();

  let rollingActual: number | null = null;
  let rollingBudget: number | null = null;

  for (const m of months) {
    // Opening: explicit seed > roll-forward from prior closing.
    const seedA = opening_actual_seed[m];
    if (seedA != null) {
      opening_actual[m] = seedA;
      rollingActual = seedA;
    } else if (rollingActual != null) {
      opening_actual[m] = rollingActual;
    }

    const seedB = opening_budget_seed[m];
    if (seedB != null) {
      opening_budget[m] = seedB;
      rollingBudget = seedB;
    } else if (rollingBudget != null) {
      opening_budget[m] = rollingBudget;
    } else if (rollingActual != null) {
      // Budget series hasn't started yet; mirror the actual series.
      opening_budget[m] = rollingActual;
    }

    // Closing = opening + inflows - exits.
    const ia = inflow_actual[m] ?? 0;
    const ea = exits_actual[m] ?? 0;
    if (opening_actual[m] != null) {
      closing_actual[m] = opening_actual[m]! + ia - ea;
      rollingActual = closing_actual[m]!;
    }

    const if_ = inflow_forecast[m] ?? 0;
    const ip = inflow_predicted[m] ?? 0;
    const ef = exits_forecast[m] ?? 0;
    const ep = exits_predicted[m] ?? 0;
    if (opening_budget[m] != null) {
      closing_budget[m] = opening_budget[m]! + if_ + ip - ef - ep;
      rollingBudget = closing_budget[m]!;
    }
  }

  // Total capacity (no rainfall adjustment yet)
  const total_capacity = initRow();
  for (const m of months) {
    const s = sundown_capacity[m] ?? 0;
    const w = warabah_capacity[m] ?? 0;
    const n = nutrition_increase[m] ?? 0;
    if (s > 0 || w > 0) total_capacity[m] = s + w + n;
  }

  // Rainfall pct-of-average per month. In-progress month uses the
  // currentMonthAdjustedPct helper from @ranchapp/shared.
  const today = new Date();
  const currentMonth = mk(today.getFullYear(), today.getMonth() + 1);

  const pct_of_avg: Record<MonthKey, number | null> = initRow();
  for (const m of months) {
    const hist = historical_rainfall[m];
    const act = actual_rainfall[m];
    if (hist == null || hist <= 0) {
      pct_of_avg[m] = null;
      continue;
    }
    if (m === currentMonth) {
      pct_of_avg[m] = currentMonthAdjustedPct({
        actualMmToDate: act ?? 0,
        historicalAvgMm: hist,
        asOf: today,
      });
    } else if (act != null) {
      pct_of_avg[m] = act / hist;
    } else {
      pct_of_avg[m] = null;
    }
  }

  // Rolling 3-month pct using the shared helper (returns null when fewer
  // than 3 non-null values are available).
  const rolling_3mo_pct: Record<MonthKey, number | null> = initRow();
  for (let i = 0; i < months.length; i++) {
    const window = months.slice(Math.max(0, i - 2), i + 1).map((m) => pct_of_avg[m] ?? null);
    rolling_3mo_pct[months[i]!] = rollingPctOfAvg(window);
  }

  // Rainfall-adjusted capacity per month.
  const rainfall_adjusted_capacity: Record<MonthKey, number | null> = initRow();
  for (const m of months) {
    const s = sundown_capacity[m];
    const w = warabah_capacity[m];
    const r = rolling_3mo_pct[m];
    if (s == null || w == null || r == null) continue;
    rainfall_adjusted_capacity[m] = rainfallAdjustedCapacity({
      sundownCapacity: s,
      warabahCapacity: w,
      nutritionIncrease: nutrition_increase[m] ?? 0,
      rollingPctOfAvg: r,
    });
  }

  // Capacity variance: rainfall-adjusted - closing (Actual when present, else Budget).
  const capacity_variance: Record<MonthKey, number | null> = initRow();
  for (const m of months) {
    const cap = rainfall_adjusted_capacity[m];
    const closing = closing_actual[m] ?? closing_budget[m];
    if (cap == null || closing == null) continue;
    capacity_variance[m] = cap - closing;
  }

  res.json({
    months,
    current_month: months.includes(currentMonth) ? currentMonth : null,
    rows: {
      opening_actual,
      opening_budget,
      inflow_actual,
      inflow_forecast,
      inflow_predicted,
      exits_actual,
      exits_forecast,
      exits_predicted,
      closing_actual,
      closing_budget,
      sundown_capacity,
      warabah_capacity,
      nutrition_increase,
      total_capacity,
      rainfall_adjusted_capacity,
      capacity_variance,
      historical_rainfall,
      actual_rainfall,
      pct_of_avg,
      rolling_3mo_pct,
    },
  });
});

/**
 * GET /api/flow/helper?target=<YYYY-MM>
 * For a target month, return the projected closing, rainfall-adjusted capacity,
 * variance, and a destock/acquire recommendation. Reuses the same grid pipeline
 * via fetching internally.
 */
flowRouter.get('/helper', (req, res) => {
  const target = String(req.query.target ?? '');
  if (!/^\d{4}-\d{2}$/.test(target)) {
    res.status(400).json({ error: 'invalid target — expected YYYY-MM' });
    return;
  }
  // Cheapest path: re-run the same SQL the grid uses, then pull the target month.
  // We replicate just the closing + rainfall-adjusted capacity here rather than
  // factoring out the whole grid pipeline.
  const db = getDb();

  type Row = { m: string; v: number | null };
  const txAgg = db
    .prepare(
      `
      SELECT substr(date, 1, 7) AS m, type, source, SUM(ABS(head_count)) AS v
      FROM transaction_event
      WHERE CAST(substr(date, 1, 4) AS INTEGER) BETWEEN 2020 AND 2035
      GROUP BY m, type, source
    `,
    )
    .all() as Array<{ m: string; type: 'IN' | 'OUT'; source: string; v: number }>;

  const capRows = db
    .prepare(
      `
      SELECT printf('%04d-%02d', co.year, co.month) AS m, p.name AS property,
             co.base_capacity AS cap, co.nutrition_increase AS nut
      FROM capacity_override co JOIN property p ON p.id = co.property_id
    `,
    )
    .all() as Array<{ m: string; property: string; cap: number; nut: number }>;

  const rainRows = db
    .prepare(
      `
      SELECT printf('%04d-%02d', mr.year, mr.month) AS m,
             mr.mm_actual AS act, mr.mm_historical_avg AS hist
      FROM monthly_rainfall mr JOIN property p ON p.id = mr.property_id
      WHERE p.name = 'Sundown'
    `,
    )
    .all() as Array<{ m: string; act: number | null; hist: number | null }>;

  const openingRows = db
    .prepare(
      `SELECT printf('%04d-%02d', year, month) AS m, source, head_count AS hc FROM opening_balance`,
    )
    .all() as Array<{ m: string; source: string; hc: number }>;

  // Build month list from min(any source) to target.
  const minMonth =
    txAgg.concat(capRows.map((r) => ({ m: r.m, type: 'IN' as const, source: '', v: 0 })))
      .map((r) => r.m)
      .filter((m) => m >= '2020-01' && m <= '2035-12')
      .sort()[0] ?? target;

  if (target < minMonth) {
    res.status(400).json({ error: 'target predates available data' });
    return;
  }

  const months: string[] = [];
  {
    const [y0, m0] = minMonth.split('-').map(Number);
    const [y1, m1] = target.split('-').map(Number);
    let y = y0!;
    let m = m0!;
    while (y < y1! || (y === y1! && m <= m1!)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }

  // Walk forward, computing closing + capacity for each month.
  let rolling: number | null = null;
  const pctSeries: Array<number | null> = [];
  let result: {
    projected_closing: number | null;
    rainfall_adjusted_capacity: number | null;
    capacity_variance: number | null;
    total_capacity: number | null;
    sundown_cap: number | null;
    warabah_cap: number | null;
    nutrition: number;
    rolling_pct: number | null;
  } | null = null;

  for (const m of months) {
    const opActual = openingRows.find((r) => r.m === m && r.source === 'Actual')?.hc;
    const opBudget = openingRows.find((r) => r.m === m && r.source === 'Budget')?.hc;
    if (opActual != null) rolling = opActual;
    else if (opBudget != null) rolling = opBudget;

    const inflows =
      (txAgg.find((r) => r.m === m && r.type === 'IN' && r.source === 'Actual')?.v ?? 0) +
      (txAgg.find((r) => r.m === m && r.type === 'IN' && r.source === 'Forecast')?.v ?? 0) +
      (txAgg.find((r) => r.m === m && r.type === 'IN' && r.source === 'Predicted')?.v ?? 0);
    const exits =
      (txAgg.find((r) => r.m === m && r.type === 'OUT' && r.source === 'Actual')?.v ?? 0) +
      (txAgg.find((r) => r.m === m && r.type === 'OUT' && r.source === 'Forecast')?.v ?? 0) +
      (txAgg.find((r) => r.m === m && r.type === 'OUT' && r.source === 'Predicted')?.v ?? 0);

    if (rolling != null) rolling = rolling + inflows - exits;

    const rain = rainRows.find((r) => r.m === m);
    const pct =
      rain && rain.hist != null && rain.hist > 0 && rain.act != null
        ? rain.act / rain.hist
        : null;
    pctSeries.push(pct);
    const last3 = pctSeries.slice(-3);
    const rolling_pct =
      last3.length === 3 && last3.every((v) => v != null && Number.isFinite(v))
        ? (last3 as number[]).reduce((a, b) => a + b, 0) / 3
        : null;

    if (m === target) {
      const sundown = capRows.find((r) => r.m === m && r.property === 'Sundown');
      const warabah = capRows.find((r) => r.m === m && r.property === 'Warabah');
      const sundown_cap = sundown?.cap ?? null;
      const warabah_cap = warabah?.cap ?? null;
      const nutrition = sundown?.nut ?? 0;
      const total_capacity =
        sundown_cap != null && warabah_cap != null ? sundown_cap + warabah_cap + nutrition : null;
      const rainfall_adjusted_capacity =
        sundown_cap != null && warabah_cap != null && rolling_pct != null
          ? rolling_pct > 1.3
            ? 16000
            : Math.round((sundown_cap + warabah_cap + nutrition) * rolling_pct)
          : null;
      const variance =
        rainfall_adjusted_capacity != null && rolling != null
          ? rainfall_adjusted_capacity - rolling
          : null;
      result = {
        projected_closing: rolling,
        rainfall_adjusted_capacity,
        capacity_variance: variance,
        total_capacity,
        sundown_cap,
        warabah_cap,
        nutrition,
        rolling_pct,
      };
    }
  }

  if (!result) {
    res.json({ target, recommendation: null });
    return;
  }

  let recommendation: {
    action: 'destock' | 'acquire' | 'on_track';
    head_count: number;
    headline: string;
    detail: string;
  } | null = null;

  if (result.capacity_variance != null) {
    const v = result.capacity_variance;
    if (v < 0) {
      recommendation = {
        action: 'destock',
        head_count: Math.abs(v),
        headline: `Destock ${Math.abs(v).toLocaleString()} head by ${target}`,
        detail: `Projected closing (${result.projected_closing?.toLocaleString()}) exceeds rainfall-adjusted capacity (${result.rainfall_adjusted_capacity?.toLocaleString()}) by ${Math.abs(v).toLocaleString()} head.`,
      };
    } else if (v < 500) {
      recommendation = {
        action: 'on_track',
        head_count: v,
        headline: 'On track',
        detail: `Closing within ${v.toLocaleString()} head of capacity. Tight but workable.`,
      };
    } else {
      recommendation = {
        action: 'acquire',
        head_count: v,
        headline: `Capacity for ${v.toLocaleString()} more head`,
        detail: `Closing well below rainfall-adjusted capacity. Underutilization risk if pasture isn't dropped or stock not added.`,
      };
    }
  }

  // For destock actions: query animals + bands and compute which mobs reach
  // their first market band by the target date. Group, sort by exit date.
  let destock_suggestions: Array<{
    mob_id: number | null;
    mob_name: string | null;
    paddock_name: string | null;
    breed_type: string | null;
    market_class: string | null;
    head_count: number;
    cumulative_head: number;
    median_exit_date: string;
    band: string;
  }> | null = null;

  if (recommendation?.action === 'destock') {
    const bands = db
      .prepare('SELECT * FROM market_band ORDER BY priority, min_weight_kg')
      .all() as MarketBand[];
    const animals = db
      .prepare(
        `
        SELECT a.id, a.sex, a.current_weight AS w, a.last_weight_date AS d, a.adg,
               m.id AS mob_id, m.name AS mob_name, m.breed_type, m.market_class,
               pad.name AS paddock_name
        FROM animal a
        LEFT JOIN mob m ON m.id = a.mob_id
        LEFT JOIN paddock pad ON pad.id = m.paddock_id
        WHERE a.current_weight IS NOT NULL AND a.last_weight_date IS NOT NULL
      `,
      )
      .all() as Array<{
      id: number;
      sex: Sex | null;
      w: number;
      d: string;
      adg: number | null;
      mob_id: number | null;
      mob_name: string | null;
      breed_type: string | null;
      market_class: string | null;
      paddock_name: string | null;
    }>;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [ty, tm] = target.split('-').map(Number);
    const targetDate = new Date(ty!, tm! - 1, 1);
    targetDate.setMonth(targetDate.getMonth() + 1); // end-of-month cutoff

    interface MobAgg {
      mob_id: number | null;
      mob_name: string | null;
      paddock_name: string | null;
      breed_type: string | null;
      market_class: string | null;
      animals_reaching: Array<{ exitDate: Date; band: string }>;
    }
    const mobMap = new Map<string, MobAgg>();

    for (const a of animals) {
      const adg = a.adg ?? DEFAULT_ADG_KG_PER_DAY;
      const lastDate = new Date(a.d);
      // Walk daily up to targetDate; first band hit wins.
      const horizonDays = Math.max(
        0,
        Math.round((targetDate.getTime() - today.getTime()) / 86400000),
      );
      let hitBand: string | null = null;
      let hitDate: Date | null = null;
      for (let off = 0; off <= horizonDays; off += 7) {
        const asOf = new Date(today);
        asOf.setDate(asOf.getDate() + off);
        const w = projectAnimalWeight({
          lastWeightKg: a.w,
          lastWeightDate: lastDate,
          adgKgPerDay: adg,
          asOfDate: asOf,
        });
        const band = classifyByWeight(w, a.sex, bands);
        if (band) {
          hitBand = band.name;
          hitDate = asOf;
          break;
        }
      }
      if (!hitBand || !hitDate) continue;
      const key = String(a.mob_id ?? `nomob-${a.id}`);
      if (!mobMap.has(key)) {
        mobMap.set(key, {
          mob_id: a.mob_id,
          mob_name: a.mob_name,
          paddock_name: a.paddock_name,
          breed_type: a.breed_type,
          market_class: a.market_class,
          animals_reaching: [],
        });
      }
      mobMap.get(key)!.animals_reaching.push({ exitDate: hitDate, band: hitBand });
    }

    const ranked = [...mobMap.values()]
      .filter((m) => m.animals_reaching.length > 0)
      .map((m) => {
        const dates = m.animals_reaching.map((a) => a.exitDate.getTime()).sort((a, b) => a - b);
        const median = new Date(dates[Math.floor(dates.length / 2)]!);
        const bandCounts = new Map<string, number>();
        for (const r of m.animals_reaching) {
          bandCounts.set(r.band, (bandCounts.get(r.band) ?? 0) + 1);
        }
        const topBand = [...bandCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
        return {
          ...m,
          head_count: m.animals_reaching.length,
          median_exit_date: median.toISOString().slice(0, 10),
          band: topBand,
        };
      })
      .sort((a, b) => a.median_exit_date.localeCompare(b.median_exit_date));

    let cumulative = 0;
    destock_suggestions = [];
    for (const m of ranked) {
      cumulative += m.head_count;
      destock_suggestions.push({
        mob_id: m.mob_id,
        mob_name: m.mob_name,
        paddock_name: m.paddock_name,
        breed_type: m.breed_type,
        market_class: m.market_class,
        head_count: m.head_count,
        cumulative_head: cumulative,
        median_exit_date: m.median_exit_date,
        band: m.band,
      });
      if (cumulative >= recommendation.head_count) break;
    }
  }

  res.json({
    target,
    ...result,
    recommendation,
    destock_suggestions,
  });
});

/**
 * GET /api/flow/cell?row=<row_key>&month=<YYYY-MM>
 * Returns the underlying data for a cell in the Flow grid:
 *   - Transactions for inflow/exits rows
 *   - Capacity / rainfall row for those
 *   - Opening seed row for opening_actual/budget
 *   - A formula description for derived rows (closing, variance, etc.)
 */
flowRouter.get('/cell', (req, res) => {
  const row = String(req.query.row ?? '');
  const month = String(req.query.month ?? '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'invalid month — expected YYYY-MM' });
    return;
  }
  const [year, monthNum] = month.split('-').map(Number);
  const db = getDb();

  // Transaction-derived rows ------------------------------------------------
  const TXN_MAP: Record<string, { type: 'IN' | 'OUT'; source: string }> = {
    inflow_actual: { type: 'IN', source: 'Actual' },
    inflow_forecast: { type: 'IN', source: 'Forecast' },
    inflow_predicted: { type: 'IN', source: 'Predicted' },
    exits_actual: { type: 'OUT', source: 'Actual' },
    exits_forecast: { type: 'OUT', source: 'Forecast' },
    exits_predicted: { type: 'OUT', source: 'Predicted' },
  };

  if (row in TXN_MAP) {
    const { type, source } = TXN_MAP[row]!;
    const rows = db
      .prepare(
        `
        SELECT id, txn_number, date, type, source, owner, contract, herd,
               livestock_class, head_count, description, origin_destination,
               sale_purchase_type, notes
        FROM transaction_event
        WHERE substr(date, 1, 7) = ? AND type = ? AND source = ?
        ORDER BY date, id
      `,
      )
      .all(month, type, source) as Array<{ head_count: number }>;
    const total = rows.reduce((acc, r) => acc + Math.abs(r.head_count ?? 0), 0);
    res.json({ row, month, kind: 'transactions', total, transactions: rows });
    return;
  }

  // Capacity rows -----------------------------------------------------------
  if (row === 'sundown_capacity' || row === 'warabah_capacity' || row === 'nutrition_increase') {
    const property = row === 'warabah_capacity' ? 'Warabah' : 'Sundown';
    const cap = db
      .prepare(
        `
        SELECT co.base_capacity, co.nutrition_increase, p.name AS property_name
        FROM capacity_override co
        JOIN property p ON p.id = co.property_id
        WHERE p.name = ? AND co.year = ? AND co.month = ?
      `,
      )
      .get(property, year, monthNum);
    res.json({ row, month, kind: 'capacity', property, capacity: cap });
    return;
  }

  // Rainfall rows -----------------------------------------------------------
  if (row === 'historical_rainfall' || row === 'actual_rainfall') {
    const r = db
      .prepare(
        `
        SELECT mr.mm_actual, mr.mm_historical_avg
        FROM monthly_rainfall mr
        JOIN property p ON p.id = mr.property_id
        WHERE p.name = 'Sundown' AND mr.year = ? AND mr.month = ?
      `,
      )
      .get(year, monthNum);
    res.json({ row, month, kind: 'rainfall', rainfall: r });
    return;
  }

  // Opening balance ---------------------------------------------------------
  if (row === 'opening_actual' || row === 'opening_budget') {
    const source = row === 'opening_actual' ? 'Actual' : 'Budget';
    const opening = db
      .prepare(
        `
        SELECT head_count FROM opening_balance
        WHERE year = ? AND month = ? AND source = ?
      `,
      )
      .get(year, monthNum, source);
    res.json({ row, month, kind: 'opening', source, opening });
    return;
  }

  // Derived rows ------------------------------------------------------------
  const DERIVED_DESCRIPTIONS: Record<string, string> = {
    closing_actual:
      'opening_actual + inflow_actual − exits_actual. Rolls forward month-to-month unless an explicit opening checkpoint exists.',
    closing_budget:
      'opening_budget + (inflow_forecast + inflow_predicted) − (exits_forecast + exits_predicted).',
    total_capacity: 'sundown_capacity + warabah_capacity + nutrition_increase.',
    rainfall_adjusted_capacity:
      'total_capacity × rolling_3mo_pct, hard-capped at 16,000 head when rolling % > 130%.',
    capacity_variance: 'rainfall_adjusted_capacity − closing (Actual when present, else Budget).',
    pct_of_avg:
      'actual_rainfall ÷ historical_rainfall. For the in-progress month, scaled by pct of month elapsed.',
    rolling_3mo_pct:
      'Average of the current month and the prior 2 months pct_of_avg. Null if any are missing.',
  };

  if (row in DERIVED_DESCRIPTIONS) {
    res.json({ row, month, kind: 'derived', description: DERIVED_DESCRIPTIONS[row] });
    return;
  }

  res.status(400).json({ error: `unknown row: ${row}` });
});

/**
 * PATCH /api/flow/capacity
 * Body: { property: 'Sundown'|'Warabah', year, month, base_capacity?, nutrition_increase? }
 * Upserts a capacity_override row. Either field can be patched independently.
 */
flowRouter.patch('/capacity', (req, res) => {
  const body = req.body as {
    property?: string;
    year?: number;
    month?: number;
    base_capacity?: number;
    nutrition_increase?: number;
  };
  if (!body.property || !body.year || !body.month) {
    res.status(400).json({ error: 'property, year, month required' });
    return;
  }
  const db = getDb();
  const property = db
    .prepare('SELECT id FROM property WHERE name = ?')
    .get(body.property) as { id: number } | undefined;
  if (!property) {
    res.status(404).json({ error: `property "${body.property}" not found` });
    return;
  }
  const existing = db
    .prepare(
      'SELECT base_capacity, nutrition_increase FROM capacity_override WHERE property_id = ? AND year = ? AND month = ?',
    )
    .get(property.id, body.year, body.month) as
    | { base_capacity: number; nutrition_increase: number }
    | undefined;
  const base_capacity = body.base_capacity ?? existing?.base_capacity ?? 0;
  const nutrition_increase = body.nutrition_increase ?? existing?.nutrition_increase ?? 0;

  db.prepare(
    `
    INSERT INTO capacity_override (property_id, year, month, base_capacity, nutrition_increase)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(property_id, year, month) DO UPDATE SET
      base_capacity = excluded.base_capacity,
      nutrition_increase = excluded.nutrition_increase
  `,
  ).run(property.id, body.year, body.month, base_capacity, nutrition_increase);

  res.json({ ok: true, base_capacity, nutrition_increase });
});

/**
 * PATCH /api/flow/rainfall
 * Body: { year, month, mm_actual?, mm_historical_avg? }
 * Updates rainfall for both Sundown and Warabah (shared baseline per user spec).
 */
flowRouter.patch('/rainfall', (req, res) => {
  const body = req.body as {
    year?: number;
    month?: number;
    mm_actual?: number | null;
    mm_historical_avg?: number | null;
  };
  if (!body.year || !body.month) {
    res.status(400).json({ error: 'year, month required' });
    return;
  }
  const db = getDb();
  const props = db.prepare('SELECT id, name FROM property').all() as Array<{
    id: number;
    name: string;
  }>;
  const upsert = db.prepare(
    `
    INSERT INTO monthly_rainfall (property_id, year, month, mm_actual, mm_historical_avg)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(property_id, year, month) DO UPDATE SET
      mm_actual = COALESCE(excluded.mm_actual, monthly_rainfall.mm_actual),
      mm_historical_avg = COALESCE(excluded.mm_historical_avg, monthly_rainfall.mm_historical_avg)
  `,
  );
  for (const p of props) {
    upsert.run(
      p.id,
      body.year,
      body.month,
      body.mm_actual ?? null,
      body.mm_historical_avg ?? null,
    );
  }
  res.json({ ok: true });
});

/**
 * POST /api/flow/prediction
 * Body: { date: "YYYY-MM-DD", type: 'IN'|'OUT', head_count, livestock_class?, description?, ... }
 * Creates a transaction_event row with source='Predicted'. These are user-authored
 * forecasts and survive xlsx re-imports.
 */
flowRouter.post('/prediction', (req, res) => {
  const body = req.body as {
    date?: string;
    type?: 'IN' | 'OUT';
    head_count?: number;
    livestock_class?: string;
    description?: string;
    owner?: string;
    herd?: string;
    origin_destination?: string;
    notes?: string;
  };
  if (!body.date || !body.type || !body.head_count) {
    res.status(400).json({ error: 'date, type, head_count required' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (body.type !== 'IN' && body.type !== 'OUT') {
    res.status(400).json({ error: 'type must be IN or OUT' });
    return;
  }
  const db = getDb();
  const result = db
    .prepare(
      `
      INSERT INTO transaction_event
        (txn_number, date, type, owner, contract, herd, livestock_class,
         head_count, description, origin_destination, sale_purchase_type, notes, source)
      VALUES (NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, 'Predicted')
    `,
    )
    .run(
      body.date,
      body.type,
      body.owner ?? null,
      body.herd ?? null,
      body.livestock_class ?? null,
      body.head_count,
      body.description ?? null,
      body.origin_destination ?? null,
      body.notes ?? null,
    );
  res.json({ ok: true, id: result.lastInsertRowid });
});

/**
 * DELETE /api/flow/prediction/:id
 * Removes a Predicted transaction row by id. Safe because we only allow
 * deleting rows where source='Predicted'.
 */
flowRouter.delete('/prediction/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  const result = db
    .prepare("DELETE FROM transaction_event WHERE id = ? AND source = 'Predicted'")
    .run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'no Predicted row with that id' });
    return;
  }
  res.json({ ok: true });
});

/**
 * GET /api/flow/debug
 * Surfaces the year distribution across all tables, so we can find
 * outlier dates (year 0001, year 9999, etc.) and trace them to their import.
 */
flowRouter.get('/debug', (_req, res) => {
  const db = getDb();
  const txYears = db
    .prepare(
      `
      SELECT substr(date, 1, 4) AS year, COUNT(*) AS n
      FROM transaction_event
      GROUP BY substr(date, 1, 4)
      ORDER BY year
    `,
    )
    .all();
  const capYears = db
    .prepare('SELECT year, COUNT(*) AS n FROM capacity_override GROUP BY year ORDER BY year')
    .all();
  const rainYears = db
    .prepare('SELECT year, COUNT(*) AS n FROM monthly_rainfall GROUP BY year ORDER BY year')
    .all();
  const openYears = db
    .prepare('SELECT year, COUNT(*) AS n FROM opening_balance GROUP BY year ORDER BY year')
    .all();

  // Surface the worst offenders explicitly.
  const wildTxRows = db
    .prepare(
      `
      SELECT id, date, type, source, head_count, description, notes
      FROM transaction_event
      WHERE CAST(substr(date, 1, 4) AS INTEGER) < 2020
         OR CAST(substr(date, 1, 4) AS INTEGER) > 2035
      LIMIT 20
    `,
    )
    .all();

  res.json({
    transaction_years: txYears,
    capacity_years: capYears,
    rainfall_years: rainYears,
    opening_years: openYears,
    wild_transaction_rows: wildTxRows,
  });
});

/**
 * GET /api/flow/months
 * Lightweight summary: head movement counts by month/type/source.
 * Kept for backwards compatibility with the early status check.
 */
flowRouter.get('/months', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT month_key, type, source, head_count
      FROM v_flow_month
      ORDER BY month_key
    `,
    )
    .all();
  res.json({ rows });
});
