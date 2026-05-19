import { Router } from 'express';
import { getDb } from '../db/index.js';

export const transactionsRouter = Router();

/**
 * GET /api/transactions
 * Query params:
 *   from=YYYY-MM-DD, to=YYYY-MM-DD
 *   type=IN|OUT
 *   source=Actual|Forecast|Predicted
 *   class=feeder_steer    (livestock_class snake_case)
 *   q=text-search (matches description / origin_destination / notes / owner / herd)
 *   limit=100 (default), offset=0
 */
transactionsRouter.get('/', (req, res) => {
  const db = getDb();
  const { from, to, type, source, q } = req.query as Record<string, string | undefined>;
  const cls = (req.query['class'] as string | undefined) ?? undefined;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const where: string[] = [];
  const params: unknown[] = [];
  if (from) {
    where.push('date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('date <= ?');
    params.push(to);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (source) {
    where.push('source = ?');
    params.push(source);
  }
  if (cls) {
    where.push('livestock_class = ?');
    params.push(cls);
  }
  if (q) {
    where.push(
      '(description LIKE ? OR origin_destination LIKE ? OR notes LIKE ? OR owner LIKE ? OR herd LIKE ? OR txn_number LIKE ?)',
    );
    const wildcard = `%${q}%`;
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM transaction_event ${whereSql}`)
    .get(...params) as { n: number };

  const rows = db
    .prepare(
      `
      SELECT * FROM transaction_event
      ${whereSql}
      ORDER BY date DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  res.json({ total: totalRow.n, limit, offset, rows });
});

/**
 * POST /api/transactions
 * Always creates source='Predicted' regardless of input — Actual + Forecast come
 * exclusively from the spreadsheet importer.
 */
transactionsRouter.post('/', (req, res) => {
  const body = req.body as {
    date?: string;
    type?: 'IN' | 'OUT';
    head_count?: number;
    livestock_class?: string;
    description?: string;
    owner?: string;
    contract?: string;
    herd?: string;
    origin_destination?: string;
    sale_purchase_type?: string;
    notes?: string;
    txn_number?: string;
    avg_weight_kg?: number;
    price_per_kg?: number;
    freight?: number;
    total_cost?: number;
  };
  if (!body.date || !body.type || body.head_count == null) {
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
  // Auto-compute total_cost if price + head + avg_weight provided and total
  // wasn't explicit.
  let totalCost = body.total_cost ?? null;
  if (
    totalCost == null &&
    body.price_per_kg != null &&
    body.head_count != null &&
    body.avg_weight_kg != null
  ) {
    totalCost = Math.round(body.price_per_kg * body.head_count * body.avg_weight_kg * 100) / 100;
  }
  const result = db
    .prepare(
      `
      INSERT INTO transaction_event
        (txn_number, date, type, owner, contract, herd, livestock_class,
         head_count, description, origin_destination, sale_purchase_type, notes, source,
         avg_weight_kg, price_per_kg, freight, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Predicted', ?, ?, ?, ?)
    `,
    )
    .run(
      body.txn_number ?? null,
      body.date,
      body.type,
      body.owner ?? null,
      body.contract ?? null,
      body.herd ?? null,
      body.livestock_class ?? null,
      body.head_count,
      body.description ?? null,
      body.origin_destination ?? null,
      body.sale_purchase_type ?? null,
      body.notes ?? null,
      body.avg_weight_kg ?? null,
      body.price_per_kg ?? null,
      body.freight ?? null,
      totalCost,
    );
  res.json({ id: result.lastInsertRowid });
});

/**
 * PATCH /api/transactions/:id
 * Only allowed on source='Predicted' rows — Actual + Forecast come from the
 * spreadsheet and would be reverted on next import anyway.
 */
transactionsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const db = getDb();
  const existing = db
    .prepare('SELECT source FROM transaction_event WHERE id = ?')
    .get(id) as { source: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (existing.source !== 'Predicted') {
    res.status(403).json({
      error: `cannot edit ${existing.source} transactions — they come from the spreadsheet. Edit in Excel + re-import.`,
    });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const editable = [
    'txn_number',
    'date',
    'type',
    'owner',
    'contract',
    'herd',
    'livestock_class',
    'head_count',
    'description',
    'origin_destination',
    'sale_purchase_type',
    'notes',
    'avg_weight_kg',
    'price_per_kg',
    'freight',
    'total_cost',
  ] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const f of editable) {
    if (f in body) {
      sets.push(`${f} = ?`);
      params.push(body[f] ?? null);
    }
  }
  if (sets.length === 0) {
    res.json({ ok: true, changes: 0 });
    return;
  }
  params.push(id);
  db.prepare(`UPDATE transaction_event SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

/**
 * DELETE /api/transactions/:id
 * Same source-guard as PATCH.
 */
transactionsRouter.delete('/:id', (req, res) => {
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
    res.status(403).json({
      error: 'transaction not found or not deletable (only Predicted rows can be deleted)',
    });
    return;
  }
  res.json({ ok: true });
});
