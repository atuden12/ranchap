import { Router } from 'express';
import { getDb } from '../db/index.js';

export const budgetRouter = Router();

/**
 * GET /api/budget/summary?from=&to=&type=
 * Returns:
 *   - kpis: total_cost, total_freight, total_head, n_transactions
 *   - monthly: per-month rollup by sale_purchase_type (External Purchase / Internal Transfer / etc.)
 *   - by_counterparty: top spenders
 *   - by_class: per livestock_class cost
 */
budgetRouter.get('/summary', (req, res) => {
  const db = getDb();
  const { from, to, type } = req.query as Record<string, string | undefined>;
  const where: string[] = ["total_cost IS NOT NULL"];
  const params: unknown[] = [];
  if (from) { where.push('date >= ?'); params.push(from); }
  if (to) { where.push('date <= ?'); params.push(to); }
  if (type) { where.push('type = ?'); params.push(type); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const kpis = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(total_cost), 0) AS total_cost,
        COALESCE(SUM(freight), 0) AS total_freight,
        COALESCE(SUM(ABS(head_count)), 0) AS total_head,
        COUNT(*) AS n_transactions
      FROM transaction_event
      ${whereSql}
    `,
    )
    .get(...params);

  const monthly = db
    .prepare(
      `
      SELECT
        substr(date, 1, 7) AS month,
        sale_purchase_type AS category,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        COALESCE(SUM(freight), 0) AS total_freight,
        SUM(ABS(head_count)) AS total_head,
        COUNT(*) AS n
      FROM transaction_event
      ${whereSql}
      GROUP BY month, sale_purchase_type
      ORDER BY month
    `,
    )
    .all(...params);

  const byCounterparty = db
    .prepare(
      `
      SELECT
        COALESCE(origin_destination, '—') AS counterparty,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        SUM(ABS(head_count)) AS total_head,
        COUNT(*) AS n
      FROM transaction_event
      ${whereSql}
      GROUP BY counterparty
      ORDER BY total_cost DESC
      LIMIT 20
    `,
    )
    .all(...params);

  const byClass = db
    .prepare(
      `
      SELECT
        COALESCE(livestock_class, '—') AS livestock_class,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        SUM(ABS(head_count)) AS total_head,
        AVG(price_per_kg) AS avg_price_per_kg,
        AVG(avg_weight_kg) AS avg_weight_kg,
        COUNT(*) AS n
      FROM transaction_event
      ${whereSql}
      GROUP BY livestock_class
      ORDER BY total_cost DESC
    `,
    )
    .all(...params);

  res.json({ kpis, monthly, by_counterparty: byCounterparty, by_class: byClass });
});
