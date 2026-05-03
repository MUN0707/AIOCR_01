import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // pdfkit 関連のアセットを serverless 関数のバンドルに含める。
  // - lib/fonts/*.otf : 日本語フォント（registerFont で読み込み）
  // - pdfkit/js/data/*.afm : pdfkit の標準フォント定義（不在だと PDFDocument 初期化で ENOENT）
  outputFileTracingIncludes: {
    '/api/subscribe/route': [
      './lib/fonts/**/*',
      './node_modules/pdfkit/js/data/**/*',
    ],
  },
};

export default nextConfig;
