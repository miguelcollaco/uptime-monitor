import type { DailyBucket, Incident, PublicMonitor, SummaryResponse } from "../shared/types";
import type { Env, MonitorRow } from "./env";
import { intVar } from "./env";

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of the UTC day containing `ts`. */
export function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Build the public status summary from D1.
 *
 * Reads about (90 + 288) rows per monitor: one daily_stats row per day in the
 * window, plus the raw checks of the last 24 hours. The LiveStatus Durable
 * Object calls this once per cron run and serves the result to every viewer.
 */
export async function buildSummary(env: Env): Promise<SummaryResponse> {
  const now = Date.now();
  const windowDays = intVar(env.RETENTION_DAYS, 90);
  // The page shows one bar per day: today plus the (windowDays - 1) days before it.
  const firstDay = utcDay(now - (windowDays - 1) * DAY_MS);

  const [monitorsRes, dailyRes, recentRes, incidentsRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, name, status, paused, last_checked_at FROM monitors ORDER BY name COLLATE NOCASE",
    ),
    env.DB.prepare(
      `SELECT monitor_id, day, total, ok, latency_sum, latency_count
         FROM daily_stats
        WHERE day >= ?
        ORDER BY day`,
    ).bind(firstDay),
    env.DB.prepare(
      `SELECT monitor_id,
              COUNT(*) AS total,
              SUM(ok) AS ok,
              CAST(AVG(latency_ms) AS INTEGER) AS avg_latency
         FROM checks
        WHERE checked_at >= ?
        GROUP BY monitor_id`,
    ).bind(now - DAY_MS),
    env.DB.prepare(
      `SELECT i.id, i.monitor_id, m.name AS monitor_name, i.started_at, i.resolved_at, i.cause
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        ORDER BY i.started_at DESC
        LIMIT 20`,
    ),
  ]);

  type MonitorPick = Pick<MonitorRow, "id" | "name" | "status" | "paused" | "last_checked_at">;
  type DailyRow = {
    monitor_id: number;
    day: string;
    total: number;
    ok: number;
    latency_sum: number;
    latency_count: number;
  };
  type RecentRow = { monitor_id: number; total: number; ok: number; avg_latency: number | null };
  type IncidentRow = {
    id: number;
    monitor_id: number;
    monitor_name: string;
    started_at: number;
    resolved_at: number | null;
    cause: string | null;
  };

  const dailyByMonitor = new Map<number, DailyBucket[]>();
  for (const row of dailyRes.results as DailyRow[]) {
    const list = dailyByMonitor.get(row.monitor_id) ?? [];
    list.push({
      day: row.day,
      total: row.total,
      ok: row.ok,
      avgLatencyMs: row.latency_count > 0 ? Math.round(row.latency_sum / row.latency_count) : null,
    });
    dailyByMonitor.set(row.monitor_id, list);
  }

  const recentByMonitor = new Map<number, RecentRow>();
  for (const row of recentRes.results as RecentRow[]) recentByMonitor.set(row.monitor_id, row);

  const monitors: PublicMonitor[] = (monitorsRes.results as MonitorPick[]).map((m) => {
    const daily = dailyByMonitor.get(m.id) ?? [];
    const recent = recentByMonitor.get(m.id);
    const windowTotal = daily.reduce((s, d) => s + d.total, 0);
    const windowOk = daily.reduce((s, d) => s + d.ok, 0);
    return {
      id: m.id,
      name: m.name,
      status: m.status,
      paused: m.paused === 1,
      lastCheckedAt: m.last_checked_at,
      uptime24h: recent && recent.total > 0 ? recent.ok / recent.total : null,
      uptimeWindow: windowTotal > 0 ? windowOk / windowTotal : null,
      avgLatency24hMs: recent?.avg_latency ?? null,
      daily,
    };
  });

  const incidents: Incident[] = (incidentsRes.results as IncidentRow[]).map((i) => ({
    id: i.id,
    monitorId: i.monitor_id,
    monitorName: i.monitor_name,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    cause: i.cause,
  }));

  return {
    title: env.SITE_TITLE || "Status",
    generatedAt: now,
    windowDays,
    monitors,
    incidents,
  };
}
