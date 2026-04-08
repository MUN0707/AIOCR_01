# Invoice OCR — AI請求書PDF分割ツール

> 税理士事務所向け | 複数の請求書PDFをAIが自動解析・分割・命名するクラウドSaaS

**本番URL：** https://invoice-ocr-tawny.vercel.app/

---

## 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [主要機能](#主要機能)
3. [技術スタック](#技術スタック)
4. [ディレクトリ構成](#ディレクトリ構成)
5. [環境変数](#環境変数)
6. [ローカル開発手順](#ローカル開発手順)
7. [デプロイ手順](#デプロイ手順)
8. [アーキテクチャ概要](#アーキテクチャ概要)
9. [ビジネスモデル](#ビジネスモデル)
10. [既知の制限・TODO](#既知の制限todo)

---

## プロジェクト概要

**Invoice OCR** は、複数の請求書が1つにまとまったPDFを自動解析し、請求書ごとに分割・命名してダウンロードできるクラウドツールです。

### 解決する課題

税理士事務所では、顧客から「複数の請求書が1枚のPDFに混在した状態」でデータを受け取ることが多く、手作業での整理に1件あたり3〜5分を要していました。本ツールはこの作業を自動化し、月50件の処理を約1/50の時間で完了させます。

### 対応モード

| モード | 対応内容 | 対応プラン |
|--------|---------|-----------|
| 請求書モード | 法人請求書の自動分割・命名 | 全プラン |
| 確定申告モード | 確定申告書類の自動分割 | ヘビープランのみ |
| 通帳モード | 通帳の取引データ抽出・CSV出力 | 全プラン |

---

## 主要機能

### OCR処理
- Claude API（`claude-opus-4-6`）を使用したAI OCR
- PDFのページ単位での請求書識別
- 日付・請求元・金額の自動抽出
- 個別PDFまたはZIP一括ダウンロード

### 認証・アクセス管理
- Google OAuthによるシングルサインオン
- メール/パスワード認証（オプション）
- ゲストユーザー：5回まで無料（localStorage管理）
- 認証ユーザー：トライアル3日間（カード登録不要）

### サブスクリプション管理
- ライトプラン：¥5,000/月（2ヶ月前払い）→ 月50件
- ヘビープラン：¥10,000/月（2ヶ月前払い）→ 月200件
- 銀行振込決済（Stripe非利用）
- 管理者がSupabase経由で手動でサブスクを有効化

### 管理者機能
- サブスクリプション一覧（状態・使用量確認）
- 有効化 / 2ヶ月延長 / 無効化アクション
- 月次使用量トラッキング

### 営業LP群（トークン保護）
- `/sales` — 営業LP
- `/security` — セキュリティ説明
- `/guide` — 操作ガイド
- `/pricing` — 料金プラン
- `/faq` — よくある質問

---

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2.3 |
| スタイリング | Tailwind CSS v4 | ^4 |
| 言語 | TypeScript | ^5 |
| AI | Anthropic SDK | ^0.78.0 |
| DB/認証 | Supabase | @supabase/ssr ^0.8.0 |
| PDF操作 | pdf-lib | ^1.17.1 |
| ZIP圧縮 | JSZip | ^3.10.1 |
| ホスティング | Vercel | — |
| フォント | Inter + Noto Sans JP | next/font |

---

## ディレクトリ構成

```
◎260224_aiocr/
├── app/
│   ├── page.tsx                      # メインアプリUI（OCR処理・結果表示）
│   ├── layout.tsx                    # ルートレイアウト（フォント・メタデータ）
│   ├── globals.css                   # グローバルスタイル（Tailwind v4）
│   ├── admin/
│   │   └── page.tsx                  # 管理者ダッシュボード
│   ├── api/
│   │   ├── process-pdf/route.ts      # メインOCR処理エンドポイント
│   │   ├── match-journal/route.ts    # 証票照合エンドポイント
│   │   ├── usage/route.ts            # 使用量確認エンドポイント
│   │   ├── admin/
│   │   │   └── subscriptions/route.ts  # 管理者サブスク管理エンドポイント
│   │   ├── subscription/
│   │   │   ├── status/route.ts       # サブスク状態確認
│   │   │   └── bank-transfer/route.ts  # 銀行振込申請処理
│   │   └── auth/
│   │       └── callback/route.ts     # OAuth コールバック
│   ├── auth/
│   │   └── callback/route.ts         # Supabase 認証コールバック
│   ├── denied/page.tsx               # アクセス拒否ページ
│   ├── faq/page.tsx                  # よくある質問
│   ├── guide/page.tsx                # 操作ガイド
│   ├── login/page.tsx                # ログインページ
│   ├── pricing/page.tsx              # 料金プラン
│   ├── sales/page.tsx                # 営業LP（トークン保護）
│   ├── security/page.tsx             # セキュリティ説明（トークン保護）
│   ├── subscribe/
│   │   ├── page.tsx                  # 申込フォーム
│   │   └── success/page.tsx          # 申込完了
│   └── tokusho/page.tsx              # 特定商取引法表記
├── lib/
│   └── ocr/
│       ├── types.ts                  # 型定義（OcrMode, InvoiceInfo 等）
│       ├── invoice-ocr.ts            # 請求書OCRエンジン
│       ├── tax-return-ocr.ts         # 確定申告OCRエンジン
│       ├── bank-statement-ocr.ts     # 通帳OCRエンジン
│       ├── journal-matcher.ts        # 照合エンジン
│       └── utils.ts                  # ユーティリティ（ファイル名サニタイズ等）
├── utils/
│   └── supabase/
│       ├── client.ts                 # ブラウザ用Supabaseクライアント
│       ├── server.ts                 # サーバー用Supabaseクライアント（SSR）
│       └── service.ts                # サービスロール（RLS バイパス）
├── public/
│   └── sales-deck.pdf                # 営業説明資料
├── proxy.ts                          # Middleware（認証・トークン保護）
├── next.config.ts                    # Next.js設定
├── package.json
├── tsconfig.json
└── docs/                             # 本ドキュメント群
```

---

## 環境変数

`.env.local` を作成し、以下の変数を設定してください。

```env
# Anthropic (Claude API)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sbp_xxxx
SUPABASE_SERVICE_ROLE_KEY=sbp_service_xxxx

# Google OAuth (Supabase Auth経由)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx

# 管理者
ADMIN_EMAIL=admin@example.com

# 営業ページアクセストークン（32文字のランダム文字列推奨）
SALES_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 月額料金（表示用）
MONTHLY_PRICE=5000

# Stripe（将来実装用、現在未使用）
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxx
STRIPE_SECRET_KEY=sk_test_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx
STRIPE_PRICE_ID=price_xxxx
```

### 環境変数の取得方法

| 変数 | 取得場所 |
|------|---------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ → API Keys |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project → Settings → API |
| `GOOGLE_CLIENT_ID/SECRET` | Google Cloud Console → 認証情報 |
| `SALES_TOKEN` | 任意の32文字文字列（`openssl rand -hex 16` で生成可能） |

---

## ローカル開発手順

### 前提条件

- Node.js 20以上
- npm または yarn
- Supabaseアカウント
- Anthropic APIアカウント

### セットアップ

```bash
# 1. リポジトリをクローン
git clone <repository-url>
cd ◎260224_aiocr

# 2. 依存関係をインストール
npm install

# 3. 環境変数を設定
cp .env.example .env.local
# .env.local を編集して各値を設定

# 4. Supabaseのテーブルを作成
# → docs/DB設計書.md の「テーブル定義」セクションを参照して
#    Supabase Dashboard の SQL Editor でマイグレーションを実行

# 5. 開発サーバーを起動
npm run dev
```

開発サーバーは `http://localhost:3000` で起動します（ローカルネットワーク全体にバインド）。

### トンネル（外部アクセス）

```bash
# Cloudflare Tunnel を使用（cloudflared インストール済みの場合）
npm run tunnel
```

---

## デプロイ手順

本番環境は Vercel + Supabase の組み合わせで構成されています。

### Vercelデプロイ

```bash
# Vercel CLI を使用する場合
npx vercel --prod

# または Vercel Dashboard から GitHub リポジトリを連携
```

### Vercelの環境変数設定

Vercel Dashboard → Project → Settings → Environment Variables に `.env.local` の全変数を追加してください。

### Fluid Compute の有効化（長時間処理対応）

大きなPDFの処理に60秒以上かかる場合は、Vercel Dashboard → Functions → Fluid Compute を有効化してください（最大800秒まで対応）。

---

## アーキテクチャ概要

```
[ユーザーブラウザ]
     │
     ▼ HTTPS
[Vercel Edge / Next.js]
     │
     ├─ proxy.ts（Middleware）
     │    ├─ 認証チェック（Supabase JWT検証）
     │    ├─ 営業ページトークン保護
     │    └─ サブスク期限チェック
     │
     ├─ App Router Pages
     │    ├─ / (page.tsx) ─── OCR UI
     │    ├─ /admin ─────── 管理者ダッシュボード
     │    └─ /pricing 等 ── LP群
     │
     └─ API Routes
          ├─ /api/process-pdf
          │    ├─ Supabase（使用量チェック）
          │    ├─ Anthropic API（OCR処理）
          │    │    └─ claude-opus-4-6
          │    └─ pdf-lib（PDF分割）
          │
          ├─ /api/match-journal（照合エンジン）
          │
          ├─ /api/usage（使用量確認）
          │
          └─ /api/admin/subscriptions（管理者向け）

[Supabase]
     ├─ Auth（Google OAuth）
     ├─ subscriptions テーブル
     └─ usage_logs テーブル
          └─ increment_usage() RPC
```

### データフロー（OCR処理）

```
1. ユーザーがPDFをアップロード
2. フロントエンドが FormData で /api/process-pdf に送信
3. API側で認証ユーザーの使用量チェック（Supabase）
4. PDFをBase64エンコードしてClaude APIに送信
5. Claude が各請求書を識別してJSON返却
6. pdf-libで請求書ごとにページを切り出し
7. Base64エンコードしてフロントに返却
8. ブラウザ側でBlobに変換してダウンロード
9. 成功後、Supabaseのusage_logsをインクリメント
```

---

## ビジネスモデル

| 項目 | 内容 |
|------|------|
| 対象顧客 | 税理士事務所（法人顧客を持つ） |
| 販売方法 | 営業LP（トークン保護）からの直接申込 |
| 決済方法 | 銀行振込（2ヶ月前払い） |
| ライトプラン | ¥5,000/月 × 2ヶ月 = ¥10,000 前払い（50件/月） |
| ヘビープラン | ¥10,000/月 × 2ヶ月 = ¥20,000 前払い（200件/月） |
| トライアル | 3日間無料（カード登録不要） |
| 管理 | 管理者が振込確認後にダッシュボードで手動承認 |

---

## 既知の制限・TODO

### 既知の制限

- PDFのフォームサイズ上限：50MB（Next.js serverActions 設定）
- API タイムアウト：60秒（Vercel Fluid Compute有効化で800秒まで延長可能）
- 手書きPDFの認識精度は限定的

### 未着手TODO（PROGRESS.md より）

- [ ] 自動仕訳UI（証票 + 通帳アップロード → 照合 → 仕訳確認画面）
- [ ] CSV出力対応（弥生・freee・マネーフォワード形式）
- [ ] 組織・クライアント管理UI
- [ ] Stripe本番連携
- [ ] メール通知（申込完了・サブスク期限切れ警告）
