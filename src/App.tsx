import { useCallback, useEffect, useState } from "react";
import type { PublicMonitor, SummaryResponse } from "../shared/types";
import { fetchSummary } from "./api";
import { UptimeBars } from "./components/UptimeBars";
import { formatMs, formatPercent, timeAgo } from "./format";

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
  const status = m.paused ? "paused" : m.status;
  const statusLabel = { up: "Operational", down: "Down", unknown: "Pending", paused: "Paused" }[status];

  return (
    <div className="monitor">
      <div className="monitor__head">
        <span className="monitor__name">
          <span className={`dot dot--${status}`} aria-hidden />
          {m.name}
        </span>
        <span className="monitor__meta">
          <span className={`pill pill--${status}`}>{statusLabel}</span>
          <span className="muted" title={`Uptime over the last ${days} days`}>
            {formatPercent(m.uptimeWindow)}
          </span>
        </span>
      </div>

      <UptimeBars daily={m.daily} days={days} />
      <div className="bars__legend muted">
        <span>{days} days ago</span>
        <span>
          24 h: {formatPercent(m.uptime24h)} · avg {formatMs(m.avgLatency24hMs)} · checked{" "}
          {timeAgo(m.lastCheckedAt)}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
