# Invoice OCR 進捗メモ

最終更新: 2026-04-14

---

## 本番URL

| 用途 | URL |
|------|-----|
| メインアプリ（ゲスト5回お試し可） | https://invoice-ocr-tawny.vercel.app/ |
| LP: 法人請求書OCR | https://invoice-ocr-tawny.vercel.app/lp/invoice |
| LP: 個人確定申告OCR（準備中） | https://invoice-ocr-tawny.vercel.app/lp/tax-return |
| LP: 記帳自動化（準備中） | https://invoice-ocr-tawny.vercel.app/lp/bookkeeping |
| 料金 | https://invoice-ocr-tawny.vercel.app/pricing |

### 2026-04-14 変更
- `/sales`（旧・営業トークン保護LP）を削除。`proxy.ts` の `SALES_PROTECTED` からも除外
- `/pricing` ヘッダーの「Invoice OCR」ロゴのリンク先を `/sales` → `/login` に変更
- `/lp` 配下を `proxy.ts` の公開パスに追加（ログイン・サブスク不要）
- LPは機能別に3本作成方針（1: 法人請求書OCR✅ / 2: 個人確定申告 / 3: 記帳自動化）。1本ずつ順次追加
- LP内のYouTube動画は `YOUTUBE_VIDEO_ID` 定数で差し替え可能。空の間は「動画準備中」表示

---

## 完成済み機能

### コアOCR機能
- [x] 請求書モード：PDF → Claude API → JSON解析 → pdf-lib分割 → ZIP DL
- [x] 確定申告モード（ヘビープラン向け）
- [x] OCRエンジンを `lib/ocr/` に分離（`invoice-ocr.ts` / `tax-return-ocr.ts`）

### 認証・サブスク
- [x] Supabase Auth（Google / メール）
- [x] トライアル3日間（カード登録不要）
- [x] 銀行振込サブスク管理（ライト/ヘビー）
- [x] `proxy.ts` によるサブスク状態チェック

### 営業ページ群（2026-03-30 追加 / 2026-04-14 改編）
- [x] `/lp/invoice` — 法人請求書OCR LP（公開・YouTube動画枠・CTA→`/`ゲストお試し）
- [ ] `/lp/tax-return` — 個人確定申告OCR LP（未着手）
- [ ] `/lp/bookkeeping` — 記帳自動化 LP（未着手）
- [x] `/pricing` — ライト¥5,000 / ヘビー¥10,000 + 比較表
- [x] `/security` — データフロー図・3つの約束・他手段との比較表
- [x] `/guide` — 6ステップ操作説明・ビフォーアフター試算
- [x] `/faq` — 15問アコーディオン（4カテゴリ）
- [x] `/denied` — トークンなしアクセス時の拒否ページ（`/security`・`/guide`・`/faq` 用）

### セキュリティ
- [x] `proxy.ts` にトークン保護を統合（`/security`・`/guide`・`/faq`）
- [x] 初回アクセス時クッキーセット（30日有効）→ 以降トークン不要で回遊可
- [x] 特定商取引法ページ（`/tokusho`）

### インフラ
- [x] Vercel デプロイ済み（`invoice-ocr-tawny.vercel.app`）
- [x] 環境変数をVercelに設定済み
- [x] Vercel maxDuration = 60秒

---

## 料金プラン（確定）

| プラン | 月額 | 処理件数 | 対応モード |
|--------|------|----------|-----------|
| ライト | ¥5,000 | 月50件 | 請求書のみ |
| ヘビー | ¥10,000 | 月200件 | 請求書 + 確定申告 |

- 支払い: 銀行振込（2ヶ月前払い）
- トライアル: 3日間無料（カード登録不要）

---

## 営業資料

| ファイル | 内容 |
|----------|------|
| `public/sales-deck.pdf` | Gammaで作成したセキュリティ訴求スライド |

---

## 今後のTODO（未着手）

- [x] 処理件数カウント実装（ライト50件/ヘビー200件上限・usage_logsテーブル・increment_usage RPC）
- [x] ユーザー向け使用量バー表示（メインページ・モードタブ下）
- [x] 管理画面に今月の使用量カラム追加（プログレスバー付き）
- [x] 会計DBスキーマ設計・マイグレーション（2026-04-02）
- [ ] 自動仕訳：照合エンジン実装（アルゴリズム照合）
- [ ] 自動仕訳：UI（証票＋通帳アップロード → 照合 → 仕訳確認）
- [ ] CSV出力（弥生・freee・マネーフォワード対応）
- [ ] 組織・クライアント管理UI（オンボーディング）
- [ ] Stripe 本番連携（現在は銀行振込のみ・優先度低）
- [ ] メール通知（振込確認・期限切れ前リマインド・ユーザー増えてから）
- [ ] 導入事例・実績ページ（実績できてから）

