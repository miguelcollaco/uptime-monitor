import type { MonitorRow } from "../../shared/types";

/** Thrown when the session has expired or was never valid. */
export class AuthError extends Error {}

export interface MonitorInput {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path !== "/login") {
    throw new AuthError("Your session has expired. Log in again.");
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then((d: { error?: string }) => d.error)
      .catch(() => undefined);
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const adminApi = {
  /** 200 = logged in, 401 = logged out, 404 = admin disabled (no ADMIN_TOKEN). */
  sessionStatus: () => fetch("/api/admin/session").then((r) => r.status),
  login: (password: string) => call<void>("POST", "/login", { password }),
  logout: () => call<void>("POST", "/logout"),
  list: () => call<MonitorRow[]>("GET", "/monitors"),
  create: (m: MonitorInput) => call<MonitorRow>("POST", "/monitors", m),
  update: (id: number, m: Partial<MonitorInput> & { paused?: boolean }) =>
    call<MonitorRow>("PATCH", `/monitors/${id}`, m),
  remove: (id: number) => call<void>("DELETE", `/monitors/${id}`),
  runChecks: () => call<{ ran: number; results: { ok: boolean }[] }>("POST", "/run"),
};
