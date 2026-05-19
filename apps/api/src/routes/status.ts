import { Router } from 'express';
import { getDb } from '../db/index.js';
import { resolveDbPath } from '../paths.js';

export const statusRouter = Router();

statusRouter.get('/', (_req, res) => {
  const db = getDb();
  const counts = {
    properties: (db.prepare('SELECT COUNT(*) AS n FROM property').get() as { n: number }).n,
    paddocks: (db.prepare('SELECT COUNT(*) AS n FROM paddock').get() as { n: number }).n,
    mobs: (db.prepare('SELECT COUNT(*) AS n FROM mob').get() as { n: number }).n,
    animals: (db.prepare('SELECT COUNT(*) AS n FROM animal').get() as { n: number }).n,
    transactions: (db.prepare('SELECT COUNT(*) AS n FROM transaction_event').get() as { n: number })
      .n,
    weight_observations: (
      db.prepare('SELECT COUNT(*) AS n FROM weight_observation').get() as { n: number }
    ).n,
  };
  res.json({
    ok: true,
    db_path: resolveDbPath(),
    counts,
  });
});
