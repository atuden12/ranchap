-- 0004_feeding.sql
--
-- Feed tracking. Two tables:
--   feed_type   — reference list (Hay, Silage, Pellets, Grain, …)
--   feed_event  — transactional log of feed deliveries / feedings
--
-- The Stock_Flow_MASTER `Feeding` sheet is a planning calculator, not a log.
-- The importer reads it once and creates seed events with today's date so the
-- current feeding state is visible. Going forward, events are added via the UI.

CREATE TABLE feed_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'kg',
  default_cost_per_unit REAL,
  notes TEXT
);

CREATE TABLE feed_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                          -- ISO YYYY-MM-DD
  feed_type_id INTEGER NOT NULL REFERENCES feed_type(id),
  mob_id INTEGER REFERENCES mob(id) ON DELETE SET NULL,
  paddock_id INTEGER REFERENCES paddock(id) ON DELETE SET NULL,
  cattle_group TEXT,                           -- free text when mob is null
  head_count INTEGER,
  kg_per_head_per_day REAL,
  duration_days INTEGER NOT NULL DEFAULT 1,
  total_kg REAL NOT NULL,
  cost_per_unit REAL,                          -- $/kg
  total_cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feed_event_date ON feed_event(date);
CREATE INDEX idx_feed_event_mob ON feed_event(mob_id);
CREATE INDEX idx_feed_event_feed_type ON feed_event(feed_type_id);
