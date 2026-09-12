import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, a stray
  // package-lock.json in the home directory makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
  // Allow a second dev server (e.g. a parallel agent session) to run against
  // the same source without colliding on the `.next/dev` lockfile. Setting
  // NEXT_DIST_DIR routes its build output — and its lock — somewhere else.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
