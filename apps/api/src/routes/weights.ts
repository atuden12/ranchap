import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  DEFAULT_ADG_KG_PER_DAY,
  projectAnimalWeight,
  classifyByWeight,
  type MarketBand,
  type Sex,
} from '@ranchapp/shared';

export const weightsRouter = Router();

interface AnimalQueryRow {
  id: number;
  eid: string | null;
  visual_id: string | null;
  sex: Sex | null;
  livestock_class: string | null;
  last_weight: number;
  last_weight_date: string;
  adg: number | null;
  target_exit_weight: number | null;
  exit_market_category: string | null;
  mob_id: number | null;
  mob_name: string | null;
  breed_type: string | null;
  market_class: string | null;
  paddock_name: string | null;
  property_name: string | null;
}

function buildDateColumns(today: Date): Date[] {
  const cols: Date[] = [];
  const push = (d: Date) => cols.push(new Date(d));
  push(today);

  const plusDays = new Date(today);
  plusDays.setDate(plusDays.getDate() + 14);
  push(plusDays); // +2 weeks

  for (let m = 1; m <= 3; m++) {
    const d = new Date(today);
    d.setMonth(d.getMonth() + m);
    push(d);
  }
  // monthly through +18 months
  for (let m = 4; m <= 18; m++) {
    const d = new Date(today);
    d.setMonth(d.getMonth() + m);
    push(d);
  }
  return cols;
}

/**
 * GET /api/forecasted-weights
 * Per-animal weight projections across ~20 future dates, with market band
 * classification at each date and an overall predicted market category.
 *
 * Skips animals that lack a last_weight or last_weight_date — there's no
 * basis for projection. ADG defaults to 0.6 when missing.
 */
