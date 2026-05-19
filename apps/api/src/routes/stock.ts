import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DEFAULT_ADG_KG_PER_DAY } from '@ranchapp/shared';

export const stockRouter = Router();

interface StockOnHandRow {
  property: string | null;
  paddock_id: number;
  paddock: string;
  mob_id: number;
  mob: string;
  breed_type: string | null;
  market_class: string | null;
  head_count: number;
  avg_weight: number | null;
  min_weight: number | null;
  max_weight: number | null;
  last_weigh_date: string | null;
  adg: number | null;
  target_exit_weight: number | null;
}

interface StockOnHandRowOut extends StockOnHandRow {
  days_since_last_weigh: number | null;
  estimated_weight: number | null;
  pred_min_weight: number | null;
  pred_max_weight: number | null;
  days_to_exit: number | null;
}

function daysBetween(fromISO: string, today: Date): number {
  const from = new Date(fromISO);
  const MS = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.round((today.getTime() - from.getTime()) / MS));
}

/**
 * GET /api/stock-on-hand
 * Per-mob aggregates joined to their paddock and property, with on-the-fly
 * weight projections (Estimated wgt, Pred Min/Max, Days to Exit).
 * Mobs without any linked animals still appear, just with null aggregates.
 */
stockRouter.get('/', (_req, res) => {
  const db = getDb();

  const rows = db
    .prepare(
      `
      SELECT
        p.name AS property,
        pad.id AS paddock_id,
        pad.name AS paddock,
        m.id AS mob_id,
        m.name AS mob,
        m.breed_type,
        m.market_class,
        COUNT(a.id) AS head_count,
        ROUND(AVG(a.current_weight), 1) AS avg_weight,
        MIN(a.current_weight) AS min_weight,
        MAX(a.current_weight) AS max_weight,
        MAX(a.last_weight_date) AS last_weigh_date,
        AVG(a.adg) AS adg,
        AVG(a.target_exit_weight) AS target_exit_weight
      FROM mob m
      LEFT JOIN paddock pad ON pad.id = m.paddock_id
      LEFT JOIN property p ON p.id = pad.property_id
      LEFT JOIN animal a ON a.mob_id = m.id
      GROUP BY m.id, m.name, m.breed_type, m.market_class, pad.id, pad.name, p.name
      ORDER BY p.name, pad.name, m.name
    `,
    )
    .all() as StockOnHandRow[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const out: StockOnHandRowOut[] = rows.map((r) => {
    const dslw = r.last_weigh_date ? daysBetween(r.last_weigh_date, today) : null;
    const adg = r.adg ?? DEFAULT_ADG_KG_PER_DAY;
    const drift = dslw != null ? adg * dslw : 0;

    const estimated_weight = r.avg_weight != null ? Math.round((r.avg_weight + drift) * 10) / 10 : null;
    const pred_min_weight = r.min_weight != null ? Math.round((r.min_weight + drift) * 10) / 10 : null;
    const pred_max_weight = r.max_weight != null ? Math.round((r.max_weight + drift) * 10) / 10 : null;

    let days_to_exit: number | null = null;
    if (estimated_weight != null && r.target_exit_weight != null && adg > 0) {
      days_to_exit = Math.round((r.target_exit_weight - estimated_weight) / adg);
    }

    return {
      ...r,
      adg,
      days_since_last_weigh: dslw,
      estimated_weight,
      pred_min_weight,
      pred_max_weight,
      days_to_exit,
    };
  });

  res.json({ rows: out });
});
