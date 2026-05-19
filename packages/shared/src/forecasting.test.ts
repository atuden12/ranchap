import { describe, it, expect } from 'vitest';
import {
  rainfallAdjustedCapacity,
  rollingPctOfAvg,
  currentMonthAdjustedPct,
  projectAnimalWeight,
  predictExit,
  daysBetween,
} from './forecasting.js';
import { classifyByWeight, predictMarketEntry, DEFAULT_MARKET_BANDS } from './market-bands.js';

describe('rainfallAdjustedCapacity', () => {
  it('drought year (rolling 50%) on Sundown 11,200 + Warabah 1,500 = 6,350', () => {
    const result = rainfallAdjustedCapacity({
      sundownCapacity: 11200,
      warabahCapacity: 1500,
      nutritionIncrease: 0,
      rollingPctOfAvg: 0.5,
    });
    expect(result).toBe(6350);
  });

  it('average year (rolling 100%) = base capacity 12,700', () => {
    const result = rainfallAdjustedCapacity({
      sundownCapacity: 11200,
      warabahCapacity: 1500,
      nutritionIncrease: 0,
      rollingPctOfAvg: 1.0,
    });
    expect(result).toBe(12700);
  });

  it('wet year capped at 16,000 when rolling > 130%', () => {
    const result = rainfallAdjustedCapacity({
      sundownCapacity: 11200,
      warabahCapacity: 1500,
      nutritionIncrease: 0,
      rollingPctOfAvg: 1.4,
    });
    expect(result).toBe(16000);
  });

  it('exactly 130% rolling does NOT trigger cap (must be > 130%)', () => {
    const result = rainfallAdjustedCapacity({
      sundownCapacity: 11200,
      warabahCapacity: 1500,
      nutritionIncrease: 0,
      rollingPctOfAvg: 1.3,
    });
    // 12700 * 1.3 = 16510, but cap only triggers strictly above 1.3
    expect(result).toBe(16510);
  });

  it('nutrition increase adds before rainfall multiplier', () => {
    // (11200 + 1500 + 1000) * 0.8 = 13700 * 0.8 = 10960
    const result = rainfallAdjustedCapacity({
      sundownCapacity: 11200,
      warabahCapacity: 1500,
      nutritionIncrease: 1000,
      rollingPctOfAvg: 0.8,
    });
    expect(result).toBe(10960);
  });
});

describe('rollingPctOfAvg', () => {
  it('averages the last 3 entries', () => {
    expect(rollingPctOfAvg([1.2, 0.9, 0.6])).toBeCloseTo(0.9);
  });

  it('uses last 3 even when more provided', () => {
    expect(rollingPctOfAvg([0.1, 0.2, 1.2, 0.9, 0.6])).toBeCloseTo(0.9);
  });

  it('returns null with fewer than 3 entries', () => {
    expect(rollingPctOfAvg([0.9, 1.0])).toBeNull();
  });

  it('returns null if any of last 3 is null', () => {
    expect(rollingPctOfAvg([1.0, null, 0.8])).toBeNull();
  });
});

describe('currentMonthAdjustedPct', () => {
  it('15th of a 30-day month with half the avg rain = ~100% pace', () => {
    // June 2026 has 30 days. June 15 = day 15 = 50% elapsed.
    // 30mm actual, 60mm historical avg => 30 / (60 * 0.5) = 1.0
    const result = currentMonthAdjustedPct({
      actualMmToDate: 30,
      historicalAvgMm: 60,
      asOf: new Date(2026, 5, 15), // month index 5 = June
    });
    expect(result).toBeCloseTo(1.0);
  });

  it('end of month equals raw ratio', () => {
    // June 30 = full month. 90mm / 60mm = 1.5
    const result = currentMonthAdjustedPct({
      actualMmToDate: 90,
      historicalAvgMm: 60,
      asOf: new Date(2026, 5, 30),
    });
    expect(result).toBeCloseTo(1.5);
  });

  it('returns null when historical avg is 0', () => {
    expect(
      currentMonthAdjustedPct({
        actualMmToDate: 10,
        historicalAvgMm: 0,
        asOf: new Date(2026, 5, 15),
      }),
    ).toBeNull();
  });
});

