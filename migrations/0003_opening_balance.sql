-- 0003_opening_balance.sql
--
-- "On Farm Opening" head counts from the Flow sheet — physical-inventory
-- checkpoints used to anchor the running closing computation. The grid uses
-- these as seeds; months without an explicit opening roll forward from the
-- prior month's closing.

CREATE TABLE opening_balance (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,        -- 1..12
  source TEXT NOT NULL,          -- 'Actual' | 'Budget'
  head_count INTEGER NOT NULL,
  PRIMARY KEY (year, month, source),
  CHECK (month BETWEEN 1 AND 12),
  CHECK (source IN ('Actual', 'Budget'))
);
