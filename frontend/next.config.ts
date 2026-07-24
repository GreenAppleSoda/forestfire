import type { NextConfig } from "next";

const EXPRESS_URL = process.env.EXPRESS_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${EXPRESS_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
