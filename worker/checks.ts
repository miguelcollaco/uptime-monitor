import type { Env, MonitorRow } from "./env";
import { intVar } from "./env";
import { sendAlert } from "./alerts";
import { utcDay } from "./summary";
import { LOCKOUT_MS } from "./auth";
import { checkFromRegions, combineRegions, type RegionResult } from "./regions";

/** How long per-region results are kept (the latency chart shows up to 7 days). */
const REGION_HISTORY_DAYS = 7;

export interface CheckResult {
  monitorId: number;
  checkedAt: number;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

const USER_AGENT = "uptime-monitor/0.1 (Cloudflare Worker)";

/** Perform one HTTP check. Never throws: failures are returned as results. */
export async function checkMonitor(m: MonitorRow): Promise<CheckResult> {
  const checkedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), m.timeout_ms);
  try {
    const res = await fetch(m.url, {
      method: m.method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
      cache: "no-store",
    });
    // Latency = time until response headers arrive.
    const latencyMs = Date.now() - checkedAt;
    // We don't need the body; release the connection.
    await res.body?.cancel();
    const ok = res.status >= m.expected_status_min && res.status <= m.expected_status_max;
    return {
      monitorId: m.id,
      checkedAt,
      ok,
      statusCode: res.status,
      latencyMs,
      error: ok ? null : `Unexpected status ${res.status}`,
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return {
      monitorId: m.id,
      checkedAt,
      ok: false,
      statusCode: null,
      latencyMs: null,
      error: aborted ? `Timed out after ${m.timeout_ms} ms` : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 300);
}

/**
 * Check every active monitor from every region, store the results, update each
 * monitor's state, open/close incidents and send alerts on state changes.
 */
export async function runAllChecks(env: Env, now = Date.now()): Promise<CheckResult[]> {
  const threshold = intVar(env.FAILURE_THRESHOLD, 2);
  const { results: monitors } = await env.DB.prepare(
    "SELECT * FROM monitors WHERE paused = 0",
  ).all<MonitorRow>();

  if (monitors.length === 0) return [];

  // All rows from this run share one timestamp, so per-region rows line up
  // with the combined row in `checks`.
  const runAt = Date.now();
  let runs = await checkFromRegions(env, monitors);
  if (runs.length === 0) {
    // No region answered (e.g. a Durable Object outage): check from the Worker
    // itself so monitoring doesn't stop.
    console.error("No region returned results; checking from the Worker instead");
    runs = [{ region: "worker", colo: null, results: await Promise.all(monitors.map(checkMonitor)) }];
  }

  const statements: D1PreparedStatement[] = [];
  const alerts: string[] = [];
  const results: CheckResult[] = [];

  for (let i = 0; i < monitors.length; i++) {
    const m = monitors[i];
    const perRegion: RegionResult[] = runs.map((run) => ({
      ...run.results[i],
      region: run.region,
      colo: run.colo,
    }));
    const r = combineRegions(m.id, runAt, perRegion);
    results.push(r);

    for (const rr of perRegion) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO region_checks (monitor_id, checked_at, region, colo, ok, status_code, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(m.id, runAt, rr.region, rr.colo, rr.ok ? 1 : 0, rr.statusCode, rr.latencyMs, rr.error),
      );
    }

    statements.push(
      env.DB.prepare(
        "INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(m.id, r.checkedAt, r.ok ? 1 : 0, r.statusCode, r.latencyMs, r.error),
      // Keep the per-day totals the status page reads in step with the raw checks.
      env.DB.prepare(
        `INSERT INTO daily_stats (monitor_id, day, total, ok, latency_sum, latency_count)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT (monitor_id, day) DO UPDATE SET
           total = total + 1,
           ok = ok + excluded.ok,
           latency_sum = latency_sum + excluded.latency_sum,
           latency_count = latency_count + excluded.latency_count`,
      ).bind(
        m.id,
        utcDay(r.checkedAt),
        r.ok ? 1 : 0,
        r.latencyMs ?? 0,
        r.latencyMs === null ? 0 : 1,
      ),
    );

    let status = m.status;
    let failures = m.consecutive_failures;

    if (r.ok) {
      failures = 0;
      if (m.status === "down") {
        status = "up";
        statements.push(
          env.DB.prepare(
            "UPDATE incidents SET resolved_at = ? WHERE monitor_id = ? AND resolved_at IS NULL",
          ).bind(r.checkedAt, m.id),
        );
        alerts.push(`✅ **${m.name}** is back up (${r.statusCode}, median ${r.latencyMs} ms).`);
      } else if (m.status === "unknown") {
        status = "up";
      }
    } else {
      failures += 1;
      if (failures >= threshold && m.status !== "down") {
        // r.error already lists each failing region, e.g.
        // "Down in 2/3 regions: Europe: Timed out after 10000 ms; US East: Unexpected status 503"
        status = "down";
        statements.push(
          env.DB.prepare(
            "INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, ?)",
          ).bind(m.id, r.checkedAt, r.error),
        );
        alerts.push(`🔴 **${m.name}** is down: ${r.error} (${m.url})`);
      }
    }

    statements.push(
      env.DB.prepare(
        "UPDATE monitors SET status = ?, consecutive_failures = ?, last_checked_at = ? WHERE id = ?",
      ).bind(status, failures, r.checkedAt, m.id),
    );
  }

  await env.DB.batch(statements);

  for (const text of alerts) {
    await sendAlert(env, text);
  }

  // Once a day (the run that lands in 03:00–03:04 UTC), drop old check rows.
  const d = new Date(now);
  if (d.getUTCHours() === 3 && d.getUTCMinutes() < 5) {
    const cutoff = now - intVar(env.RETENTION_DAYS, 90) * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM checks WHERE checked_at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM daily_stats WHERE day < ?").bind(utcDay(cutoff)),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - LOCKOUT_MS),
      env.DB.prepare("DELETE FROM region_checks WHERE checked_at < ?").bind(
        now - REGION_HISTORY_DAYS * 24 * 60 * 60 * 1000,
      ),
    ]);
  }

  return results;
}
