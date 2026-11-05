-- Monitors: what to check, plus the current state used for alerting.
CREATE TABLE monitors (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  url                  TEXT    NOT NULL,
  method               TEXT    NOT NULL DEFAULT 'GET',
  timeout_ms           INTEGER NOT NULL DEFAULT 10000,
  expected_status_min  INTEGER NOT NULL DEFAULT 200,
  expected_status_max  INTEGER NOT NULL DEFAULT 399,
  paused               INTEGER NOT NULL DEFAULT 0,
  -- 'unknown' until the first check, then 'up' or 'down'
  status               TEXT    NOT NULL DEFAULT 'unknown',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at      INTEGER,
  created_at           INTEGER NOT NULL
);

-- One row per check. Timestamps are Unix milliseconds.
CREATE TABLE checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at  INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms  INTEGER,
  error       TEXT,
  colo        TEXT
);
CREATE INDEX idx_checks_monitor_time ON checks(monitor_id, checked_at);
CREATE INDEX idx_checks_time ON checks(checked_at);

-- Outages: opened when a monitor goes down, closed when it recovers.
CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  cause       TEXT
);
CREATE INDEX idx_incidents_monitor ON incidents(monitor_id, started_at);
