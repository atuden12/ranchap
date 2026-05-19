export interface ApiStatus {
  ok: boolean;
  db_path: string;
  counts: {
    properties: number;
    paddocks: number;
    mobs: number;
    animals: number;
    transactions: number;
    weight_observations: number;
  };
}

/** Wrap fetch with credentials:include so session cookies are sent. */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${url} ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  auth_enabled: boolean;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/me');
}

export async function login(username: string, password: string): Promise<{ ok: true; username: string }> {
  return api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' });
}

export async function fetchStatus(): Promise<ApiStatus> {
  return api<ApiStatus>('/api/status');
}

export type MonthKey = string; // "YYYY-MM"

export interface FlowGridData {
  months: MonthKey[];
  current_month: MonthKey | null;
  rows: {
    opening_actual: Record<MonthKey, number | null>;
    opening_budget: Record<MonthKey, number | null>;
    inflow_actual: Record<MonthKey, number | null>;
    inflow_forecast: Record<MonthKey, number | null>;
    inflow_predicted: Record<MonthKey, number | null>;
    exits_actual: Record<MonthKey, number | null>;
    exits_forecast: Record<MonthKey, number | null>;
    exits_predicted: Record<MonthKey, number | null>;
    closing_actual: Record<MonthKey, number | null>;
    closing_budget: Record<MonthKey, number | null>;
    sundown_capacity: Record<MonthKey, number | null>;
    warabah_capacity: Record<MonthKey, number | null>;
    nutrition_increase: Record<MonthKey, number | null>;
    total_capacity: Record<MonthKey, number | null>;
    rainfall_adjusted_capacity: Record<MonthKey, number | null>;
    capacity_variance: Record<MonthKey, number | null>;
    historical_rainfall: Record<MonthKey, number | null>;
    actual_rainfall: Record<MonthKey, number | null>;
    pct_of_avg: Record<MonthKey, number | null>;
    rolling_3mo_pct: Record<MonthKey, number | null>;
  };
}

export async function fetchFlowGrid(): Promise<FlowGridData> {
  return api<FlowGridData>('/api/flow/grid');
}

/**
 * Upload an xlsx for import. Returns the parsed importer summary.
 * On error, surfaces the full server-side stderr + stdout tails so the
 * underlying cause is visible in the UI.
 */
export async function uploadImportXlsx(
  file: File,
): Promise<{ ok: boolean; summary: Record<string, unknown> | null; stdout_tail?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/admin/import-xlsx', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      exit_code?: number;
      stderr?: string;
      stdout?: string;
    };
    const detail = [
      body.error ?? `upload failed (${res.status})`,
      body.exit_code != null ? `exit_code=${body.exit_code}` : null,
      body.stderr ? `\n--- stderr (tail) ---\n${body.stderr}` : null,
      body.stdout ? `\n--- stdout (tail) ---\n${body.stdout}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(detail);
  }
  return (await res.json()) as { ok: boolean; summary: Record<string, unknown> | null; stdout_tail?: string };
}

export interface CellTransaction {
  id: number;
  txn_number: string | null;
  date: string;
  type: 'IN' | 'OUT';
  source: 'Actual' | 'Forecast' | 'Predicted';
  owner: string | null;
  contract: string | null;
  herd: string | null;
  livestock_class: string | null;
  head_count: number;
  description: string | null;
  origin_destination: string | null;
  sale_purchase_type: string | null;
  notes: string | null;
}

export interface CellDetailTransactions {
  row: string;
  month: MonthKey;
  kind: 'transactions';
  total: number;
  transactions: CellTransaction[];
}

export interface CellDetailCapacity {
  row: string;
  month: MonthKey;
  kind: 'capacity';
  property: string;
  capacity: {
    base_capacity: number;
    nutrition_increase: number;
    property_name: string;
  } | null;
}

export interface CellDetailRainfall {
  row: string;
  month: MonthKey;
  kind: 'rainfall';
  rainfall: { mm_actual: number | null; mm_historical_avg: number | null } | null;
}

export interface CellDetailOpening {
  row: string;
  month: MonthKey;
  kind: 'opening';
  source: 'Actual' | 'Budget';
  opening: { head_count: number } | null;
}

export interface CellDetailDerived {
  row: string;
  month: MonthKey;
  kind: 'derived';
  description: string;
}

export type CellDetail =
  | CellDetailTransactions
  | CellDetailCapacity
  | CellDetailRainfall
  | CellDetailOpening
  | CellDetailDerived;

export async function fetchCellDetail(row: string, month: MonthKey): Promise<CellDetail> {
  const url = `/api/flow/cell?row=${encodeURIComponent(row)}&month=${encodeURIComponent(month)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`flow/cell ${res.status}`);
  return (await res.json()) as CellDetail;
}

