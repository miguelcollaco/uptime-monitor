import type { Env } from "./env";
import { handleApi } from "./api";
import { runAllChecks } from "./checks";
import { publishSummary } from "./live";

// Durable Object classes must be exported from the Worker's entry module.
export { LiveStatus } from "./live";
export { RegionChecker } from "./regions";

export default {
  // HTTP: JSON API under /api/*, everything else is the React status page.
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },

  // Cron trigger: run every active check, then push the new status to open pages.
  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runAllChecks(env, controller.scheduledTime).then(async (results) => {
        const down = results.filter((r) => !r.ok).length;
        console.log(`Checked ${results.length} monitors, ${down} failing`);
        await publishSummary(env);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
