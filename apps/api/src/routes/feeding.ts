import { Router } from 'express';
import { getDb } from '../db/index.js';

export const feedingRouter = Router();

interface FeedType {
  id: number;
  name: string;
  unit: string;
  default_cost_per_unit: number | null;
  notes: string | null;
}

interface FeedEvent {
  id: number;
  date: string;
  feed_type_id: number;
  feed_type_name?: string;
  mob_id: number | null;
  mob_name?: string | null;
  paddock_id: number | null;
  paddock_name?: string | null;
  cattle_group: string | null;
  head_count: number | null;
  kg_per_head_per_day: number | null;
  duration_days: number;
  total_kg: number;
  cost_per_unit: number | null;
  total_cost: number | null;
  notes: string | null;
}

/** Computes total_kg if not provided. */
function computeTotalKg(body: Partial<FeedEvent>): number | null {
  if (body.total_kg != null) return body.total_kg;
  const h = body.head_count;
  const k = body.kg_per_head_per_day;
  const d = body.duration_days ?? 1;
  if (h != null && k != null) return h * k * d;
  return null;
}

function computeTotalCost(totalKg: number | null, costPerUnit: number | null): number | null {
  if (totalKg == null || costPerUnit == null) return null;
  return Math.round(totalKg * costPerUnit * 100) / 100;
}

// ---------------------------------------------------------------------------
// Feed types
// ---------------------------------------------------------------------------

feedingRouter.get('/types', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM feed_type ORDER BY name').all();
  res.json({ rows });
});

feedingRouter.post('/types', (req, res) => {
  const body = req.body as Partial<FeedType>;
  if (!body.name) {
    res.status(400).json({ error: 'name required' });
    return;
  }
  const db = getDb();
  try {
    const result = db
      .prepare('INSERT INTO feed_type (name, unit, default_cost_per_unit, notes) VALUES (?, ?, ?, ?)')
      .run(body.name, body.unit ?? 'kg', body.default_cost_per_unit ?? null, body.notes ?? null);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

feedingRouter.patch('/types/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const body = req.body as Partial<FeedType>;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM feed_type WHERE id = ?').get(id) as
    | FeedType
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  db.prepare(
    'UPDATE feed_type SET name = ?, unit = ?, default_cost_per_unit = ?, notes = ? WHERE id = ?',
  ).run(
    body.name ?? existing.name,
    body.unit ?? existing.unit,
    body.default_cost_per_unit ?? existing.default_cost_per_unit,
    body.notes ?? existing.notes,
    id,
  );
  res.json({ ok: true });
});

feedingRouter.delete('/types/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  // Check for existing events first — guard against orphaning.
  const refCount = db
    .prepare('SELECT COUNT(*) AS n FROM feed_event WHERE feed_type_id = ?')
    .get(id) as { n: number };
  if (refCount.n > 0) {
    res.status(409).json({
      error: `cannot delete — ${refCount.n} feed_event row(s) reference this type`,
    });
    return;
  }
  const result = db.prepare('DELETE FROM feed_type WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Feed events
// ---------------------------------------------------------------------------

feedingRouter.get('/', (req, res) => {
  const db = getDb();
  const { from, to } = req.query as Record<string, string | undefined>;
  const feedTypeId = req.query.feed_type_id ? Number(req.query.feed_type_id) : undefined;
  const mobId = req.query.mob_id ? Number(req.query.mob_id) : undefined;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const where: string[] = [];
  const params: unknown[] = [];
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  if (feedTypeId) { where.push('e.feed_type_id = ?'); params.push(feedTypeId); }
  if (mobId) { where.push('e.mob_id = ?'); params.push(mobId); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM feed_event e ${whereSql}`)
    .get(...params) as { n: number };

  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        ft.name AS feed_type_name,
        m.name AS mob_name,
        p.name AS paddock_name
      FROM feed_event e
      JOIN feed_type ft ON ft.id = e.feed_type_id
      LEFT JOIN mob m ON m.id = e.mob_id
      LEFT JOIN paddock p ON p.id = e.paddock_id
      ${whereSql}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  res.json({ total: total.n, limit, offset, rows });
});

feedingRouter.post('/', (req, res) => {
  const body = req.body as Partial<FeedEvent>;
  if (!body.date || !body.feed_type_id) {
    res.status(400).json({ error: 'date and feed_type_id required' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  const totalKg = computeTotalKg(body);
  if (totalKg == null) {
    res.status(400).json({
      error: 'need either total_kg or (head_count + kg_per_head_per_day + duration_days)',
    });
    return;
  }
  const totalCost = computeTotalCost(totalKg, body.cost_per_unit ?? null);
  const db = getDb();
  const result = db
    .prepare(
      `
      INSERT INTO feed_event
        (date, feed_type_id, mob_id, paddock_id, cattle_group, head_count,
         kg_per_head_per_day, duration_days, total_kg, cost_per_unit, total_cost, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      body.date,
      body.feed_type_id,
      body.mob_id ?? null,
      body.paddock_id ?? null,
      body.cattle_group ?? null,
      body.head_count ?? null,
      body.kg_per_head_per_day ?? null,
      body.duration_days ?? 1,
      totalKg,
      body.cost_per_unit ?? null,
      totalCost,
      body.notes ?? null,
    );
  res.json({ id: result.lastInsertRowid, total_kg: totalKg, total_cost: totalCost });
});

feedingRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM feed_event WHERE id = ?').get(id) as
    | FeedEvent
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const body = req.body as Partial<FeedEvent>;
  const merged = { ...existing, ...body };
  const totalKg = computeTotalKg(merged);
  const totalCost = computeTotalCost(totalKg, merged.cost_per_unit ?? null);
  if (totalKg == null) {
    res.status(400).json({ error: 'cannot compute total_kg with these fields' });
    return;
  }
  db.prepare(
    `
    UPDATE feed_event SET
      date = ?, feed_type_id = ?, mob_id = ?, paddock_id = ?, cattle_group = ?,
      head_count = ?, kg_per_head_per_day = ?, duration_days = ?,
      total_kg = ?, cost_per_unit = ?, total_cost = ?, notes = ?
    WHERE id = ?
  `,
  ).run(
    merged.date,
    merged.feed_type_id,
    merged.mob_id ?? null,
    merged.paddock_id ?? null,
    merged.cattle_group ?? null,
    merged.head_count ?? null,
    merged.kg_per_head_per_day ?? null,
    merged.duration_days ?? 1,
    totalKg,
    merged.cost_per_unit ?? null,
    totalCost,
    merged.notes ?? null,
    id,
  );
  res.json({ ok: true, total_kg: totalKg, total_cost: totalCost });
});

feedingRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  const result = db.prepare('DELETE FROM feed_event WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

/**
 * GET /api/feeding/summary?from=&to=
 * Daily totals by feed type for charting. Aggregates total_kg + total_cost per
 * (date, feed_type) bucket.
 */
feedingRouter.get('/summary', (req, res) => {
  const db = getDb();
  const { from, to } = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: unknown[] = [];
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db
    .prepare(
      `
      SELECT
        e.date,
        ft.id AS feed_type_id,
        ft.name AS feed_type_name,
        SUM(e.total_kg) AS total_kg,
        SUM(COALESCE(e.total_cost, 0)) AS total_cost
      FROM feed_event e
      JOIN feed_type ft ON ft.id = e.feed_type_id
      ${whereSql}
      GROUP BY e.date, ft.id, ft.name
      ORDER BY e.date
    `,
    )
    .all(...params);

  res.json({ rows });
});
