import type { LiveStatus } from "./live";

export interface Env {
  DB: D1Database;
  /** Durable Object that pushes live updates to open status pages */
  LIVE: DurableObjectNamespace<LiveStatus>;
  ASSETS: Fetcher;
  SITE_TITLE: string;
  FAILURE_THRESHOLD: string;
  RETENTION_DAYS: string;
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
