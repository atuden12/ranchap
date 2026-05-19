import { RAINFALL_HARD_CAP_HEAD, RAINFALL_HARD_CAP_PCT } from './constants.js';

export interface CapacityInputs {
  sundownCapacity: number;
  warabahCapacity: number;
  /** Bumps capacity when supplementing — added to base before rainfall multiplier. */
  nutritionIncrease: number;
  /** Average of (this month %, prior month %, two months ago %). 1.0 = "average year". */
  rollingPctOfAvg: number;
}

/**
 * Rainfall-adjusted grazing capacity. Formula from Stock_Flow_MASTER:
 *   base = sundown + warabah + nutrition_increase
 *   adjusted = base * rolling_pct_of_avg
 *   IF rolling_pct > 1.30 THEN adjusted = 16_000 (hard cap)
 */
export function rainfallAdjustedCapacity(inputs: CapacityInputs): number {
  const base = inputs.sundownCapacity + inputs.warabahCapacity + inputs.nutritionIncrease;
  if (inputs.rollingPctOfAvg > RAINFALL_HARD_CAP_PCT) {
    return RAINFALL_HARD_CAP_HEAD;
  }
  return Math.round(base * inputs.rollingPctOfAvg);
}

/**
 * 3-month rolling avg of percent-of-historical-average rainfall.
 * pctSeries is ordered oldest -> newest; the last 3 entries are averaged.
 * Returns null if fewer than 3 entries are non-null.
 */
export function rollingPctOfAvg(pctSeries: Array<number | null>): number | null {
  if (pctSeries.length < 3) return null;
  const last3 = pctSeries.slice(-3);
  if (last3.some((v) => v == null || !Number.isFinite(v))) return null;
  const sum = (last3 as number[]).reduce((a, b) => a + b, 0);
  return sum / 3;
}

export interface InProgressMonthRainfall {
  actualMmToDate: number;
  historicalAvgMm: number;
  /** Date the user is asking about — typically "today". */
  asOf: Date;
}

/**
 * For the in-progress month only: scale actual rainfall by how much of the month has elapsed.
 * Returns a percentage-of-average (1.0 = on track).
 *
 * Example: on the 15th of a 30-day month, half elapsed. 30mm actual vs 60mm historical avg
 * naively reads as 50%; the adjusted answer is 30 / (60 * 0.5) = 100%.
 */
export function currentMonthAdjustedPct(input: InProgressMonthRainfall): number | null {
  const { actualMmToDate, historicalAvgMm, asOf } = input;
  if (historicalAvgMm <= 0) return null;
  const year = asOf.getFullYear();
  const month = asOf.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = asOf.getDate();
  const pctMonthElapsed = day / daysInMonth;
  if (pctMonthElapsed <= 0) return null;
  return actualMmToDate / (historicalAvgMm * pctMonthElapsed);
}

export interface WeightProjectionInput {
  lastWeightKg: number;
  lastWeightDate: Date;
  adgKgPerDay: number;
  asOfDate: Date;
}

/**
 * Project an animal's weight forward: lastWeight + adg * days_elapsed.
 * Days_elapsed is clamped to >= 0 — we never project weight backwards.
 */
export function projectAnimalWeight(input: WeightProjectionInput): number {
  const days = Math.max(0, daysBetween(input.lastWeightDate, input.asOfDate));
  return input.lastWeightKg + input.adgKgPerDay * days;
}

export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface ExitPredictionInput {
  lastWeightKg: number;
  lastWeightDate: Date;
  adgKgPerDay: number;
  targetWeightKg: number;
}

export interface ExitPrediction {
  predictedExitDate: Date;
  daysToExit: number;
  predictedFinalWeightKg: number;
}

/**
 * Given current liveweight + ADG + target exit weight, return predicted exit date
 * and final weight on that date. If already above target, exit date = today.
 */
export function predictExit(input: ExitPredictionInput, today: Date = new Date()): ExitPrediction {
  const projectedToday = projectAnimalWeight({
    lastWeightKg: input.lastWeightKg,
    lastWeightDate: input.lastWeightDate,
    adgKgPerDay: input.adgKgPerDay,
    asOfDate: today,
  });

  if (projectedToday >= input.targetWeightKg) {
    return {
      predictedExitDate: today,
      daysToExit: 0,
      predictedFinalWeightKg: projectedToday,
    };
  }

  if (input.adgKgPerDay <= 0) {
    return {
      predictedExitDate: new Date(8640000000000000), // distant future
      daysToExit: Number.POSITIVE_INFINITY,
      predictedFinalWeightKg: projectedToday,
    };
  }

  const daysToExit = Math.ceil((input.targetWeightKg - projectedToday) / input.adgKgPerDay);
  const predictedExitDate = new Date(today.getTime());
  predictedExitDate.setDate(predictedExitDate.getDate() + daysToExit);
  const predictedFinalWeightKg = projectedToday + input.adgKgPerDay * daysToExit;

  return { predictedExitDate, daysToExit, predictedFinalWeightKg };
}
