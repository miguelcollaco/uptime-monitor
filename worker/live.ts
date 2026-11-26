import { DurableObject } from "cloudflare:workers";
import type { SummaryResponse } from "../shared/types";
import type { Env } from "./env";
import { buildSummary } from "./summary";

/**
 * A single instance ("global") that holds the latest status summary and the
 * WebSocket of every open status page.
 *
 * - The cron (and the admin API) call `refresh()` after each change. The
 *   summary is built from D1 once and pushed to every page, so D1 reads don't
 *   grow with the number of viewers.
 * - Sockets are accepted with the Hibernation API: while nothing is happening
 *   the object is evicted from memory and isn't billed for duration, but the
 *   connections stay open.
 * - Pages send "ping" every 30 s to keep the connection alive. The runtime
 *   answers "pong" itself without waking the object.
 */
export class LiveStatus extends DurableObject<Env> {
  /** Lost when the object hibernates; rebuilt from D1 on the next request. */
  private summary: SummaryResponse | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async getSummary(): Promise<SummaryResponse> {
    this.summary ??= await buildSummary(this.env);
    return this.summary;
  }

  /** Rebuild the summary from D1 and push it to every connected page. */
  async refresh(): Promise<void> {
    this.summary = await buildSummary(this.env);
    const message = JSON.stringify(this.summary);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // The socket is already closing; its close handler cleans up.
      }
    }
  }

  /** WebSocket upgrade for /api/live. The page gets the current summary right away. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(await this.getSummary()));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pages only send "ping", which the auto-response handles. Ignore anything else.
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, "closing");
    } catch {
      // Already closed.
    }
  }
}

function stub(env: Env): DurableObjectStub<LiveStatus> {
  return env.LIVE.get(env.LIVE.idFromName("global"));
}

/** The latest summary, built at most once per change rather than per request. */
export const getLiveSummary = (env: Env) => stub(env).getSummary();

/** Rebuild the summary and push it to every open status page. */
export const publishSummary = (env: Env) => stub(env).refresh();

/** Hand a WebSocket upgrade request to the Durable Object. */
export const connectLive = (env: Env, request: Request) => stub(env).fetch(request);
