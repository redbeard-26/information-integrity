import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  basePath: "/information-integrity",
  turbopack: { root: process.cwd() },
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
