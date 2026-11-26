import { useEffect, useState } from "react";
import type { LatencyPoint } from "../../shared/types";
import { fetchLatency } from "../api";
import { formatDateTime, formatMs } from "../format";

const W = 600;
const H = 140;
const PAD = { top: 10, right: 8, bottom: 20, left: 44 };

interface Props {
  monitorId: number;
  hours?: number;
  /** When the summary last changed; the chart reloads when this does. */
  updatedAt?: number;
}

/** Response time over the last N hours; failed checks are marked in red. */
export function LatencyChart({ monitorId, hours = 24, updatedAt }: Props) {
  const [points, setPoints] = useState<LatencyPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatency(monitorId, hours)
      .then((r) => !cancelled && setPoints(r.points))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [monitorId, hours, updatedAt]);

  if (error) return <p className="muted">Couldn't load latency: {error}</p>;
  if (!points) return <p className="muted">Loading…</p>;
  if (points.length === 0) return <p className="muted">No checks in the last {hours} h yet.</p>;

  const now = Date.now();
  const t0 = now - hours * 3_600_000;
  const values = points.map((p) => p.latencyMs).filter((v): v is number => v !== null);
  const maxY = Math.max(100, ...values) * 1.1;

  const x = (t: number) => PAD.left + ((t - t0) / (now - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom);

  // Break the line at failed checks so gaps are visible.
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of points) {
    if (p.latencyMs === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${x(p.t).toFixed(1)},${y(p.latencyMs).toFixed(1)}`);
    }
  }
  if (current.length) segments.push(current.join(" "));

  const failures = points.filter((p) => !p.ok);
  const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const ticks = [0, maxY / 2, maxY].map((v) => Math.round(v));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Response time, last ${hours} hours`}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="chart__label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
              {formatMs(v)}
            </text>
          </g>
        ))}
        <text className="chart__label" x={PAD.left} y={H - 4}>
          {hours} h ago
        </text>
        <text className="chart__label" x={W - PAD.right} y={H - 4} textAnchor="end">
          now
        </text>
        {segments.map((pts, i) =>
          pts.includes(" ") ? (
            <polyline key={i} className="chart__line" points={pts} />
          ) : (
            <circle key={i} className="chart__dot" cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={2} />
          ),
        )}
        {failures.map((p) => (
          <line
            key={p.t}
            className="chart__fail"
            x1={x(p.t)}
            x2={x(p.t)}
            y1={PAD.top}
            y2={H - PAD.bottom}
          >
            <title>Failed check at {formatDateTime(p.t)}</title>
          </line>
        ))}
      </svg>
      <figcaption className="muted">
        Average {formatMs(avg)} over {points.length} checks
        {failures.length > 0 && `, ${failures.length} failed`}
      </figcaption>
    </figure>
  );
}
