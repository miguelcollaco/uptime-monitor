import type { Env } from "./env";

/**
 * Admin authentication. Two ways in, both based on the ADMIN_TOKEN secret:
 *
 * - `Authorization: Bearer <ADMIN_TOKEN>` for scripts and curl.
 * - A session cookie for the /admin page, set by POST /api/admin/login when
 *   the password (ADMIN_TOKEN) is right. The cookie holds an expiry time and an
 *   HMAC of it keyed by ADMIN_TOKEN, so no session storage is needed and
 *   changing the token logs every session out.
 */

const SESSION_COOKIE = "admin_session";
const SESSION_TTL_S = 7 * 24 * 60 * 60;
/** Wrong passwords allowed per IP within LOCKOUT_MS before logins are refused. */
const MAX_FAILURES = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

/** Constant-time comparison: hash both sides so lengths don't leak either. */
async function tokenMatches(given: string, token: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(token)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function sessionKey(token: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(`admin-session:${token}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sessionCookie(value: string, maxAgeS: number, url: URL): string {
  // Browsers drop Secure cookies on plain http, which `pnpm dev` uses.
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure}`;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function hasValidSession(request: Request, token: string): Promise<boolean> {
  const value = readCookie(request, SESSION_COOKIE);
  const [expires, sig] = value?.split(".") ?? [];
  if (!expires || !sig) return false;
  if (!(Number(expires) > Date.now())) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromBase64Url(sig);
  } catch {
    return false;
  }
  // HMAC verify is constant-time.
  return crypto.subtle.verify("HMAC", await sessionKey(token), sigBytes, enc.encode(expires));
}

/** True for a valid Bearer token, or a valid session cookie on a same-origin request. */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;

  const header = request.headers.get("authorization");
  if (header !== null) {
    return header.startsWith("Bearer ") && tokenMatches(header.slice(7), token);
  }

  if (!(await hasValidSession(request, token))) return false;

  // SameSite=Strict already keeps the cookie off cross-site requests. As a second
  // layer, refuse cookie-authenticated writes that don't come from this origin.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return request.headers.get("origin") === new URL(request.url).origin;
  }
  return true;
}

function json(data: unknown, status: number, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers });
}

/** POST /api/admin/login  { "password": "..." } */
export async function login(request: Request, env: Env): Promise<Response> {
  const token = env.ADMIN_TOKEN;
  if (!token) return json({ error: "Admin is disabled: set the ADMIN_TOKEN secret" }, 404);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const now = Date.now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at >= ?",
  )
    .bind(ip, now - LOCKOUT_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILURES) {
    return json({ error: "Too many wrong passwords. Try again in 15 minutes." }, 429, {
      "retry-after": String(LOCKOUT_MS / 1000),
    });
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await tokenMatches(password, token))) {
    await env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now).run();
    return json({ error: "Wrong password" }, 401);
  }

  await env.DB.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip).run();
  const expires = String(now + SESSION_TTL_S * 1000);
  const sig = toBase64Url(
    await crypto.subtle.sign("HMAC", await sessionKey(token), enc.encode(expires)),
  );
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": sessionCookie(`${expires}.${sig}`, SESSION_TTL_S, new URL(request.url)) },
  });
}

/** POST /api/admin/logout */
export function logout(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": sessionCookie("", 0, new URL(request.url)) },
  });
}
