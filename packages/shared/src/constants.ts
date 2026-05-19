export const LIVESTOCK_CLASSES = [
  'heifer_calf',
  'heifer_weaner',
  'cull_heifer_weaner',
  'heifer_joiner',
  'cull_heifer_yearling',
  'heifer',
  'cull_heifer',
  'feeder_heifer',
  'breeder',
  'cull_breeder',
  'male_calf',
  'male_weaner',
  'bull_weaner',
  'bull_yearling',
  'bull',
  'cull_bull',
  'steer_weaner',
  'steer_yearling',
  'steer',
  'bullock',
  'feeder_steer',
] as const;

export type LivestockClass = (typeof LIVESTOCK_CLASSES)[number];

export const BREED_TYPES = ['FB', 'F1', 'PB'] as const;
export type BreedType = (typeof BREED_TYPES)[number];

export const TRANSACTION_TYPES = ['IN', 'OUT'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = ['Actual', 'Forecast', 'Predicted'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const SEXES = ['M', 'F'] as const;
export type Sex = (typeof SEXES)[number];

export const RAINFALL_HARD_CAP_HEAD = 16000;
export const RAINFALL_HARD_CAP_PCT = 1.3;

export const DEFAULT_ADG_KG_PER_DAY = 0.6;

export function titleCase(snake: string): string {
  return snake
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
