import type { Metadata } from 'next';
import { Inter, Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import ErrorReportFab from '@/components/ErrorReportFab';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Latin: Inter（軽量・クリーン）
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

// 日本語: Noto Sans JP
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

// 検索ワード是正(TaskHub 6f2495e6・2026-11-11 村田さん「提案どおり進める」)で採用した語。
// 根拠=キーワードプランナー実測(月1000以上)。機能が無い語(PDF結合・画像PDF変換・Excel変換・フリーソフト)は入れない。
// 語リスト(kw_reflect_check用)=C:\Dev\tools\kw_reflect_check\wordlists\ocr.taxbestsearch.com.tsv と揃える。
const SITE_KEYWORDS = [
  // 種語
  '請求書 OCR', '請求書OCR', '請求書 読み取り', '請求書読み取り', '請求書 PDF 分割', '請求書 自動 読み取り',
  // A 分割（請求書ごとにAIが自動分割・ZIP一括DLできる）
  'PDF分割', 'PDFを分割', 'PDFの分割', 'ページ分割PDF', 'PDFページ分割', 'PDFページを分割', 'PDFページの分割',
  'PDF分割ページ', 'PDF分割方法', 'PDFの分割方法',
  // B 無料（3日間／20回の無料お試しがある。「完全無料」ではない）
  '無料PDF分割', 'PDF分割無料', 'PDF無料分割',
  // 分解（表示文には入れずmeta keywordsのみ）
  'PDF分解', 'PDFの分解',
  'Invoice OCR', 'AI OCR', '税理士 請求書',
];

export const metadata: Metadata = {
  title: 'Invoice OCR｜請求書OCR・PDF分割（請求書ごとに自動分割・命名）',
  description:
    '請求書OCRで、複数の請求書が混在したPDFを請求書ごとに自動で分割・命名。PDFのページ分割・請求書の読み取りをAIにおまかせ。税理士向けクラウドツール。無料で20回お試しできます。',
  keywords: SITE_KEYWORDS,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body className="antialiased">
        <ConfirmProvider>
          {children}
          <ErrorReportFab />
        </ConfirmProvider>
      </body>
    </html>
  );
}
