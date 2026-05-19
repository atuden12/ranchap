-- 0002_drop_txn_partial_unique.sql
--
-- The partial unique index on (txn_number, livestock_class, type, source)
-- assumed each (txn, class) combination represented one event. The actual
-- Stock_Flow_MASTER data legitimately has multiple rows per (txn, class)
-- — e.g. CS8218 / EUHQB / Male Weaner with both -37 and -158 head on the
-- same date. Importer now uses wipe-and-replace for Actual + Forecast.
DROP INDEX IF EXISTS uq_transaction_dedupe;
