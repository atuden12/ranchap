-- 0001_init.sql
-- Initial RanchApp schema. SQLite-flavoured but written to translate cleanly to Postgres
-- (no SQLite-only types beyond INTEGER PRIMARY KEY; JSON stored as TEXT).

PRAGMA foreign_keys = ON;

CREATE TABLE property (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  -- 12-element JSON array of head counts, index 0 = January.
  default_monthly_capacity TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paddock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normal_capacity_head INTEGER,
  current_status TEXT,
  UNIQUE (property_id, name)
);

CREATE TABLE mob (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  breed_type TEXT,        -- FB | F1 | PB
  market_class TEXT,      -- e.g. EU, Non-EU, EUHQB, Feeder
  owner TEXT,
  paddock_id INTEGER REFERENCES paddock(id) ON DELETE SET NULL,
  CHECK (breed_type IS NULL OR breed_type IN ('FB','F1','PB'))
);

CREATE TABLE animal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visual_id TEXT,
  eid TEXT UNIQUE,
  sex TEXT,               -- M | F
  mob_id INTEGER REFERENCES mob(id) ON DELETE SET NULL,
  owner TEXT,
  livestock_class TEXT,
  current_weight REAL,
  last_weight_date TEXT,  -- ISO YYYY-MM-DD
  adg REAL,               -- per-animal ADG override (kg/day)
  target_exit_weight REAL,
  exit_market_category TEXT,
  CHECK (sex IS NULL OR sex IN ('M','F'))
);

CREATE INDEX idx_animal_mob ON animal(mob_id);
CREATE INDEX idx_animal_class ON animal(livestock_class);

CREATE TABLE weight_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id INTEGER NOT NULL REFERENCES animal(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  UNIQUE (animal_id, date)
);

CREATE INDEX idx_weight_obs_animal_date ON weight_observation(animal_id, date);

CREATE TABLE transaction_event (
  -- "transaction" is reserved in some SQL dialects; using transaction_event for portability.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_number TEXT,
  date TEXT NOT NULL,            -- ISO YYYY-MM-DD
  type TEXT NOT NULL,            -- IN | OUT
  owner TEXT,
  contract TEXT,
  herd TEXT,
  livestock_class TEXT,
  head_count INTEGER NOT NULL,
  description TEXT,
  origin_destination TEXT,
  sale_purchase_type TEXT,
  notes TEXT,
  source TEXT NOT NULL,          -- Actual | Forecast | Predicted
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (type IN ('IN','OUT')),
  CHECK (source IN ('Actual','Forecast','Predicted'))
);

-- Idempotency key for the importer: same txn_number + livestock_class collapses to one row.
CREATE UNIQUE INDEX uq_transaction_dedupe
  ON transaction_event(txn_number, livestock_class, type, source)
  WHERE txn_number IS NOT NULL;

CREATE INDEX idx_txn_date ON transaction_event(date);
CREATE INDEX idx_txn_type_source ON transaction_event(type, source);

CREATE TABLE monthly_rainfall (
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,        -- 1..12
  mm_actual REAL,
  mm_historical_avg REAL,
  PRIMARY KEY (property_id, year, month),
  CHECK (month BETWEEN 1 AND 12)
);

CREATE TABLE capacity_override (
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,        -- 1..12
  base_capacity INTEGER NOT NULL,
  nutrition_increase INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, year, month),
  CHECK (month BETWEEN 1 AND 12)
);

CREATE TABLE adg_matrix (
  -- Editable per livestock_class per calendar month. Animal/mob ADG overrides this when present.
  livestock_class TEXT NOT NULL,
  month INTEGER NOT NULL,        -- 1..12
  adg REAL NOT NULL,
  PRIMARY KEY (livestock_class, month),
  CHECK (month BETWEEN 1 AND 12)
);

CREATE TABLE market_band (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sex TEXT,                      -- M | F | NULL (both)
  min_weight_kg REAL NOT NULL,
  max_weight_kg REAL NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  CHECK (sex IS NULL OR sex IN ('M','F')),
  CHECK (min_weight_kg < max_weight_kg)
);

-- Manual "Predictions (P)" rows from the Flow grid. Stored as Transaction rows
-- with source='Predicted'. Tracked here for fast lookup by month.
CREATE VIEW v_flow_month AS
SELECT
  substr(date, 1, 7) AS month_key,  -- "YYYY-MM"
  type,
  source,
  SUM(head_count) AS head_count
FROM transaction_event
GROUP BY substr(date, 1, 7), type, source;

CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1');

-- NOTE: `migration_history` is owned and bootstrapped by the migration runner
-- (apps/api/src/db/migrate.ts). Do not create it here.
