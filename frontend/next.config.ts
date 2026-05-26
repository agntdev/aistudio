import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server in .next/standalone so the production
  // Docker image (Dockerfile) can copy the minimal runtime tree without
  // pulling all of node_modules. T09 deployment to Fly.io / Cloud Run.
  output: "standalone",
};

export default nextConfig;
