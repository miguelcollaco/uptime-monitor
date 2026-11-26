import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin runs the Worker (worker/index.ts) inside the real
// Workers runtime during `pnpm dev`, with a local D1 database, and builds
// the Worker plus the React app together for `wrangler deploy`.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
