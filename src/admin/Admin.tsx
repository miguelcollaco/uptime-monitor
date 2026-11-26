import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { MonitorRow } from "../../shared/types";
import { timeAgo } from "../format";
import { AuthError, adminApi, type MonitorInput } from "./api";

type AuthState = "checking" | "out" | "in" | "disabled";

export default function Admin() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin";
    adminApi
      .sessionStatus()
      .then((s) => setAuth(s === 200 ? "in" : s === 404 ? "disabled" : "out"))
      .catch(() => setAuth("out"));
  }, []);

  const onExpired = useCallback((message: string) => {
    setNotice(message);
    setAuth("out");
  }, []);

  return (
    <main className="page">
      {auth === "checking" && <p className="muted">Loading…</p>}
      {auth === "disabled" && (
        <section className="card login">
          <h1>Admin is disabled</h1>
          <p className="muted">
            Set the <code>ADMIN_TOKEN</code> secret to turn it on. Locally, add it to{" "}
            <code>.dev.vars</code>; when deployed, run <code>pnpm wrangler secret put ADMIN_TOKEN</code>.
          </p>
          <a href="/">← Status page</a>
        </section>
      )}
      {auth === "out" && (
        <LoginForm
          notice={notice}
          onLogin={() => {
            setNotice(null);
            setAuth("in");
          }}
        />
      )}
      {auth === "in" && <Dashboard onLogout={() => setAuth("out")} onExpired={onExpired} />}
    </main>
  );
}

function LoginForm({ notice, onLogin }: { notice: string | null; onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Admin</h1>
      {notice && <p className="muted">{notice}</p>}
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="muted small">Your password is the ADMIN_TOKEN secret.</p>
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      <div className="form__buttons">
        <button className="btn btn--primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <a href="/" className="small">
          ← Status page
        </a>
      </div>
    </form>
  );
}

function Dashboard({
  onLogout,
  onExpired,
}: {
  onLogout: () => void;
  onExpired: (message: string) => void;
}) {
  const [monitors, setMonitors] = useState<MonitorRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  /** Run an admin action, then reload the list. Resolves to whether it worked. */
  const run = useCallback(
    async <T,>(action: () => Promise<T>, describe?: (result: T) => string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await action();
        setMonitors(await adminApi.list());
        if (describe) setMessage(describe(result));
        return true;
      } catch (err) {
        if (err instanceof AuthError) onExpired(err.message);
        else setError((err as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onExpired],
  );

  useEffect(() => {
    void run(async () => undefined);
  }, [run]);

  const logout = async () => {
    await adminApi.logout().catch(() => undefined);
    onLogout();
  };

  const remove = (m: MonitorRow) => {
    if (!window.confirm(`Delete "${m.name}" and all its check history? This can't be undone.`)) return;
    void run(() => adminApi.remove(m.id), () => `Deleted ${m.name}.`);
  };

  return (
    <>
      <header className="header admin__header">
        <div>
          <h1>Monitors</h1>
          <p className="muted">
            <a href="/">View status page</a>
          </p>
        </div>
        <div className="admin__actions">
          <button
            className="btn btn--primary"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            disabled={adding}
          >
            Add monitor
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(adminApi.runChecks, (r) => {
                const failing = r.results.filter((x) => !x.ok).length;
                return `Checked ${r.ran} ${r.ran === 1 ? "monitor" : "monitors"}, ${failing} failing.`;
              })
            }
          >
            Run checks now
          </button>
          <button className="btn" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      {adding && (
        <section className="card">
          <h2>New monitor</h2>
          <MonitorForm
            submitLabel="Add monitor"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              if (await run(() => adminApi.create(input), () => `Added ${input.name}.`)) {
                setAdding(false);
              }
            }}
          />
        </section>
      )}

      <section className="card">
        {monitors === null ? (
          <p className="muted">Loading…</p>
        ) : monitors.length === 0 ? (
          <p className="muted">No monitors yet. Add one to start checking.</p>
        ) : (
          monitors.map((m) =>
            editingId === m.id ? (
              <div className="monitor" key={m.id}>
                <MonitorForm
                  initial={m}
                  submitLabel="Save"
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (input) => {
                    if (await run(() => adminApi.update(m.id, input), () => `Saved ${input.name}.`)) {
                      setEditingId(null);
                    }
                  }}
                />
              </div>
            ) : (
              <MonitorItem
                key={m.id}
                monitor={m}
                busy={busy}
                onEdit={() => {
                  setEditingId(m.id);
                  setAdding(false);
                }}
                onTogglePause={() =>
                  void run(
                    () => adminApi.update(m.id, { paused: !m.paused }),
                    () => `${m.name} ${m.paused ? "resumed" : "paused"}.`,
                  )
                }
                onDelete={() => remove(m)}
              />
            ),
          )
        )}
      </section>
    </>
  );
}

function MonitorItem({
  monitor: m,
  busy,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  monitor: MonitorRow;
  busy: boolean;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const status = m.paused ? "paused" : m.status;
  const label = { up: "Operational", down: "Down", unknown: "Pending", paused: "Paused" }[status];

  return (
    <div className="monitor admin-row">
      <div className="admin-row__main">
        <span className="monitor__name">
          <span className={`dot dot--${status}`} aria-hidden />
          {m.name}
          <span className={`pill pill--${status}`}>{label}</span>
        </span>
        <a className="small admin-row__url" href={m.url} target="_blank" rel="noreferrer">
          {m.url}
        </a>
        <span className="muted small">
          {m.method} · times out after {m.timeout_ms / 1000} s · expects {m.expected_status_min}–
          {m.expected_status_max} · checked {timeAgo(m.last_checked_at)}
        </span>
      </div>
      <div className="admin-row__actions">
        <button className="btn btn--small" disabled={busy} onClick={onTogglePause}>
          {m.paused ? "Resume" : "Pause"}
        </button>
        <button className="btn btn--small" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn--small btn--danger" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function MonitorForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: MonitorRow;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: MonitorInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [method, setMethod] = useState<"GET" | "HEAD">(initial?.method === "HEAD" ? "HEAD" : "GET");
  const [timeoutS, setTimeoutS] = useState(String((initial?.timeout_ms ?? 10_000) / 1000));
  const [min, setMin] = useState(String(initial?.expected_status_min ?? 200));
  const [max, setMax] = useState(String(initial?.expected_status_max ?? 399));
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (Number(max) < Number(min)) {
      setError("The highest expected status can't be below the lowest.");
      return;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      url: url.trim(),
      method,
      timeout_ms: Math.round(Number(timeoutS) * 1000),
      expected_status_min: Number(min),
      expected_status_max: Number(max),
    });
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form__row">
        <label className="field">
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="My site" />
        </label>
        <label className="field field--wide">
          <span>URL</span>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
      </div>
      <details className="form__advanced">
        <summary>Advanced</summary>
        <div className="form__row">
          <label className="field">
            <span>Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as "GET" | "HEAD")}>
              <option>GET</option>
              <option>HEAD</option>
            </select>
          </label>
          <label className="field">
            <span>Timeout (seconds)</span>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={timeoutS}
              onChange={(e) => setTimeoutS(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Expected status from</span>
            <input type="number" min={100} max={599} required value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label className="field">
            <span>to</span>
            <input type="number" min={100} max={599} required value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
        </div>
      </details>
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      <div className="form__buttons">
        <button className="btn btn--primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
