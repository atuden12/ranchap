import type { MarketBand } from './types.js';
import type { Sex } from './constants.js';
import { projectAnimalWeight } from './forecasting.js';

/**
 * Default market bands. All values are LIVEWEIGHT in kg.
 * Per user spec 2026-05-16: EUHQB is 370–450 kg liveweight (no carcase conversion).
 * Bands are editable via the Settings panel and persisted in the `market_band` table;
 * these defaults are seeded on first run.
 */
export const DEFAULT_MARKET_BANDS: Omit<MarketBand, 'id'>[] = [
  { name: 'Feeder Steer EU', sex: 'M', min_weight_kg: 370, max_weight_kg: 500, priority: 10 },
  { name: 'Feeder Steer Non-EU', sex: 'M', min_weight_kg: 370, max_weight_kg: 500, priority: 20 },
  { name: 'Feeder Heifer EU', sex: 'F', min_weight_kg: 370, max_weight_kg: 465, priority: 10 },
  { name: 'Feeder Heifer Non-EU', sex: 'F', min_weight_kg: 370, max_weight_kg: 475, priority: 20 },
  { name: 'EUHQB', sex: null, min_weight_kg: 370, max_weight_kg: 450, priority: 5 },
];

/** Returns the highest-priority band the given liveweight falls into, or null. */
export function classifyByWeight(
  weightKg: number,
  sex: Sex | null,
  bands: ReadonlyArray<Omit<MarketBand, 'id'>>,
): Omit<MarketBand, 'id'> | null {
  const candidates = bands
    .filter((b) => b.sex == null || sex == null || b.sex === sex)
    .filter((b) => weightKg >= b.min_weight_kg && weightKg <= b.max_weight_kg)
    .sort((a, b) => a.priority - b.priority);
  return candidates[0] ?? null;
}

export interface PredictMarketEntryInput {
  lastWeightKg: number;
  lastWeightDate: Date;
  adgKgPerDay: number;
  sex: Sex | null;
  bands: ReadonlyArray<Omit<MarketBand, 'id'>>;
  /** How far ahead to look. */
  horizonDays?: number;
}

export interface PredictedMarketEntry {
  band: Omit<MarketBand, 'id'>;
  entryDate: Date;
  entryWeightKg: number;
}

/**
 * Walks daily from `lastWeightDate` forward; returns the first band the animal enters.
 * If the animal is already inside a band at the start, returns that band on day 0.
 */
export function predictMarketEntry(input: PredictMarketEntryInput): PredictedMarketEntry | null {
  const horizon = input.horizonDays ?? 720; // 2 years
  const start = input.lastWeightDate;
  for (let d = 0; d <= horizon; d++) {
    const date = new Date(start.getTime());
    date.setDate(date.getDate() + d);
    const projected = projectAnimalWeight({
      lastWeightKg: input.lastWeightKg,
      lastWeightDate: input.lastWeightDate,
      adgKgPerDay: input.adgKgPerDay,
      asOfDate: date,
    });
    const band = classifyByWeight(projected, input.sex, input.bands);
    if (band) return { band, entryDate: date, entryWeightKg: projected };
  }
  return null;
}
