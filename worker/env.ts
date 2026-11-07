export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_TITLE: string;
  FAILURE_THRESHOLD: string;
  RETENTION_DAYS: string;
}

/** Row shape of the `monitors` table. */
export interface MonitorRow {
  id: number;
  name: string;
  url: string;
  method: string;
  timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
  paused: number;
  status: "up" | "down" | "unknown";
  consecutive_failures: number;
  last_checked_at: number | null;
  created_at: number;
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
