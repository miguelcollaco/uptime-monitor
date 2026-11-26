import { useEffect, useState } from "react";
import type { Incident, PublicMonitor } from "../shared/types";
import { LatencyChart } from "./components/LatencyChart";
import { LockIcon, TopBar } from "./components/TopBar";
import { UptimeBars } from "./components/UptimeBars";
import { formatDateTime, formatDuration, formatMs, formatPercent, timeAgo } from "./format";
import { useLiveSummary } from "./useLiveSummary";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

export default function App() {
  const { data, error, live } = useLiveSummary();

  // Updates are pushed only when checks run, so re-render on a timer to keep
  // the "x min ago" labels current in between.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page">
      <TopBar
        title={data?.title ?? "Uptime Monitor"}
        link={{ href: "/admin", label: "Admin", icon: <LockIcon /> }}
      />

      <main>
        {!data ? (
          <p className="muted">{error ? `Couldn't load status: ${error}` : "Loading…"}</p>
        ) : (
          <>
            <OverallBanner
              monitors={data.monitors}
              live={live}
              updatedAt={data.generatedAt}
              stale={error !== null}
            />

            <section className="card" aria-label="Monitors">
              {data.monitors.length === 0 ? (
                <p className="muted">No monitors yet. Add some on the admin page.</p>
              ) : (
                data.monitors.map((m) => (
                  <MonitorRow key={m.id} monitor={m} days={data.windowDays} updatedAt={data.generatedAt} />
                ))
              )}
            </section>

            <Incidents incidents={data.incidents} />
          </>
        )}
      </main>

      <footer className="footer muted">
        <p>Runs on Cloudflare Workers, D1 and Durable Objects</p>
        <p>
          Built by <a href="https://github.com/miguelcollaco">Miguel Collaço</a> ·{" "}
          <a href="https://github.com/miguelcollaco/uptime-monitor">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
    <path d="M12 6v7M12 17.5v.5" />
  </svg>
);

function OverallBanner({
  monitors,
  live,
  updatedAt,
  stale,
}: {
  monitors: PublicMonitor[];
  live: boolean;
  updatedAt: number;
  stale: boolean;
}) {
  const active = monitors.filter((m) => !m.paused);
  const down = active.filter((m) => m.status === "down");
  const regions = [...new Set(monitors.flatMap((m) => m.regions.map((r) => r.name)))];

  const tone = active.length === 0 ? "none" : down.length === 0 ? "up" : "down";
  const headline =
    tone === "none"
      ? "No active monitors"
      : tone === "up"
        ? "All systems operational"
        : down.length === active.length
          ? "All systems down"
          : `${down.length} of ${active.length} systems down`;

  return (
    <section className={`banner banner--${tone}`} role="status">
      <span className="banner__icon">{tone === "down" ? <AlertIcon /> : <CheckIcon />}</span>
      <div className="banner__body">
        <h1 className="banner__title">{headline}</h1>
        {tone === "down" && <p className="banner__detail">{listFormat.format(down.map((m) => m.name))}</p>}
        <p className="banner__meta">
          {live && (
            <span className="live" title="Updates appear as soon as checks run">
              <span className="dot dot--up" aria-hidden /> Live ·{" "}
            </span>
          )}
          Updated {timeAgo(updatedAt)}
          {regions.length > 0 && <> · Checked from {listFormat.format(regions)}</>}
          {stale && <span className="warn"> · Connection lost, showing the last data</span>}
        </p>
      </div>
    </section>
  );
}

const ChevronIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function MonitorRow({
  monitor: m,
  days,
  updatedAt,
}: {
  monitor: PublicMonitor;
  days: number;
  updatedAt: number;
}) {
  // Links like /#monitor-3 open that monitor's details.
  const [open, setOpen] = useState(() => window.location.hash === `#monitor-${m.id}`);
  const status = m.paused ? "paused" : m.status;
  const statusLabel = { up: "Operational", down: "Down", unknown: "Pending", paused: "Paused" }[status];
  // Up overall (most regions fine), but some regions saw it fail in the latest run.
  const failingIn = status === "up" ? m.regions.filter((r) => !r.ok).map((r) => r.name) : [];

  return (
    <div className={`monitor ${open ? "monitor--open" : ""}`} id={`monitor-${m.id}`}>
      <button
        className="monitor__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`monitor-${m.id}-details`}
      >
        <span className="monitor__title">
          <span className="monitor__name">
            <span className={`dot dot--${status}`} aria-hidden />
            {m.name}
          </span>
          <span className="monitor__stats muted">
            {formatPercent(m.uptime24h)} last 24 h
            {m.avgLatency24hMs !== null && ` · ${formatMs(m.avgLatency24hMs)} avg`} · checked{" "}
            {timeAgo(m.lastCheckedAt)}
            {failingIn.length > 0 && (
              <span className="warn"> · ✗ failing in {listFormat.format(failingIn)}</span>
            )}
          </span>
        </span>
        <span className="monitor__meta">
          <span className="monitor__uptime" title={`Uptime over the last ${days} days`}>
            <strong>{formatPercent(m.uptimeWindow)}</strong>
            <span className="muted">{days}-day uptime</span>
          </span>
          <span className={`pill pill--${status}`}>{statusLabel}</span>
          <span className="chevron">
            <ChevronIcon />
          </span>
        </span>
      </button>

      <UptimeBars daily={m.daily} days={days} />
      <div className="bars__legend muted">
        <span>{days} days ago</span>
        <span>Today</span>
      </div>

      {open && (
        <div id={`monitor-${m.id}-details`}>
          <LatencyChart monitorId={m.id} updatedAt={updatedAt} />
        </div>
      )}
    </div>
  );
}

function Incidents({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="card">
      <h2>Recent incidents</h2>
      {incidents.length === 0 ? (
        <p className="muted incidents__empty">No incidents recorded.</p>
      ) : (
        <ul className="incidents">
          {incidents.map((i) => (
            <li key={i.id}>
              <span className={`pill pill--${i.resolvedAt ? "up" : "down"}`}>
                {i.resolvedAt ? "Resolved" : "Ongoing"}
              </span>
              <div className="incidents__body">
                <div>
                  <strong>{i.monitorName}</strong>{" "}
                  <span className="muted">
                    {i.resolvedAt
                      ? `was down for ${formatDuration(i.resolvedAt - i.startedAt)}`
                      : `has been down for ${formatDuration(Date.now() - i.startedAt)}`}
                  </span>
                </div>
                <div className="muted small">
                  {formatDateTime(i.startedAt)}
                  {i.resolvedAt && ` – ${formatDateTime(i.resolvedAt)}`}
                  {i.cause && <span className="incidents__cause"> · {i.cause}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