export interface CapacityPatch {
  property: 'Sundown' | 'Warabah';
  year: number;
  month: number;
  base_capacity?: number;
  nutrition_increase?: number;
}

export async function patchCapacity(p: CapacityPatch): Promise<void> {
  const res = await fetch('/api/flow/capacity', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`patch capacity ${res.status}`);
}

export interface RainfallPatch {
  year: number;
  month: number;
  mm_actual?: number | null;
  mm_historical_avg?: number | null;
}

export async function patchRainfall(p: RainfallPatch): Promise<void> {
  const res = await fetch('/api/flow/rainfall', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`patch rainfall ${res.status}`);
}

export interface PredictionPost {
  date: string; // YYYY-MM-DD
  type: 'IN' | 'OUT';
  head_count: number;
  livestock_class?: string;
  description?: string;
  owner?: string;
  herd?: string;
  origin_destination?: string;
  notes?: string;
}

export async function createPrediction(p: PredictionPost): Promise<{ id: number }> {
  const res = await fetch('/api/flow/prediction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`create prediction ${res.status}`);
  return (await res.json()) as { id: number };
}

export async function deletePrediction(id: number): Promise<void> {
  const res = await fetch(`/api/flow/prediction/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete prediction ${res.status}`);
}

export interface DestockSuggestion {
  mob_id: number | null;
  mob_name: string | null;
  paddock_name: string | null;
  breed_type: string | null;
  market_class: string | null;
  head_count: number;
  cumulative_head: number;
  median_exit_date: string;
  band: string;
}

export interface ForecastHelperResult {
  target: MonthKey;
  projected_closing: number | null;
  rainfall_adjusted_capacity: number | null;
  capacity_variance: number | null;
  total_capacity: number | null;
  sundown_cap: number | null;
  warabah_cap: number | null;
  nutrition: number;
  rolling_pct: number | null;
  recommendation: {
    action: 'destock' | 'acquire' | 'on_track';
    head_count: number;
    headline: string;
    detail: string;
  } | null;
  destock_suggestions: DestockSuggestion[] | null;
}

export async function fetchForecastHelper(target: MonthKey): Promise<ForecastHelperResult> {
  const res = await fetch(`/api/flow/helper?target=${encodeURIComponent(target)}`);
  if (!res.ok) throw new Error(`helper ${res.status}`);
  return (await res.json()) as ForecastHelperResult;
}

export interface StockOnHandRow {
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
  days_since_last_weigh: number | null;
  adg: number | null;
  estimated_weight: number | null;
  pred_min_weight: number | null;
  pred_max_weight: number | null;
  target_exit_weight: number | null;
  days_to_exit: number | null;
}

export async function fetchStockOnHand(): Promise<{ rows: StockOnHandRow[] }> {
  const res = await fetch('/api/stock-on-hand');
  if (!res.ok) throw new Error(`stock-on-hand ${res.status}`);
  return (await res.json()) as { rows: StockOnHandRow[] };
}

export interface MarketBand {
  id: number;
  name: string;
  sex: 'M' | 'F' | null;
  min_weight_kg: number;
  max_weight_kg: number;
  priority: number;
}

export interface AnimalForecast {
  id: number;
  eid: string | null;
  visual_id: string | null;
  sex: 'M' | 'F' | null;
  livestock_class: string | null;
  mob_id: number | null;
  mob_name: string | null;
  breed_type: string | null;
  market_class: string | null;
  paddock_name: string | null;
  property_name: string | null;
  last_weight: number;
  last_weight_date: string;
  adg: number;
  target_exit_weight: number | null;
  exit_market_category: string | null;
  projections: number[];
  band_hits: Array<string | null>;
  predicted_band: string | null;
  predicted_exit_date: string | null;
  predicted_final_weight: number | null;
}

export interface ForecastedWeightsResponse {
  bands: MarketBand[];
  date_columns: string[];
  today: string;
  animals: AnimalForecast[];
}

export async function fetchForecastedWeights(): Promise<ForecastedWeightsResponse> {
  const res = await fetch('/api/forecasted-weights');
  if (!res.ok) throw new Error(`forecasted-weights ${res.status}`);
  return (await res.json()) as ForecastedWeightsResponse;
}

export async function fetchBands(): Promise<{ bands: MarketBand[] }> {
  const res = await fetch('/api/forecasted-weights/bands');
  if (!res.ok) throw new Error(`bands ${res.status}`);
  return (await res.json()) as { bands: MarketBand[] };
}

export async function createBand(b: Omit<MarketBand, 'id'>): Promise<{ id: number }> {
  const res = await fetch('/api/forecasted-weights/bands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  if (!res.ok) throw new Error(`create band ${res.status}`);
  return (await res.json()) as { id: number };
}

export async function updateBand(id: number, patch: Partial<MarketBand>): Promise<void> {
  const res = await fetch(`/api/forecasted-weights/bands/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update band ${res.status}`);
}

export async function deleteBand(id: number): Promise<void> {
  const res = await fetch(`/api/forecasted-weights/bands/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete band ${res.status}`);
}

export interface TransactionRow {
  id: number;
  txn_number: string | null;
  date: string;
  type: 'IN' | 'OUT';
  source: 'Actual' | 'Forecast' | 'Predicted';
  owner: string | null;
  contract: string | null;
  herd: string | null;
  livestock_class: string | null;
  head_count: number;
  description: string | null;
  origin_destination: string | null;
  sale_purchase_type: string | null;
  notes: string | null;
}

export interface TransactionListParams {
  from?: string;
  to?: string;
  type?: 'IN' | 'OUT';
  source?: 'Actual' | 'Forecast' | 'Predicted';
  class?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionListResponse {
  total: number;
  limit: number;
  offset: number;
  rows: TransactionRow[];
}

export async function listTransactions(p: TransactionListParams = {}): Promise<TransactionListResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') params.set(k, String(v));
  }
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) throw new Error(`list transactions ${res.status}`);
  return (await res.json()) as TransactionListResponse;
}

