import type { DailyBucket } from "../../shared/types";
import { formatMs, formatPercent, utcDay } from "../format";

interface Props {
  daily: DailyBucket[];
  days: number;
}

function levelFor(bucket: DailyBucket | undefined): string {
  if (!bucket || bucket.total === 0) return "none";
  const ratio = bucket.ok / bucket.total;
  if (ratio === 1) return "up";
  if (ratio >= 0.95) return "degraded";
  return "down";
}

/** One bar per UTC day, oldest on the left, today on the right. */
export function UptimeBars({ daily, days }: Props) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const bars = Array.from({ length: days }, (_, i) => {
    const day = utcDay(days - 1 - i);
    return { day, bucket: byDay.get(day) };
  });

  return (
    <div className="bars" role="img" aria-label={`Daily uptime for the last ${days} days`}>
      {bars.map(({ day, bucket }) => {
        const label = bucket
          ? `${day}: ${formatPercent(bucket.ok / bucket.total)} up, avg ${formatMs(bucket.avgLatencyMs)}`
          : `${day}: no data`;
        return <span key={day} className={`bar bar--${levelFor(bucket)}`} title={label} />;
      })}
    </div>
  );
}
