import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Emit a self-contained server in .next/standalone so the production
  // Docker image (Dockerfile) can copy the minimal runtime tree without
  // pulling all of node_modules. T09 deployment to Fly.io / Cloud Run.
  output: "standalone",
};

/**
 * Sentry build-time wiring (T08).
 *
 * - Strips Sentry SDK logs from the client bundle to save bytes.
 * - Tunnels Sentry calls through `/monitoring` so ad-blockers don't
 *   eat client-side error reports.
 * - Source-map upload runs only when SENTRY_AUTH_TOKEN is set, so
 *   local builds skip the upload step automatically.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { disable: false },
  disableLogger: true,
  tunnelRoute: "/monitoring",
  automaticVercelMonitors: true,
});
