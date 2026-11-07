import type { MonitorRow } from "./env";

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
