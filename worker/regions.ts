import { DurableObject } from "cloudflare:workers";
import type { Env, MonitorRow } from "./env";
import { checkMonitor, type CheckResult } from "./checks";

/**
 * Multi-region checks.
 *
 * Each region in the REGIONS var gets one RegionChecker Durable Object, created
 * with that region as its location hint. A Durable Object stays where it was
 * created, so its checks always leave from the same part of the world. Every
 * cron run asks all regions in parallel, and a monitor only counts as failing
 * when most of the regions that answered saw it fail.
 */

/** Durable Object location hints, with names for alerts and the status page. */
export const REGION_NAMES: Record<string, string> = {
  wnam: "US West",
  enam: "US East",
  sam: "South America",
  weur: "Europe",
  eeur: "Eastern Europe",
  apac: "Asia-Pacific",
  oc: "Oceania",
  afr: "Africa",
  me: "Middle East",
};

const DEFAULT_REGIONS = ["weur", "enam", "apac"];

/** Regions from the comma-separated REGIONS var; unknown hints are ignored. */
export function parseRegions(value: string | undefined): string[] {
  const regions = (value ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r in REGION_NAMES);
  return regions.length > 0 ? [...new Set(regions)] : DEFAULT_REGIONS;
}

export const regionName = (region: string) =>
  REGION_NAMES[region] ?? (region === "worker" ? "Worker fallback" : region);

/** Sort key that follows the configured REGIONS order; anything else goes last. */
export function regionOrder(env: Env): (region: string) => number {
  const regions = parseRegions(env.REGIONS);
  return (region) => {
    const i = regions.indexOf(region);
    return i === -1 ? regions.length : i;
  };
}

export interface RegionRun {
  region: string;
  /** Cloudflare datacenter the checks actually ran from (e.g. "FRA"), if known. */
  colo: string | null;
  /** One result per monitor, in the order the monitors were passed in. */
  results: CheckResult[];
}

export class RegionChecker extends DurableObject<Env> {
  /** Check every monitor from this object's location. */
  async check(region: string, monitors: MonitorRow[]): Promise<RegionRun> {
    const [colo, results] = await Promise.all([
      this.lookUpColo(),
      Promise.all(monitors.map(checkMonitor)),
    ]);
    return { region, colo, results };
  }

  /** Location hints are best-effort, so record where this object really landed. */
  private async lookUpColo(): Promise<string | null> {
    try {
      const res = await fetch("https://cloudflare.com/cdn-cgi/trace");
      return (await res.text()).match(/^colo=(\w+)$/m)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

/** Run every monitor in every region. Regions that error are left out of the result. */
export async function checkFromRegions(env: Env, monitors: MonitorRow[]): Promise<RegionRun[]> {
  const regions = parseRegions(env.REGIONS);
  const settled = await Promise.allSettled(
    regions.map((region) =>
      env.CHECKER.get(env.CHECKER.idFromName(region), { locationHint: region as DurableObjectLocationHint })
        .check(region, monitors),
    ),
  );
  const runs: RegionRun[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") runs.push(s.value);
    else console.error(`Region ${regions[i]} failed to run checks`, s.reason);
  });
  return runs;
}

/** One region's result for one monitor. */
export interface RegionResult extends CheckResult {
  region: string;
  colo: string | null;
}

/**
 * Combine one monitor's per-region results into a single verdict.
 * It fails only when more than half of the regions failed. Latency is the
 * median of the regions that succeeded.
 */
export function combineRegions(monitorId: number, checkedAt: number, results: RegionResult[]): CheckResult {
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  const ok = failed.length * 2 <= results.length && passed.length > 0;

  const latencies = passed
    .map((r) => r.latencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const mid = latencies.length >> 1;
  const median =
    latencies.length === 0
      ? null
      : latencies.length % 2
        ? latencies[mid]
        : Math.round((latencies[mid - 1] + latencies[mid]) / 2);

  return {
    monitorId,
    checkedAt,
    ok,
    statusCode: (ok ? passed : failed)[0]?.statusCode ?? null,
    latencyMs: ok ? median : null,
    error: ok ? null : describeFailures(failed, results.length),
  };
}

/**
 * E.g. "Down in 2/3 regions (Europe, US East): Timed out after 10000 ms".
 * Regions that failed the same way are grouped so the message stays short.
 */
function describeFailures(failed: RegionResult[], total: number): string {
  const byError = new Map<string, string[]>();
  for (const r of failed) {
    const key = r.error ?? "Failed";
    byError.set(key, [...(byError.get(key) ?? []), regionName(r.region)]);
  }
  const parts = [...byError].map(([error, regions]) =>
    byError.size === 1 ? `(${regions.join(", ")}): ${error}` : `${regions.join(", ")}: ${error}`,
  );
  const prefix = `Down in ${failed.length}/${total} ${total === 1 ? "region" : "regions"}`;
  return byError.size === 1 ? `${prefix} ${parts[0]}` : `${prefix}: ${parts.join("; ")}`;
}
