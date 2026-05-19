-- 0005_transaction_costs.sql
--
-- Cost tracking for transactions. Populated from IN EX purch Budget dump and
-- IN Int Transfer Budget dump on import. Manual transactions can also carry
-- cost data via the UI. OUT-side revenue is out of scope for this iteration.

ALTER TABLE transaction_event ADD COLUMN avg_weight_kg REAL;
ALTER TABLE transaction_event ADD COLUMN price_per_kg REAL;
ALTER TABLE transaction_event ADD COLUMN freight REAL;
ALTER TABLE transaction_event ADD COLUMN total_cost REAL;
