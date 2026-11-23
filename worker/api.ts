import type {
  DailyBucket,
  Incident,
  LatencyResponse,
  PublicMonitor,
  SummaryResponse,
} from "../shared/types";
import type { Env, MonitorRow } from "./env";
import { intVar } from "./env";
import { runAllChecks } from "./checks";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path.startsWith("/api/admin/")) {
      return await handleAdmin(request, env, path.slice("/api/admin".length));
    }

    if (request.method !== "GET") return error(405, "Method not allowed");

    if (path === "/api/summary") {
      return json(await getSummary(env), {
        headers: { "cache-control": "public, max-age=30" },
      });
    }

    const latencyMatch = path.match(/^\/api\/monitors\/(\d+)\/latency$/);
    if (latencyMatch) {
      const hours = Math.min(intVar(url.searchParams.get("hours") ?? undefined, 24), 24 * 7);
      return json(await getLatency(env, Number(latencyMatch[1]), hours), {
        headers: { "cache-control": "public, max-age=30" },
      });
    }

    return error(404, "Not found");
  } catch (err) {
    console.error(err);
    return error(500, "Internal error");
  }
}

// ---------- Public API ----------

async function getSummary(env: Env): Promise<SummaryResponse> {
  const now = Date.now();
  const windowDays = intVar(env.RETENTION_DAYS, 90);
  const windowStart = now - windowDays * DAY_MS;

  const [monitorsRes, dailyRes, recentRes, incidentsRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, name, status, paused, last_checked_at FROM monitors ORDER BY name COLLATE NOCASE",
    ),
    env.DB.prepare(
      `SELECT monitor_id,
              strftime('%Y-%m-%d', checked_at / 1000, 'unixepoch') AS day,
              COUNT(*) AS total,
              SUM(ok) AS ok,
              CAST(AVG(latency_ms) AS INTEGER) AS avg_latency
         FROM checks
        WHERE checked_at >= ?
        GROUP BY monitor_id, day
        ORDER BY day`,
    ).bind(windowStart),
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
  type DailyRow = { monitor_id: number; day: string; total: number; ok: number; avg_latency: number | null };
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
    list.push({ day: row.day, total: row.total, ok: row.ok, avgLatencyMs: row.avg_latency });
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

async function getLatency(env: Env, monitorId: number, hours: number): Promise<LatencyResponse> {
  const since = Date.now() - hours * HOUR_MS;
  const { results } = await env.DB.prepare(
    `SELECT checked_at, latency_ms, ok FROM checks
      WHERE monitor_id = ? AND checked_at >= ?
      ORDER BY checked_at`,
  )
    .bind(monitorId, since)
    .all<{ checked_at: number; latency_ms: number | null; ok: number }>();

  return {
    monitorId,
    hours,
    points: results.map((r) => ({ t: r.checked_at, latencyMs: r.latency_ms, ok: r.ok === 1 })),
  };
}

// ---------- Admin API (Bearer ADMIN_TOKEN) ----------

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const enc = new TextEncoder();
  // Hash both sides so the comparison is constant-time and length-independent.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(token)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

interface MonitorInput {
  name?: unknown;
  url?: unknown;
  method?: unknown;
  timeout_ms?: unknown;
  expected_status_min?: unknown;
  expected_status_max?: unknown;
  paused?: unknown;
}

function validateUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

async function handleAdmin(request: Request, env: Env, sub: string): Promise<Response> {
  if (!env.ADMIN_TOKEN) return error(404, "Admin API disabled: set the ADMIN_TOKEN secret");
  if (!(await isAuthorized(request, env))) return error(401, "Unauthorized");

  // POST /api/admin/run  -> run all checks now
  if (sub === "/run" && request.method === "POST") {
    const results = await runAllChecks(env);
    return json({ ran: results.length, results });
  }

  // GET /api/admin/monitors  -> list with URLs
  if (sub === "/monitors" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM monitors ORDER BY id").all<MonitorRow>();
    return json(results);
  }

  // POST /api/admin/monitors  -> create
  if (sub === "/monitors" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as MonitorInput | null;
    if (!body) return error(400, "Expected a JSON body");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = validateUrl(body.url);
    if (!name) return error(400, "name is required");
    if (!url) return error(400, "url must be an http(s) URL");
    const method = body.method === "HEAD" ? "HEAD" : "GET";
    const timeout = clampInt(body.timeout_ms, 1000, 30000, 10000);
    const min = clampInt(body.expected_status_min, 100, 599, 200);
    const max = clampInt(body.expected_status_max, min, 599, 399);
    const row = await env.DB.prepare(
      `INSERT INTO monitors (name, url, method, timeout_ms, expected_status_min, expected_status_max, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(name, url, method, timeout, min, max, Date.now())
      .first<MonitorRow>();
    return json(row, { status: 201 });
  }

  const idMatch = sub.match(/^\/monitors\/(\d+)$/);
  if (idMatch) {
    const id = Number(idMatch[1]);

    // PATCH /api/admin/monitors/:id  -> update name/url/paused/...
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => null)) as MonitorInput | null;
      if (!body) return error(400, "Expected a JSON body");
      const sets: string[] = [];
      const values: unknown[] = [];
      if (typeof body.name === "string" && body.name.trim()) {
        sets.push("name = ?");
        values.push(body.name.trim());
      }
      if (body.url !== undefined) {
        const url = validateUrl(body.url);
        if (!url) return error(400, "url must be an http(s) URL");
        sets.push("url = ?");
        values.push(url);
      }
      if (typeof body.paused === "boolean") {
        sets.push("paused = ?");
        values.push(body.paused ? 1 : 0);
      }
      if (body.timeout_ms !== undefined) {
        sets.push("timeout_ms = ?");
        values.push(clampInt(body.timeout_ms, 1000, 30000, 10000));
      }
      if (sets.length === 0) return error(400, "Nothing to update");
      const row = await env.DB.prepare(
        `UPDATE monitors SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      )
        .bind(...values, id)
        .first<MonitorRow>();
      return row ? json(row) : error(404, "Monitor not found");
    }

    // DELETE /api/admin/monitors/:id
    if (request.method === "DELETE") {
      // D1 doesn't enforce foreign keys by default, so delete children explicitly.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM checks WHERE monitor_id = ?").bind(id),
        env.DB.prepare("DELETE FROM incidents WHERE monitor_id = ?").bind(id),
        env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id),
      ]);
      return new Response(null, { status: 204 });
    }
  }

  return error(404, "Not found");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