---

## 自動仕訳 設計方針（2026-04-02 確定）

### アーキテクチャ
証票OCR（invoice-ocr）と通帳OCR（bank-statement-ocr）を**別々にアップロード**し、
アルゴリズムで照合して仕訳を生成する2段階方式。

```
① 請求書アップロード → vouchers INSERT → 仕訳「費用/未払費用」自動計上
② 通帳アップロード  → bank_transactions INSERT
③ 照合実行（アルゴリズム）
   金額一致(60%) + 日付近接(30%) + 相手先名類似(10%) でスコア計算
   ・score ≥ 0.7 → 自動照合 → 仕訳「未払費用/普通預金」生成
   ・score ≥ 0.4 → 要確認（ユーザーが承認）
   ・score < 0.4 → 未照合のまま残る（= 未払費用残高）
```

### DBスキーマ（2026-04-02 マイグレーション済み）

| テーブル | 用途 |
|---------|------|
| organizations | 法人（税理士法人 / 一般会社） |
| organization_members | ユーザー↔組織の多対多（role: owner/admin/member） |
| clients | 顧問先（税理士法人→複数、一般会社→自社1件） |
| vouchers | 証票（請求書・領収書）。Supabase Storageにファイル保存 |
| bank_transactions | 入出金明細。通帳PDFからOCR |
| journal_entries | 仕訳。voucher_id / transaction_id でFK紐付け |

### マルチテナント構造
- **税理士法人**: 1組織 → N ユーザー × M クライアント
- **一般会社**: 1組織 → N ユーザー × 1クライアント（自社）

### 照合アルゴリズム（Claude APIなし・無料）
- 金額：完全一致（税込）
- 日付：請求書日付から0〜60日以内の出金
- 相手先名：正規化（株式会社除去・カタカナ統一）後の部分一致

### CSV出力（照合後）
弥生・freee・マネーフォワードそれぞれのフォーマットで出力予定

### 旧 journal-entry-ocr.ts（1PDF→仕訳）→ 削除済み方針
新設計（証票＋通帳の2段階照合）に統一。

---

## 主要ファイル構成

```
app/
├── page.tsx            — メインアプリUI
├── layout.tsx          — フォント・メタデータ
├── globals.css         — Tailwind v4 + CSS変数
├── lp/invoice/page.tsx — LP: 法人請求書OCR（公開）
├── pricing/page.tsx    — 料金プラン
├── security/page.tsx   — セキュリティ説明
├── guide/page.tsx      — 操作マニュアル
├── faq/page.tsx        — よくある質問
├── denied/page.tsx     — アクセス拒否
├── login/page.tsx      — ログイン
├── subscribe/page.tsx  — 申込
└── tokusho/page.tsx    — 特定商取引法

lib/ocr/
├── invoice-ocr.ts      — 請求書OCRエンジン
├── tax-return-ocr.ts   — 確定申告OCRエンジン
├── types.ts
└── utils.ts

proxy.ts                — Supabase認証 + 営業ページトークン保護
public/sales-deck.pdf   — 営業資料PDF
```

---

## 作業ログ

### 2026-04-14
- **やったこと**:
  - インライン科目追加ダイアログ（`AccountCombobox`）に「未設定 / 販管費 / 売上原価」の3択ボタンを追加（[app/page.tsx:3362](app/page.tsx)）
  - `addAccountLocal` に `sub_category` パラメータ追加。販管費/売上原価/営業外費用/特別損失 が選ばれたら `category='expense'` を自動付与
  - 本番 Supabase（`lonmddwpcfalgtddaksg`）に `20260414_financial_statements.sql` を適用（`accounts.sub_category` / `display_order` カラム + `fiscal_periods` テーブル作成）
- **背景**: 「sub_category カラムが schema cache に無い」エラーで科目追加が失敗していた。マイグレーションが本番DBに未適用だったのが原因
- **次にやること**: 決算書機能（P/L・B/S）の動作確認。`fiscal_periods` を使った期間指定UIがまだ未検証
