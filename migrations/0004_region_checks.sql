-- One row per region per monitor per check run. `checks` keeps the combined
-- result (failing only when most regions fail); this keeps each region's view
-- for the per-region latency chart and status. Kept for 7 days.
CREATE TABLE region_checks (
  monitor_id  INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL, -- same as the run's row in `checks`
  region      TEXT    NOT NULL, -- Durable Object location hint, e.g. 'weur'
  colo        TEXT,             -- datacenter it actually ran from, e.g. 'FRA'
  ok          INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms  INTEGER,
  error       TEXT
);
CREATE INDEX idx_region_checks_monitor_time ON region_checks(monitor_id, checked_at);
CREATE INDEX idx_region_checks_time ON region_checks(checked_at);