describe('projectAnimalWeight', () => {
  it('lastWeight + adg * days_elapsed', () => {
    const w = projectAnimalWeight({
      lastWeightKg: 300,
      lastWeightDate: new Date('2026-01-01'),
      adgKgPerDay: 0.6,
      asOfDate: new Date('2026-04-01'), // 90 days
    });
    expect(w).toBeCloseTo(300 + 0.6 * 90);
  });

  it('clamps to lastWeight when asOfDate is before lastWeightDate', () => {
    const w = projectAnimalWeight({
      lastWeightKg: 300,
      lastWeightDate: new Date('2026-04-01'),
      adgKgPerDay: 0.6,
      asOfDate: new Date('2026-01-01'),
    });
    expect(w).toBe(300);
  });
});

describe('predictExit', () => {
  it('returns days/date/final-weight for animal below target', () => {
    const today = new Date('2026-05-16');
    const result = predictExit(
      {
        lastWeightKg: 300,
        lastWeightDate: new Date('2026-04-16'), // 30 days ago
        adgKgPerDay: 0.6,
        targetWeightKg: 400,
      },
      today,
    );
    // projectedToday = 300 + 0.6 * 30 = 318
    // daysToExit = ceil((400 - 318) / 0.6) = ceil(136.67) = 137
    expect(result.daysToExit).toBe(137);
    expect(result.predictedFinalWeightKg).toBeCloseTo(318 + 0.6 * 137);
    expect(daysBetween(today, result.predictedExitDate)).toBe(137);
  });

  it('returns 0 days if already at or above target', () => {
    const result = predictExit(
      {
        lastWeightKg: 410,
        lastWeightDate: new Date('2026-05-16'),
        adgKgPerDay: 0.6,
        targetWeightKg: 400,
      },
      new Date('2026-05-16'),
    );
    expect(result.daysToExit).toBe(0);
  });

  it('handles non-positive ADG without dividing by zero', () => {
    const result = predictExit(
      {
        lastWeightKg: 300,
        lastWeightDate: new Date('2026-05-16'),
        adgKgPerDay: 0,
        targetWeightKg: 400,
      },
      new Date('2026-05-16'),
    );
    expect(result.daysToExit).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('classifyByWeight', () => {
  it('370kg steer falls into EUHQB (highest priority)', () => {
    const band = classifyByWeight(380, 'M', DEFAULT_MARKET_BANDS);
    expect(band?.name).toBe('EUHQB');
  });

  it('460kg steer above EUHQB max → Feeder Steer EU (next priority)', () => {
    const band = classifyByWeight(460, 'M', DEFAULT_MARKET_BANDS);
    expect(band?.name).toBe('Feeder Steer EU');
  });

  it('350kg below all bands returns null', () => {
    expect(classifyByWeight(350, 'M', DEFAULT_MARKET_BANDS)).toBeNull();
  });

  it('respects sex — heifer at 380 falls into EUHQB (sex=null match) before Feeder Heifer EU', () => {
    const band = classifyByWeight(380, 'F', DEFAULT_MARKET_BANDS);
    expect(band?.name).toBe('EUHQB');
  });
});

describe('predictMarketEntry', () => {
  it('300kg steer at 0.6kg/day enters EUHQB after ~117 days', () => {
    const result = predictMarketEntry({
      lastWeightKg: 300,
      lastWeightDate: new Date('2026-01-01'),
      adgKgPerDay: 0.6,
      sex: 'M',
      bands: DEFAULT_MARKET_BANDS,
    });
    expect(result?.band.name).toBe('EUHQB');
    const expectedDays = Math.ceil((370 - 300) / 0.6); // 117
    expect(daysBetween(new Date('2026-01-01'), result!.entryDate)).toBe(expectedDays);
  });

  it('returns null when animal cannot reach any band within horizon', () => {
    const result = predictMarketEntry({
      lastWeightKg: 100,
      lastWeightDate: new Date('2026-01-01'),
      adgKgPerDay: 0.1, // 270kg over 720 days = 370kg, just hits min — but ceil rounding may push over
      sex: 'M',
      bands: DEFAULT_MARKET_BANDS,
      horizonDays: 100,
    });
    expect(result).toBeNull();
  });
});
