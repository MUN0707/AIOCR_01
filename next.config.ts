import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // pdfkit が読み込む日本語フォントを serverless 関数のバンドルに含める。
  // 既定では .otf は trace 対象外なので明示する。
  outputFileTracingIncludes: {
    '/api/subscribe/route': ['./lib/fonts/**/*'],
  },
};

export default nextConfig;
