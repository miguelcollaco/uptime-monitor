import { useCallback, useEffect, useState } from "react";
import type { Incident, PublicMonitor, SummaryResponse } from "../shared/types";
import { fetchSummary } from "./api";
import { LatencyChart } from "./components/LatencyChart";
import { UptimeBars } from "./components/UptimeBars";
import { formatDateTime, formatDuration, formatMs, formatPercent, timeAgo } from "./format";

export default function App() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSummary()
      .then((d) => {
        setData(d);
        setError(null);
        document.title = d.title;
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <main className="page">
        <p className="muted">{error ? `Couldn't load status: ${error}` : "Loading…"}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>{data.title}</h1>
        <p className="muted">
          Updated {timeAgo(data.generatedAt)}
        </p>
      </header>

      <OverallBanner monitors={data.monitors} />

      <section className="card">
        {data.monitors.length === 0 ? (
          <p className="muted">No monitors yet. Add some with the seed file or the admin API.</p>
        ) : (
          data.monitors.map((m) => <MonitorRow key={m.id} monitor={m} days={data.windowDays} />)
        )}
      </section>

      <Incidents incidents={data.incidents} />

      <footer className="footer muted">Checks run on Cloudflare Workers · data in D1</footer>
    </main>
  );
}

function OverallBanner({ monitors }: { monitors: PublicMonitor[] }) {
  const active = monitors.filter((m) => !m.paused);
  const down = active.filter((m) => m.status === "down");
  if (active.length === 0) return null;
  const allUp = down.length === 0;
  return (
    <div className={`banner ${allUp ? "banner--up" : "banner--down"}`} role="status">
      <span className={`dot dot--${allUp ? "up" : "down"}`} aria-hidden />
      {allUp
        ? "All systems operational"
        : `${down.length} of ${active.length} ${active.length === 1 ? "system" : "systems"} down: ${down
            .map((m) => m.name)
            .join(", ")}`}
    </div>
  );
}

function MonitorRow({ monitor: m, days }: { monitor: PublicMonitor; days: number }) {
  const [open, setOpen] = useState(false);
  const status = m.paused ? "paused" : m.status;
  const statusLabel = { up: "Operational", down: "Down", unknown: "Pending", paused: "Paused" }[status];

  return (
    <div className="monitor">
      <button
        className="monitor__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="monitor__name">
          <span className={`dot dot--${status}`} aria-hidden />
          {m.name}
        </span>
        <span className="monitor__meta">
          <span className={`pill pill--${status}`}>{statusLabel}</span>
          <span className="muted" title={`Uptime over the last ${days} days`}>
            {formatPercent(m.uptimeWindow)}
          </span>
          <span className="chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>

      <UptimeBars daily={m.daily} days={days} />
      <div className="bars__legend muted">
        <span>{days} days ago</span>
        <span>
          24 h: {formatPercent(m.uptime24h)} · avg {formatMs(m.avgLatency24hMs)} · checked{" "}
          {timeAgo(m.lastCheckedAt)}
        </span>
        <span>Today</span>
      </div>

      {open && <LatencyChart monitorId={m.id} />}
    </div>
  );
}

function Incidents({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="card">
      <h2>Recent incidents</h2>
      {incidents.length === 0 ? (
        <p className="muted">No incidents recorded.</p>
      ) : (
        <ul className="incidents">
          {incidents.map((i) => (
            <li key={i.id}>
              <span className={`dot dot--${i.resolvedAt ? "up" : "down"}`} aria-hidden />
              <div>
                <strong>{i.monitorName}</strong>{" "}
                {i.resolvedAt ? (
                  <span className="muted">
                    was down for {formatDuration(i.resolvedAt - i.startedAt)}
                  </span>
                ) : (
                  <span className="warn">is down (ongoing)</span>
                )}
                <div className="muted small">
                  {formatDateTime(i.startedAt)}
                  {i.cause && ` · ${i.cause}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
