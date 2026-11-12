import type { Env } from "./env";

/**
 * Post a message to the configured Discord or Slack incoming webhook.
 * Does nothing if ALERT_WEBHOOK_URL is not set. Never throws.
 */
export async function sendAlert(env: Env, text: string): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const isSlack = url.includes("hooks.slack.com");
  // Slack uses *bold*, Discord uses **bold**.
  const body = isSlack ? { text: text.replaceAll("**", "*") } : { content: text };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Alert webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("Alert webhook failed", err);
  }
}
