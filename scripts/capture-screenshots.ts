/**
 * スクリーンショット自動取得スクリプト
 *
 * 操作マニュアル用の画面キャプチャを自動的に取得し、docs/images/ に保存します。
 *
 * 前提条件:
 *   npm install -D playwright @playwright/test
 *   npx playwright install chromium
 *
 * 使い方:
 *   npx tsx scripts/capture-screenshots.ts
 *
 * オプション:
 *   BASE_URL=https://invoice-ocr-tawny.vercel.app npx tsx scripts/capture-screenshots.ts
 *   （デフォルトは http://localhost:3000）
 */

import { chromium, type Page, type Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'docs', 'images');

// キャプチャ対象の画面定義
const screenshots = [
  // === メイン画面 ===
  {
    name: '01_top_initial',
    description: 'トップページ（初期状態・ガイド表示）',
    url: '/',
    action: async (_page: Page) => {
      // 初期表示のまま
    },
    viewport: { width: 1280, height: 900 },
  },
  {
    name: '02_mode_invoice',
    description: 'モード選択：請求書（デフォルト）',
    url: '/',
    action: async (_page: Page) => {
      // 請求書モードは初期状態
    },
    viewport: { width: 1280, height: 900 },
    clip: { x: 0, y: 0, width: 1280, height: 400 }, // 上部のみ
  },
  {
    name: '03_mode_tax_return',
    description: 'モード選択：確定申告',
    url: '/',
    action: async (page: Page) => {
      // 確定申告ボタンをクリック
      const buttons = page.locator('button');
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const text = await buttons.nth(i).textContent();
        if (text?.includes('確定申告')) {
          await buttons.nth(i).click();
          break;
        }
      }
      await page.waitForTimeout(500);
    },
    viewport: { width: 1280, height: 900 },
    clip: { x: 0, y: 0, width: 1280, height: 400 },
  },
  {
    name: '04_mode_bank',
    description: 'モード選択：通帳',
    url: '/',
    action: async (page: Page) => {
      const buttons = page.locator('button');
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const text = await buttons.nth(i).textContent();
        if (text?.includes('通帳')) {
          await buttons.nth(i).click();
          break;
        }
      }
      await page.waitForTimeout(500);
    },
    viewport: { width: 1280, height: 900 },
    clip: { x: 0, y: 0, width: 1280, height: 400 },
  },
  {
    name: '05_upload_area',
    description: 'ファイルアップロードエリア',
    url: '/',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
    clip: { x: 100, y: 300, width: 1080, height: 350 },
  },

  // === 営業・情報ページ ===
  {
    name: '06_login',
    description: 'ログインページ',
    url: '/login',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
  },
  {
    name: '07_pricing',
    description: '料金プランページ',
    url: '/pricing',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 1200 },
    fullPage: true,
  },
  {
    name: '08_faq',
    description: 'よくある質問ページ',
    url: '/faq',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
  },
  {
    name: '09_guide',
    description: '使い方ガイドページ',
    url: '/guide',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
  },
  {
    name: '10_security',
    description: 'セキュリティページ',
    url: '/security',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
  },
  {
    name: '11_denied',
    description: 'アクセス拒否ページ',
    url: '/denied',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 600 },
  },
  {
    name: '12_tokusho',
    description: '特定商取引法表記ページ',
    url: '/tokusho',
    action: async (_page: Page) => {},
    viewport: { width: 1280, height: 900 },
  },
];

async function main() {
  // 出力ディレクトリを作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`📸 スクリーンショット取得を開始します`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   出力先:   ${OUTPUT_DIR}`);
  console.log('');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });

    let success = 0;
    let failed = 0;

    for (const shot of screenshots) {
      const page = await context.newPage();

      try {
        // ビューポート設定
        await page.setViewportSize(shot.viewport);

        // ページ遷移
        const url = `${BASE_URL}${shot.url}`;
        console.log(`  📷 ${shot.name} — ${shot.description}`);

        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 15000,
        });

        if (!response || response.status() >= 400) {
          // リダイレクト（認証が必要なページ等）は警告のみ
          console.log(`     ⚠️  ステータス: ${response?.status() ?? 'N/A'}（リダイレクトの可能性あり）`);
        }

        // カスタムアクション実行
        await shot.action(page);

        // フォント読み込み待ち
        await page.waitForTimeout(1000);

        // スクリーンショット取得
        const filePath = path.join(OUTPUT_DIR, `${shot.name}.png`);
        const options: Record<string, unknown> = { path: filePath };

        if ('fullPage' in shot && shot.fullPage) {
          options.fullPage = true;
        } else if ('clip' in shot && shot.clip) {
          options.clip = shot.clip;
        }

        await page.screenshot(options);
        console.log(`     ✅ 保存: docs/images/${shot.name}.png`);
        success++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`     ❌ 失敗: ${message}`);
        failed++;
      } finally {
        await page.close();
      }
    }

    console.log('');
    console.log(`📊 結果: ${success} 成功 / ${failed} 失敗 / ${screenshots.length} 合計`);
    console.log(`📁 保存先: ${OUTPUT_DIR}`);

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
