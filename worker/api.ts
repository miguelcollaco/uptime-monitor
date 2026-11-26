import type { LatencyResponse, RegionSeries } from "../shared/types";
import type { Env, MonitorRow } from "./env";
import { intVar } from "./env";
import { runAllChecks } from "./checks";
import { connectLive, getLiveSummary, publishSummary } from "./live";
import { isAuthorized, login, logout } from "./auth";
import { regionName, regionOrder } from "./regions";

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
      const sub = path.slice("/api/admin".length);
      if (sub === "/login" && request.method === "POST") return await login(request, env);
      if (sub === "/logout" && request.method === "POST") return logout(request);

      const res = await handleAdmin(request, env, sub);
      // Any successful change to monitors shows up on open status pages right away.
      if (res.ok && request.method !== "GET") await publishSummary(env);
      return res;
    }

    if (request.method !== "GET") return error(405, "Method not allowed");

    // WebSocket: the status page receives a new summary after every check run.
    if (path === "/api/live") {
      return await connectLive(env, request);
    }

    if (path === "/api/summary") {
      return json(await getLiveSummary(env), {
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

async function getLatency(env: Env, monitorId: number, hours: number): Promise<LatencyResponse> {
  const since = Date.now() - hours * HOUR_MS;
  type Row = { checked_at: number; latency_ms: number | null; ok: number };
  type RegionRow = Row & { region: string; colo: string | null };

  const [combined, perRegion] = await env.DB.batch([
    env.DB.prepare(
      `SELECT checked_at, latency_ms, ok FROM checks
        WHERE monitor_id = ? AND checked_at >= ?
        ORDER BY checked_at`,
    ).bind(monitorId, since),
    env.DB.prepare(
      `SELECT checked_at, latency_ms, ok, region, colo FROM region_checks
        WHERE monitor_id = ? AND checked_at >= ?
        ORDER BY checked_at`,
    ).bind(monitorId, since),
  ]);

  const toPoint = (r: Row) => ({ t: r.checked_at, latencyMs: r.latency_ms, ok: r.ok === 1 });

  const series = new Map<string, RegionSeries>();
  for (const r of perRegion.results as RegionRow[]) {
    let s = series.get(r.region);
    if (!s) {
      s = { region: r.region, name: regionName(r.region), colo: null, points: [] };
      series.set(r.region, s);
    }
    s.points.push(toPoint(r));
    // Rows are oldest first, so this ends up as the latest known datacenter.
    if (r.colo) s.colo = r.colo;
  }
  const order = regionOrder(env);

  return {
    monitorId,
    hours,
    points: (combined.results as Row[]).map(toPoint),
    regions: [...series.values()].sort((a, b) => order(a.region) - order(b.region)),
  };
}

// ---------- Admin API (Bearer ADMIN_TOKEN or the /admin page's session cookie) ----------

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
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function validateMethod(value: unknown): "GET" | "HEAD" | null {
  return value === "GET" || value === "HEAD" ? value : null;
}

async function handleAdmin(request: Request, env: Env, sub: string): Promise<Response> {
  if (!env.ADMIN_TOKEN) return error(404, "Admin is disabled: set the ADMIN_TOKEN secret");
  if (!(await isAuthorized(request, env))) return error(401, "Unauthorized");

  // GET /api/admin/session  -> lets the admin page check whether it's logged in
  if (sub === "/session" && request.method === "GET") {
    return json({ ok: true });
  }

  // POST /api/admin/run  -> run all checks now
  if (sub === "/run" && request.method === "POST") {
    const results = await runAllChecks(env);
    return json({ ran: results.length, results });
  }

  // GET /api/admin/monitors  -> list with URLs
  if (sub === "/monitors" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM monitors ORDER BY name COLLATE NOCASE",
    ).all<MonitorRow>();
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
    const method = body.method === undefined ? "GET" : validateMethod(body.method);
    if (!method) return error(400, "method must be GET or HEAD");
    const timeout = clampInt(body.timeout_ms, 1000, 30000, 10000);
    const min = clampInt(body.expected_status_min, 100, 599, 200);
    const max = clampInt(body.expected_status_max, min, 599, Math.max(min, 399));
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

    // PATCH /api/admin/monitors/:id  -> update any of the fields; others keep their value
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => null)) as MonitorInput | null;
      if (!body) return error(400, "Expected a JSON body");
      const current = await env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
        .bind(id)
        .first<MonitorRow>();
      if (!current) return error(404, "Monitor not found");

      const name = body.name === undefined ? current.name : String(body.name).trim();
      if (!name) return error(400, "name can't be empty");
      const url = body.url === undefined ? current.url : validateUrl(body.url);
      if (!url) return error(400, "url must be an http(s) URL");
      const method = body.method === undefined ? current.method : validateMethod(body.method);
      if (!method) return error(400, "method must be GET or HEAD");
      const timeout = clampInt(body.timeout_ms, 1000, 30000, current.timeout_ms);
      const min = clampInt(body.expected_status_min, 100, 599, current.expected_status_min);
      const max = clampInt(body.expected_status_max, min, 599, Math.max(min, current.expected_status_max));
      const paused = typeof body.paused === "boolean" ? (body.paused ? 1 : 0) : current.paused;

      const row = await env.DB.prepare(
        `UPDATE monitors
            SET name = ?, url = ?, method = ?, timeout_ms = ?,
                expected_status_min = ?, expected_status_max = ?, paused = ?
          WHERE id = ? RETURNING *`,
      )
        .bind(name, url, method, timeout, min, max, paused, id)
        .first<MonitorRow>();
      return row ? json(row) : error(404, "Monitor not found");
    }

    // DELETE /api/admin/monitors/:id
    if (request.method === "DELETE") {
      // D1 doesn't enforce foreign keys by default, so delete children explicitly.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM checks WHERE monitor_id = ?").bind(id),
        env.DB.prepare("DELETE FROM daily_stats WHERE monitor_id = ?").bind(id),
        env.DB.prepare("DELETE FROM region_checks WHERE monitor_id = ?").bind(id),
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