export interface TransactionPost {
  date: string;
  type: 'IN' | 'OUT';
  head_count: number;
  livestock_class?: string;
  description?: string;
  owner?: string;
  contract?: string;
  herd?: string;
  origin_destination?: string;
  sale_purchase_type?: string;
  notes?: string;
  txn_number?: string;
}

export async function createTransaction(t: TransactionPost): Promise<{ id: number }> {
  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(t),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `create transaction ${res.status}`);
  }
  return (await res.json()) as { id: number };
}

export async function updateTransaction(id: number, patch: Partial<TransactionPost>): Promise<void> {
  const res = await fetch(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `update transaction ${res.status}`);
  }
}

export async function deleteTransaction(id: number): Promise<void> {
  const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `delete transaction ${res.status}`);
  }
}

export interface AdgMatrixCell {
  livestock_class: string;
  month: number;
  adg: number;
}

export async function fetchAdgMatrix(): Promise<{ rows: AdgMatrixCell[] }> {
  const res = await fetch('/api/forecasted-weights/adg-matrix');
  if (!res.ok) throw new Error(`adg-matrix ${res.status}`);
  return (await res.json()) as { rows: AdgMatrixCell[] };
}

export async function updateAdgMatrix(cell: AdgMatrixCell): Promise<void> {
  const res = await fetch('/api/forecasted-weights/adg-matrix', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cell),
  });
  if (!res.ok) throw new Error(`update adg ${res.status}`);
}

