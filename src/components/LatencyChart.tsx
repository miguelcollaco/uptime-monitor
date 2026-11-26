import { useEffect, useState, type PointerEvent } from "react";
import type { LatencyPoint, LatencyResponse } from "../../shared/types";
import { fetchLatency } from "../api";
import { formatDateTime, formatMs, formatTime } from "../format";

const DEFAULT_W = 600;
const H = 150;
const PAD = { top: 10, right: 8, bottom: 20, left: 44 };
/** Categorical slots, assigned in the configured region order (see styles.css). */
const SERIES_COUNT = 3;
/** Checks run every few minutes; a longer silence is a gap, not a straight line. */
const GAP_MS = 15 * 60_000;

interface Props {
  monitorId: number;
  hours?: number;
  /** When the summary last changed; the chart reloads when this does. */
  updatedAt?: number;
}

interface Series {
  key: string;
  label: string;
  colo: string | null;
  slot: number;
  points: LatencyPoint[];
  byTime: Map<number, LatencyPoint>;
}

/**
 * Response time over the last N hours, one line per region. Gaps are failed
 * checks; red markers are runs where most regions failed (counted as down).
 */
export function LatencyChart({ monitorId, hours = 24, updatedAt }: Props) {
  const [data, setData] = useState<LatencyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // Draw at the real pixel width so text and lines keep their size on phones.
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const [W, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = plotEl;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0) setW(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [plotEl]);

  useEffect(() => {
    let cancelled = false;
    fetchLatency(monitorId, hours)
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [monitorId, hours, updatedAt]);

  if (error) return <p className="muted">Couldn't load latency: {error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.points.length === 0) return <p className="muted">No checks in the last {hours} h yet.</p>;

  // Older data has no per-region rows: fall back to the combined line.
  const series: Series[] = (
    data.regions.length > 0
      ? data.regions.map((r) => ({ key: r.region, label: r.name, colo: r.colo, points: r.points }))
      : [{ key: "all", label: "Response time", colo: null, points: data.points }]
  ).map((s, i) => ({
    ...s,
    slot: (i % SERIES_COUNT) + 1,
    byTime: new Map(s.points.map((p) => [p.t, p])),
  }));

  const now = Date.now();
  const windowStart = now - hours * 3_600_000;
  // With less history than the window (a new monitor), zoom in on the data
  // instead of squeezing it against the right edge.
  const firstT = Math.min(...series.flatMap((s) => s.points.map((p) => p.t)), now);
  const t0 = Math.max(windowStart, firstT - 60_000);
  const zoomed = t0 > windowStart + 5 * 60_000;
  const allValues = series.flatMap((s) => s.points.map((p) => p.latencyMs).filter((v): v is number => v !== null));
  const maxY = Math.max(100, ...allValues) * 1.1;

  const plotW = W - PAD.left - PAD.right;
  const x = (t: number) => PAD.left + ((t - t0) / (now - t0)) * plotW;
  const y = (v: number) => PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom);
  const ticks = [0, maxY / 2, maxY].map((v) => Math.round(v));

  // Break each line at failed checks and at stretches with no checks, so gaps are visible.
  const segmentsFor = (points: LatencyPoint[]) => {
    const segments: string[][] = [];
    let current: string[] = [];
    let prevT = -Infinity;
    for (const p of points) {
      const gap = p.t - prevT > GAP_MS;
      prevT = p.t;
      if (gap && current.length) {
        segments.push(current);
        current = [];
      }
      if (p.latencyMs === null || !p.ok) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push(`${x(p.t).toFixed(1)},${y(p.latencyMs).toFixed(1)}`);
      }
    }
    if (current.length) segments.push(current);
    return segments;
  };

  const runs = data.points; // one per check run, oldest first
  const downRuns = runs.filter((p) => !p.ok);
  const medians = runs.map((p) => p.latencyMs).filter((v): v is number => v !== null);
  const typical = medians.length
    ? Math.round(medians.reduce((a, b) => a + b, 0) / medians.length)
    : null;

  const avgOf = (s: Series) => {
    const v = s.points.filter((p) => p.ok && p.latencyMs !== null).map((p) => p.latencyMs as number);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + (((e.clientX - rect.left) / rect.width) * W - PAD.left) / plotW * (now - t0);
    let best = runs[0];
    for (const p of runs) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHoverT(best.t);
  }

  const hoverRun = hoverT === null ? undefined : runs.find((p) => p.t === hoverT);
  const hoverLeft = hoverT === null ? 0 : (x(hoverT) / W) * 100;

  return (
    <figure className="chart">
      {series.length > 1 && (
        <ul className="chart__legend">
          {series.map((s) => {
            const last = s.points.at(-1);
            return (
              <li key={s.key}>
                <span className={`swatch swatch--${s.slot}`} aria-hidden />
                <span>
                  {s.label}
                  {s.colo && <span className="muted"> · {s.colo}</span>}
                  <span className="muted"> · avg {formatMs(avgOf(s))}</span>
                  {last && !last.ok && <span className="warn"> · ✗ failing now</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="chart__plot" ref={setPlotEl}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Response time by region, last ${hours} hours`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverT(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="chart__label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                {formatMs(v)}
              </text>
            </g>
          ))}
          <text className="chart__label" x={PAD.left} y={H - 4}>
            {zoomed ? formatTime(t0) : `${hours} h ago`}
          </text>
          {zoomed && (
            <text className="chart__label" x={PAD.left + plotW / 2} y={H - 4} textAnchor="middle">
              {formatTime((t0 + now) / 2)}
            </text>
          )}
          <text className="chart__label" x={W - PAD.right} y={H - 4} textAnchor="end">
            now
          </text>

          {downRuns.map((p) => (
            <line key={p.t} className="chart__fail" x1={x(p.t)} x2={x(p.t)} y1={PAD.top} y2={H - PAD.bottom} />
          ))}

          {series.map((s) =>
            segmentsFor(s.points).map((pts, i) =>
              pts.length > 1 ? (
                <polyline key={`${s.key}-${i}`} className={`chart__line series--${s.slot}`} points={pts.join(" ")} />
              ) : (
                <circle
                  key={`${s.key}-${i}`}
                  className={`chart__dot series--${s.slot}`}
                  cx={pts[0].split(",")[0]}
                  cy={pts[0].split(",")[1]}
                  r={4}
                />
              ),
            ),
          )}

          {hoverT !== null && (
            <g pointerEvents="none">
              <line className="chart__crosshair" x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={H - PAD.bottom} />
              {series.map((s) => {
                const p = s.byTime.get(hoverT);
                return p && p.ok && p.latencyMs !== null ? (
                  <circle
                    key={s.key}
                    className={`chart__dot chart__dot--hover series--${s.slot}`}
                    cx={x(hoverT)}
                    cy={y(p.latencyMs)}
                    r={4}
                  />
                ) : null;
              })}
            </g>
          )}
        </svg>

        {hoverT !== null && (
          <div
            className={`chart__tooltip ${hoverLeft > 60 ? "chart__tooltip--left" : ""}`}
            style={{ left: `${hoverLeft}%` }}
            role="status"
          >
            <div className="chart__tooltip-time">{formatDateTime(hoverT)}</div>
            {series.map((s) => {
              const p = s.byTime.get(hoverT);
              return (
                <div key={s.key} className="chart__tooltip-row">
                  <span className={`swatch swatch--${s.slot}`} aria-hidden />
                  <span>{s.label}</span>
                  <span className={p && !p.ok ? "warn" : ""}>
                    {!p ? "–" : p.ok ? formatMs(p.latencyMs) : "✗ failed"}
                  </span>
                </div>
              );
            })}
            {hoverRun && !hoverRun.ok && <div className="warn small">Counted as down</div>}
          </div>
        )}
      </div>

      <figcaption className="muted">
        Typical response {formatMs(typical)} over {runs.length} {runs.length === 1 ? "run" : "runs"}
        {zoomed && ` since ${formatTime(firstT)}`}
        {series.length > 1 && " (median across regions)"}
        {downRuns.length > 0 && `, ${downRuns.length} counted as down (red)`}
      </figcaption>
    </figure>
  );
}
