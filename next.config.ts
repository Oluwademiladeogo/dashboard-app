import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {},
};

export default nextConfig;
