// Types shared by the Worker API and the React status page.

export type MonitorStatus = "up" | "down" | "unknown";

/** A row of the `monitors` table, as returned by the admin API. */
export interface MonitorRow {
  id: number;
  name: string;
  url: string;
  method: string;
  timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
  /** 1 or 0 (SQLite has no boolean) */
  paused: number;
  status: MonitorStatus;
  consecutive_failures: number;
  last_checked_at: number | null;
  created_at: number;
}

export interface DailyBucket {
  /** UTC day, YYYY-MM-DD */
  day: string;
  total: number;
  ok: number;
  avgLatencyMs: number | null;
}

/** One region's result from the latest check run. */
export interface RegionStatus {
  /** Durable Object location hint, e.g. "weur" */
  region: string;
  /** Display name, e.g. "Europe" */
  name: string;
  /** Datacenter the check ran from, e.g. "FRA", if known */
  colo: string | null;
  ok: boolean;
  latencyMs: number | null;
}

export interface PublicMonitor {
  id: number;
  name: string;
  status: MonitorStatus;
  paused: boolean;
  lastCheckedAt: number | null;
  /** Uptime over the last 24h as a fraction 0..1, or null with no data */
  uptime24h: number | null;
  /** Uptime over the whole history window as a fraction 0..1, or null with no data */
  uptimeWindow: number | null;
  avgLatency24hMs: number | null;
  daily: DailyBucket[];
  /** Each region's view in the latest run, in the configured region order */
  regions: RegionStatus[];
}

export interface Incident {
  id: number;
  monitorId: number;
  monitorName: string;
  startedAt: number;
  resolvedAt: number | null;
  cause: string | null;
}

export interface SummaryResponse {
  title: string;
  generatedAt: number;
  windowDays: number;
  monitors: PublicMonitor[];
  incidents: Incident[];
}

export interface LatencyPoint {
  t: number;
  latencyMs: number | null;
  ok: boolean;
}

export interface RegionSeries {
  region: string;
  name: string;
  /** Datacenter of the most recent check from this region, if known */
  colo: string | null;
  points: LatencyPoint[];
}

export interface LatencyResponse {
  monitorId: number;
  hours: number;
  /** Combined result per run: latency is the median of the regions that succeeded */
  points: LatencyPoint[];
  /** Each region's own checks, in the configured region order */
  regions: RegionSeries[];
}
