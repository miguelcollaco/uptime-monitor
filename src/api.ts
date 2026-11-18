import type { SummaryResponse } from "../shared/types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export const fetchSummary = () => getJson<SummaryResponse>("/api/summary");