export interface FeedType {
  id: number;
  name: string;
  unit: string;
  default_cost_per_unit: number | null;
  notes: string | null;
}

export interface FeedEvent {
  id: number;
  date: string;
  feed_type_id: number;
  feed_type_name: string;
  mob_id: number | null;
  mob_name: string | null;
  paddock_id: number | null;
  paddock_name: string | null;
  cattle_group: string | null;
  head_count: number | null;
  kg_per_head_per_day: number | null;
  duration_days: number;
  total_kg: number;
  cost_per_unit: number | null;
  total_cost: number | null;
  notes: string | null;
}

export async function fetchFeedTypes(): Promise<{ rows: FeedType[] }> {
  const res = await fetch('/api/feeding/types');
  if (!res.ok) throw new Error(`feed types ${res.status}`);
  return (await res.json()) as { rows: FeedType[] };
}

export interface FeedingListParams {
  from?: string;
  to?: string;
  feed_type_id?: number;
  mob_id?: number;
  limit?: number;
  offset?: number;
}

export interface FeedingListResponse {
  total: number;
  limit: number;
  offset: number;
  rows: FeedEvent[];
}

export async function listFeedEvents(p: FeedingListParams = {}): Promise<FeedingListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const res = await fetch(`/api/feeding?${qs}`);
  if (!res.ok) throw new Error(`feeding list ${res.status}`);
  return (await res.json()) as FeedingListResponse;
}

export interface FeedEventPost {
  date: string;
  feed_type_id: number;
  mob_id?: number | null;
  paddock_id?: number | null;
  cattle_group?: string | null;
  head_count?: number | null;
  kg_per_head_per_day?: number | null;
  duration_days?: number;
  total_kg?: number;
  cost_per_unit?: number | null;
  notes?: string | null;
}

export async function createFeedEvent(e: FeedEventPost): Promise<{ id: number }> {
  const res = await fetch('/api/feeding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `create feed event ${res.status}`);
  }
  return (await res.json()) as { id: number };
}

export async function updateFeedEvent(
  id: number,
  patch: Partial<FeedEventPost>,
): Promise<void> {
  const res = await fetch(`/api/feeding/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update feed event ${res.status}`);
}

export async function deleteFeedEvent(id: number): Promise<void> {
  const res = await fetch(`/api/feeding/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete feed event ${res.status}`);
}

export interface FeedSummaryRow {
  date: string;
  feed_type_id: number;
  feed_type_name: string;
  total_kg: number;
  total_cost: number;
}

export async function fetchFeedSummary(
  from?: string,
  to?: string,
): Promise<{ rows: FeedSummaryRow[] }> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const res = await fetch(`/api/feeding/summary?${qs}`);
  if (!res.ok) throw new Error(`feed summary ${res.status}`);
  return (await res.json()) as { rows: FeedSummaryRow[] };
}

export interface BudgetSummary {
  kpis: {
    total_cost: number;
    total_freight: number;
    total_head: number;
    n_transactions: number;
  };
  monthly: Array<{
    month: string;
    category: string | null;
    total_cost: number;
    total_freight: number;
    total_head: number;
    n: number;
  }>;
  by_counterparty: Array<{
    counterparty: string;
    total_cost: number;
    total_head: number;
    n: number;
  }>;
  by_class: Array<{
    livestock_class: string;
    total_cost: number;
    total_head: number;
    avg_price_per_kg: number | null;
    avg_weight_kg: number | null;
    n: number;
  }>;
}

export async function fetchBudgetSummary(
  from?: string,
  to?: string,
  txType?: 'IN' | 'OUT',
): Promise<BudgetSummary> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (txType) qs.set('type', txType);
  const res = await fetch(`/api/budget/summary?${qs}`);
  if (!res.ok) throw new Error(`budget summary ${res.status}`);
  return (await res.json()) as BudgetSummary;
}
