import type { NextConfig } from "next";

/**
 * /api 프록시는 app/api/[...path]/route.ts 가 담당.
 * (rewrite 실패 시 plain "Internal Server Error" 가 나오던 문제 회피)
 * EXPRESS_URL 은 가능하면 127.0.0.1 사용 (Windows localhost→IPv6 이슈).
 */
const nextConfig: NextConfig = {
    output: "standalone",
  };

export default nextConfig;
