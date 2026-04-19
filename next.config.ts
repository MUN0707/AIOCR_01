import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  outputFileTracingIncludes: {
    '/api/process-pdf': ['./lib/ocr/traineddata/**/*'],
  },
};

export default nextConfig;
