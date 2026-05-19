import { getDb } from './index.js';
import {
  DEFAULT_ADG_KG_PER_DAY,
  LIVESTOCK_CLASSES,
} from '@ranchapp/shared';
import { DEFAULT_MARKET_BANDS } from '@ranchapp/shared';

/**
 * Idempotent seed: creates the two properties, default market bands, and ADG matrix
 * if they don't already exist. Safe to run repeatedly.
 *
 * Capacity defaults are deliberately left at zero — per user spec 2026-05-16,
 * the first-run Settings UI confirms/edits capacity values (importer pre-fills them
 * when an xlsx is loaded).
 */
export function seed(): {
  propertiesCreated: number;
  bandsCreated: number;
  adgRowsCreated: number;
  feedTypesCreated: number;
} {
  const db = getDb();

  let propertiesCreated = 0;
  const ensureProp = db.prepare(`
    INSERT INTO property (name, default_monthly_capacity)
    SELECT ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM property WHERE name = ?)
  `);
  const zeroArray = JSON.stringify(new Array(12).fill(0));
  for (const name of ['Sundown', 'Warabah']) {
    const result = ensureProp.run(name, zeroArray, name);
    if (result.changes > 0) propertiesCreated++;
  }

  let bandsCreated = 0;
  const ensureBand = db.prepare(`
    INSERT INTO market_band (name, sex, min_weight_kg, max_weight_kg, priority)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM market_band WHERE name = ?)
  `);
  for (const b of DEFAULT_MARKET_BANDS) {
    const result = ensureBand.run(
      b.name,
      b.sex,
      b.min_weight_kg,
      b.max_weight_kg,
      b.priority,
      b.name,
    );
    if (result.changes > 0) bandsCreated++;
  }

  let feedTypesCreated = 0;
  const ensureFeedType = db.prepare(`
    INSERT INTO feed_type (name, unit, default_cost_per_unit)
    SELECT ?, 'kg', NULL
    WHERE NOT EXISTS (SELECT 1 FROM feed_type WHERE name = ?)
  `);
  for (const name of ['Hay', 'Silage', 'Pellets', 'Grain']) {
    const result = ensureFeedType.run(name, name);
    if (result.changes > 0) feedTypesCreated++;
  }

  let adgRowsCreated = 0;
  const ensureAdg = db.prepare(`
    INSERT INTO adg_matrix (livestock_class, month, adg)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM adg_matrix WHERE livestock_class = ? AND month = ?
    )
  `);
  for (const cls of LIVESTOCK_CLASSES) {
    for (let m = 1; m <= 12; m++) {
      const result = ensureAdg.run(cls, m, DEFAULT_ADG_KG_PER_DAY, cls, m);
      if (result.changes > 0) adgRowsCreated++;
    }
  }

  return { propertiesCreated, bandsCreated, adgRowsCreated, feedTypesCreated };
}
