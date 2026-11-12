import type { Env, MonitorRow } from "./env";
import { intVar } from "./env";
import { sendAlert } from "./alerts";

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
 * Check every active monitor, store the results, update each monitor's state,
 * open/close incidents and send alerts on state changes.
 */
export async function runAllChecks(env: Env): Promise<CheckResult[]> {
  const threshold = intVar(env.FAILURE_THRESHOLD, 2);
  const { results: monitors } = await env.DB.prepare(
    "SELECT * FROM monitors WHERE paused = 0",
  ).all<MonitorRow>();

  if (monitors.length === 0) return [];

  const results = await Promise.all(monitors.map(checkMonitor));

  const statements: D1PreparedStatement[] = [];
  const alerts: string[] = [];

  for (let i = 0; i < monitors.length; i++) {
    const m = monitors[i];
    const r = results[i];

    statements.push(
      env.DB.prepare(
        "INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(m.id, r.checkedAt, r.ok ? 1 : 0, r.statusCode, r.latencyMs, r.error),
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
        alerts.push(`✅ **${m.name}** is back up (${r.statusCode}, ${r.latencyMs} ms).`);
      } else if (m.status === "unknown") {
        status = "up";
      }
    } else {
      failures += 1;
      if (failures >= threshold && m.status !== "down") {
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

  return results;
}
