// Types shared by the Worker API and the React status page.

export type MonitorStatus = "up" | "down" | "unknown";

export interface DailyBucket {
  /** UTC day, YYYY-MM-DD */
  day: string;
  total: number;
  ok: number;
  avgLatencyMs: number | null;
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

export interface LatencyResponse {
  monitorId: number;
  hours: number;
  points: LatencyPoint[];
}