weightsRouter.get('/', (_req, res) => {
  const db = getDb();

  const bands = db
    .prepare('SELECT * FROM market_band ORDER BY priority, min_weight_kg')
    .all() as MarketBand[];

  // ADG matrix lookup: class → month → adg. Used when an animal has no per-row override.
  const adgRows = db
    .prepare('SELECT livestock_class, month, adg FROM adg_matrix')
    .all() as Array<{ livestock_class: string; month: number; adg: number }>;
  const adgMatrix = new Map<string, Map<number, number>>();
  for (const r of adgRows) {
    if (!adgMatrix.has(r.livestock_class)) adgMatrix.set(r.livestock_class, new Map());
    adgMatrix.get(r.livestock_class)!.set(r.month, r.adg);
  }

  const animals = db
    .prepare(
      `
      SELECT
        a.id, a.eid, a.visual_id, a.sex, a.livestock_class,
        a.current_weight AS last_weight, a.last_weight_date,
        a.adg, a.target_exit_weight, a.exit_market_category,
        m.id AS mob_id, m.name AS mob_name, m.breed_type, m.market_class,
        pad.name AS paddock_name, p.name AS property_name
      FROM animal a
      LEFT JOIN mob m ON m.id = a.mob_id
      LEFT JOIN paddock pad ON pad.id = m.paddock_id
      LEFT JOIN property p ON p.id = pad.property_id
      WHERE a.current_weight IS NOT NULL AND a.last_weight_date IS NOT NULL
      ORDER BY p.name, pad.name, m.name, a.visual_id
    `,
    )
    .all() as AnimalQueryRow[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateColumns = buildDateColumns(today);
  const dateColumnsIso = dateColumns.map((d) => d.toISOString().slice(0, 10));

  const bandLookup = bands.map((b) => ({
    name: b.name,
    sex: b.sex,
    min_weight_kg: b.min_weight_kg,
    max_weight_kg: b.max_weight_kg,
    priority: b.priority,
  }));

  const todayMonth = today.getMonth() + 1;

  const out = animals.map((a) => {
    // Resolve ADG: per-animal override → ADG matrix (by class × current month) → default.
    // Explicit ternary so the type is `number | undefined`, not `string | number`.
    const matrixAdg: number | undefined = a.livestock_class
      ? adgMatrix.get(a.livestock_class)?.get(todayMonth)
      : undefined;
    const adg = a.adg ?? matrixAdg ?? DEFAULT_ADG_KG_PER_DAY;
    const lastDate = new Date(a.last_weight_date);

    const projections = dateColumns.map((d) => {
      const w = projectAnimalWeight({
        lastWeightKg: a.last_weight,
        lastWeightDate: lastDate,
        adgKgPerDay: adg,
        asOfDate: d,
      });
      return Math.round(w * 10) / 10;
    });

    // Band classification at each future date
    const band_hits = projections.map((w) => {
      const band = classifyByWeight(w, a.sex, bandLookup);
      return band?.name ?? null;
    });

    // First index where the animal enters a band — that's the predicted exit point.
    const firstHitIdx = band_hits.findIndex((b) => b != null);
    const predicted_band = firstHitIdx >= 0 ? band_hits[firstHitIdx] : null;
    const predicted_exit_date = firstHitIdx >= 0 ? dateColumnsIso[firstHitIdx] : null;
    const predicted_final_weight = firstHitIdx >= 0 ? projections[firstHitIdx] : null;

    return {
      id: a.id,
      eid: a.eid,
      visual_id: a.visual_id,
      sex: a.sex,
      livestock_class: a.livestock_class,
      mob_id: a.mob_id,
      mob_name: a.mob_name,
      breed_type: a.breed_type,
      market_class: a.market_class,
      paddock_name: a.paddock_name,
      property_name: a.property_name,
      last_weight: a.last_weight,
      last_weight_date: a.last_weight_date,
      adg,
      target_exit_weight: a.target_exit_weight,
      exit_market_category: a.exit_market_category,
      projections,
      band_hits,
      predicted_band,
      predicted_exit_date,
      predicted_final_weight,
    };
  });

  res.json({
    bands,
    date_columns: dateColumnsIso,
    today: today.toISOString().slice(0, 10),
    animals: out,
  });
});

// ---------------------------------------------------------------------------
// Market band CRUD (Settings panel uses these)
// ---------------------------------------------------------------------------

weightsRouter.get('/bands', (_req, res) => {
  const db = getDb();
  const bands = db
    .prepare('SELECT * FROM market_band ORDER BY priority, min_weight_kg')
    .all();
  res.json({ bands });
});

weightsRouter.post('/bands', (req, res) => {
  const body = req.body as {
    name?: string;
    sex?: 'M' | 'F' | null;
    min_weight_kg?: number;
    max_weight_kg?: number;
    priority?: number;
  };
  if (!body.name || body.min_weight_kg == null || body.max_weight_kg == null) {
    res.status(400).json({ error: 'name, min_weight_kg, max_weight_kg required' });
    return;
  }
  if (body.min_weight_kg >= body.max_weight_kg) {
    res.status(400).json({ error: 'min_weight_kg must be less than max_weight_kg' });
    return;
  }
  const db = getDb();
  const result = db
    .prepare(
      `
      INSERT INTO market_band (name, sex, min_weight_kg, max_weight_kg, priority)
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      body.name,
      body.sex ?? null,
      body.min_weight_kg,
      body.max_weight_kg,
      body.priority ?? 100,
    );
  res.json({ id: result.lastInsertRowid });
});

weightsRouter.patch('/bands/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const body = req.body as {
    name?: string;
    sex?: 'M' | 'F' | null;
    min_weight_kg?: number;
    max_weight_kg?: number;
    priority?: number;
  };
  const db = getDb();
  const existing = db.prepare('SELECT * FROM market_band WHERE id = ?').get(id) as
    | {
        name: string;
        sex: 'M' | 'F' | null;
        min_weight_kg: number;
        max_weight_kg: number;
        priority: number;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'band not found' });
    return;
  }
  const merged = {
    name: body.name ?? existing.name,
    sex: body.sex !== undefined ? body.sex : existing.sex,
    min_weight_kg: body.min_weight_kg ?? existing.min_weight_kg,
    max_weight_kg: body.max_weight_kg ?? existing.max_weight_kg,
    priority: body.priority ?? existing.priority,
  };
  if (merged.min_weight_kg >= merged.max_weight_kg) {
    res.status(400).json({ error: 'min_weight_kg must be less than max_weight_kg' });
    return;
  }
  db.prepare(
    `
    UPDATE market_band
    SET name = ?, sex = ?, min_weight_kg = ?, max_weight_kg = ?, priority = ?
    WHERE id = ?
  `,
  ).run(merged.name, merged.sex, merged.min_weight_kg, merged.max_weight_kg, merged.priority, id);
  res.json({ ok: true });
});

/**
 * GET /api/forecasted-weights/adg-matrix
 * Full 240-row matrix (20 classes × 12 months).
 */
weightsRouter.get('/adg-matrix', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT livestock_class, month, adg FROM adg_matrix ORDER BY livestock_class, month')
    .all();
  res.json({ rows });
});

/**
 * PATCH /api/forecasted-weights/adg-matrix
 * Body: { livestock_class, month, adg }
 * Upserts one matrix cell.
 */
weightsRouter.patch('/adg-matrix', (req, res) => {
  const body = req.body as { livestock_class?: string; month?: number; adg?: number };
  if (!body.livestock_class || !body.month || body.adg == null) {
    res.status(400).json({ error: 'livestock_class, month, adg required' });
    return;
  }
  if (body.month < 1 || body.month > 12) {
    res.status(400).json({ error: 'month must be 1..12' });
    return;
  }
  if (body.adg < 0 || body.adg > 5) {
    res.status(400).json({ error: 'adg must be 0..5 kg/day (sanity bound)' });
    return;
  }
  const db = getDb();
  db.prepare(
    `
    INSERT INTO adg_matrix (livestock_class, month, adg)
    VALUES (?, ?, ?)
    ON CONFLICT(livestock_class, month) DO UPDATE SET adg = excluded.adg
  `,
  ).run(body.livestock_class, body.month, body.adg);
  res.json({ ok: true });
});

weightsRouter.delete('/bands/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  const result = db.prepare('DELETE FROM market_band WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'band not found' });
    return;
  }
  res.json({ ok: true });
});
