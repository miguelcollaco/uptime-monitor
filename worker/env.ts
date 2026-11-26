import type { LiveStatus } from "./live";
import type { RegionChecker } from "./regions";

export interface Env {
  DB: D1Database;
  /** Durable Object that pushes live updates to open status pages */
  LIVE: DurableObjectNamespace<LiveStatus>;
  /** One checker per region, placed with a location hint */
  CHECKER: DurableObjectNamespace<RegionChecker>;
  ASSETS: Fetcher;
  SITE_TITLE: string;
  FAILURE_THRESHOLD: string;
  RETENTION_DAYS: string;
  /** Comma-separated location hints to check from, e.g. "weur,enam,apac" */
  REGIONS: string;
  /** Discord or Slack incoming webhook URL (secret, optional) */
  ALERT_WEBHOOK_URL?: string;
  /** Bearer token for /api/admin/* (secret, optional: admin API is disabled without it) */
  ADMIN_TOKEN?: string;
}

/** Row shape of the `monitors` table, shared with the admin page. */
export type { MonitorRow } from "../shared/types";

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
