import type { MetadataRoute } from 'next';

const BASE = 'https://ocr.taxbestsearch.com';

// 認証なしで開ける公開ページだけ(proxy.ts の公開リストと揃える)
const PATHS = ['', '/lp/invoice', '/pricing', '/tokusho'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({
    url: `${BASE}${p}`,
    lastModified: new Date(),
    priority: p === '' ? 1 : 0.7,
  }));
}
