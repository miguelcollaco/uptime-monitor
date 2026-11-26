-- Per-monitor, per-UTC-day totals, updated by every cron run.
-- The status page reads about 90 rows per monitor from here instead of
-- scanning every check in the history window, which kept D1 reads far
-- above the free plan's daily limit once history filled up.
CREATE TABLE daily_stats (
  monitor_id    INTEGER NOT NULL,
  day           TEXT    NOT NULL, -- UTC, YYYY-MM-DD
  total         INTEGER NOT NULL,
  ok            INTEGER NOT NULL,
  -- Sum and count of non-null latencies, so the average skips failed checks.
  latency_sum   INTEGER NOT NULL,
  latency_count INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, day)
) WITHOUT ROWID;
CREATE INDEX idx_daily_stats_day ON daily_stats(day);

-- Backfill from the checks recorded so far.
INSERT INTO daily_stats (monitor_id, day, total, ok, latency_sum, latency_count)
SELECT monitor_id,
       strftime('%Y-%m-%d', checked_at / 1000, 'unixepoch'),
       COUNT(*),
       SUM(ok),
       COALESCE(SUM(latency_ms), 0),
       COUNT(latency_ms)
  FROM checks
 GROUP BY 1, 2;
