export function formatPercent(fraction: number | null): string {
  if (fraction === null) return "–";
  const pct = fraction * 100;
  // Show two decimals unless it's a clean 100%.
  return pct === 100 ? "100%" : `${pct.toFixed(2)}%`;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "–";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function timeAgo(ts: number | null, now = Date.now()): string {
  if (ts === null) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** YYYY-MM-DD for a UTC day offset from today (0 = today). */
export function utcDay(daysAgo: number, now = Date.now()): string {
  return new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
