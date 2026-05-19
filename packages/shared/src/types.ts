import type {
  LivestockClass,
  BreedType,
  TransactionType,
  TransactionSource,
  Sex,
} from './constants.js';

export interface Property {
  id: number;
  name: string;
  /** 12 ints, index 0 = January. Used when no CapacityOverride exists for a month. */
  default_monthly_capacity: number[];
}

export interface Paddock {
  id: number;
  property_id: number;
  name: string;
  normal_capacity_head: number | null;
  current_status: string | null;
}

export interface Mob {
  id: number;
  name: string;
  breed_type: BreedType | null;
  market_class: string | null;
  owner: string | null;
  paddock_id: number | null;
}

export interface Animal {
  id: number;
  visual_id: string | null;
  eid: string | null;
  sex: Sex | null;
  mob_id: number | null;
  owner: string | null;
  livestock_class: LivestockClass | null;
  current_weight: number | null;
  last_weight_date: string | null; // ISO YYYY-MM-DD
  adg: number | null;
  target_exit_weight: number | null;
  exit_market_category: string | null;
}

export interface WeightObservation {
  id: number;
  animal_id: number;
  date: string; // ISO
  weight_kg: number;
}

export interface Transaction {
  id: number;
  txn_number: string | null;
  date: string; // ISO
  type: TransactionType;
  owner: string | null;
  contract: string | null;
  herd: string | null;
  livestock_class: LivestockClass | null;
  head_count: number;
  description: string | null;
  origin_destination: string | null;
  sale_purchase_type: string | null;
  notes: string | null;
  source: TransactionSource;
}

export interface MonthlyRainfall {
  property_id: number;
  year: number;
  month: number; // 1-12
  mm_actual: number | null;
  mm_historical_avg: number | null;
}

export interface CapacityOverride {
  property_id: number;
  year: number;
  month: number; // 1-12
  base_capacity: number;
  nutrition_increase: number;
}

/** A monthly liveweight ADG cell, overridable per class per calendar month. */
export interface AdgMatrixEntry {
  livestock_class: LivestockClass;
  month: number; // 1-12
  adg: number; // kg/day
}

/** Editable per-class market band, evaluated against projected liveweight. */
export interface MarketBand {
  id: number;
  name: string; // e.g. "EUHQB"
  sex: Sex | null; // null = both
  min_weight_kg: number;
  max_weight_kg: number;
  /** Lower priority value = preferred when overlapping. */
  priority: number;
}
