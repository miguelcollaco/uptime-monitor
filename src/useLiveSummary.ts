import { useEffect, useState } from "react";
import type { SummaryResponse } from "../shared/types";
import { fetchSummary } from "./api";

const PING_MS = 30_000;
// No message (not even a "pong") for this long means the connection is dead.
const STALE_MS = 75_000;
const MAX_RETRY_MS = 60_000;

/**
 * The status summary, kept current over a WebSocket to /api/live.
 * The server pushes a new summary after every check run. While the socket is
 * down, the hook polls /api/summary every 30 s and keeps trying to reconnect.
 */
export function useLiveSummary() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retryMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMessageAt = 0;

    const apply = (d: SummaryResponse) => {
      setData(d);
      setError(null);
      document.title = d.title;
    };

    const poll = () =>
      fetchSummary()
        .then(apply)
        .catch((e: Error) => setError(e.message));

    const connect = () => {
      const url = new URL("/api/live", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => {
        setLive(true);
        retryMs = 1_000;
        lastMessageAt = Date.now();
      };
      socket.onmessage = (e: MessageEvent<string>) => {
        lastMessageAt = Date.now();
        if (e.data !== "pong") apply(JSON.parse(e.data) as SummaryResponse);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (ws === socket) ws = null;
        setLive(false);
        if (stopped) return;
        poll();
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      };
    };

    connect();

    // Connected: ping to keep the connection alive and notice when it dies.
    // Disconnected: fall back to polling until a reconnect succeeds.
    const tick = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastMessageAt > STALE_MS) ws.close();
        else ws.send("ping");
      } else if (!ws) {
        poll();
      }
    }, PING_MS);

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(tick);
      ws?.close();
    };
  }, []);

  return { data, error, live };
}
