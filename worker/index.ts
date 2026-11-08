import type { Env } from "./env";
import { runAllChecks } from "./checks";

export default {
  async fetch(request, env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },

  // Cron trigger: run every active check.
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runAllChecks(env).then((results) => {
        const down = results.filter((r) => !r.ok).length;
        console.log(`Checked ${results.length} monitors, ${down} failing`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
