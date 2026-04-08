# API仕様書 — Invoice OCR

> 全エンドポイントの詳細仕様

---

## 共通仕様

### ベースURL

- 本番：`https://invoice-ocr-tawny.vercel.app`
- 開発：`http://localhost:3000`

### 認証

Supabase Auth のセッションCookieを使用します。ブラウザからのリクエストは自動的にCookieが付与されます。

```
Cookie: sb-{project-ref}-auth-token=...
```

### 共通エラーレスポンス

```json
{
  "error": "エラーメッセージ（日本語）"
}
```

| ステータスコード | 意味 |
|----------------|------|
| 400 | リクエストが不正 |
| 401 | 未認証 |
| 403 | 権限なし（管理者限定エンドポイント等） |
| 429 | 月次使用量の上限に達した |
| 500 | サーバー内部エラー |

---

## エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| POST | `/api/process-pdf` | PDFをOCR処理して分割データを返す | 任意 |
| POST | `/api/match-journal` | 証票と入出金を照合する | 任意 |
| GET | `/api/usage` | 当月の使用量情報を取得 | 必須 |
| GET | `/api/admin/subscriptions` | 全サブスクリプション一覧を取得 | 管理者 |
| PATCH | `/api/admin/subscriptions` | サブスクリプションを管理操作 | 管理者 |
| GET | `/api/subscription/status` | 自分のサブスク状態を取得 | 必須 |
| POST | `/api/subscription/bank-transfer` | 銀行振込による申込 | 必須 |
| GET | `/auth/callback` | OAuthコールバック（Supabase内部） | — |

---

## POST /api/process-pdf

PDFをアップロードしてAI OCR処理を行います。モードに応じて請求書・確定申告・通帳のデータを返します。

### タイムアウト

最大60秒（Vercel Fluid Compute有効化時は最大800秒）

### リクエスト

**Content-Type:** `multipart/form-data`

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `pdf` | File | ✓ | PDFファイル（最大50MB） |
| `mode` | string | — | `invoice`（デフォルト）/ `tax-return` / `bank-statement` |

**例（JavaScript）：**
```javascript
const formData = new FormData();
formData.append('pdf', pdfFile);
formData.append('mode', 'invoice');

const response = await fetch('/api/process-pdf', {
  method: 'POST',
  body: formData,
});
```

---

### レスポンス（mode: invoice）

**Status: 200 OK**

```json
{
  "mode": "invoice",
  "totalPages": 8,
  "invoices": [
    {
      "index": 1,
      "pageStart": 1,
      "pageEnd": 2,
      "date": "20260115",
      "requesterName": "株式会社サンプル",
      "taxIncludedAmount": 110000,
      "fileName": "001_20260115_株式会社サンプル_110000円.pdf",
      "pdfBase64": "JVBERi0xLjQK...",
      "sourceFile": "請求書まとめ.pdf"
    },
    {
      "index": 2,
      "pageStart": 3,
      "pageEnd": 5,
      "date": "20260120",
      "requesterName": "テスト商事株式会社",
      "taxIncludedAmount": 55000,
      "fileName": "002_20260120_テスト商事株式会社_55000円.pdf",
      "pdfBase64": "JVBERi0xLjQK...",
      "sourceFile": "請求書まとめ.pdf"
    }
  ]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `mode` | string | 処理モード |
| `totalPages` | number | 元PDFの総ページ数 |
| `invoices` | array | 識別された請求書の配列 |
| `invoices[].index` | number | 連番（1始まり） |
| `invoices[].pageStart` | number | 開始ページ（1始まり） |
| `invoices[].pageEnd` | number | 終了ページ（1始まり） |
| `invoices[].date` | string | 請求日（YYYYMMDD）または`"不明"` |
| `invoices[].requesterName` | string | 請求元名称 |
| `invoices[].taxIncludedAmount` | number\|null | 税込合計金額（円） |
| `invoices[].fileName` | string | ダウンロード用ファイル名 |
| `invoices[].pdfBase64` | string | 分割済みPDFのBase64 |
| `invoices[].sourceFile` | string | 元PDFのファイル名 |

---

### レスポンス（mode: tax-return）

**Status: 200 OK**

```json
{
  "mode": "tax-return",
  "totalPages": 12,
  "invoices": [
    {
      "index": 1,
      "pageStart": 1,
      "pageEnd": 4,
      "year": "令和5年分",
      "taxpayerName": "山田太郎",
      "documentType": "確定申告書B",
      "totalIncome": 8500000,
      "taxPayable": 650000,
      "fileName": "001_令和5年分_山田太郎_確定申告書B.pdf",
      "pdfBase64": "JVBERi0xLjQK...",
      "sourceFile": "申告書まとめ.pdf"
    }
  ]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `invoices[].year` | string | 申告年度（例: `"令和5年分"`） |
| `invoices[].taxpayerName` | string | 納税者氏名 |
| `invoices[].documentType` | string | 書類種別（例: `"確定申告書B"`） |
| `invoices[].totalIncome` | number\|null | 総所得金額（円） |
| `invoices[].taxPayable` | number\|null | 納付税額（円） |

---

### レスポンス（mode: bank-statement）

**Status: 200 OK**

```json
{
  "mode": "bank-statement",
  "bankName": "三菱UFJ銀行",
  "accountNumber": "****1234",
  "totalPages": 3,
  "transactions": [
    {
      "date": "20260110",
      "description": "ｶﾌﾞｼｷｶｲｼｬAAA 請求書支払",
      "debit": 110000,
      "credit": null,
      "balance": 2890000
    },
    {
      "date": "20260115",
      "description": "給与振込",
      "debit": null,
      "credit": 500000,
      "balance": 3390000
    }
  ]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `bankName` | string | 銀行名 |
| `accountNumber` | string | 口座番号（マスク表示が多い） |
| `transactions` | array | 取引明細の配列 |
| `transactions[].date` | string | 取引日（YYYYMMDD）または`"不明"` |
| `transactions[].description` | string | 摘要 |
| `transactions[].debit` | number\|null | 出金金額（円） |
| `transactions[].credit` | number\|null | 入金金額（円） |
| `transactions[].balance` | number\|null | 残高（円） |

---

### エラーレスポンス

**400 Bad Request — ファイルなし**
```json
{ "error": "PDFファイルが見つかりません" }
```

**400 Bad Request — 非PDFファイル**
```json
{ "error": "PDFファイルのみ対応しています" }
```

**429 Too Many Requests — 月次上限到達**
```json
{ "error": "今月の処理上限（50件）に達しました。プランのアップグレードをご検討ください。" }
```

**500 Internal Server Error**
```json
{ "error": "PDF処理中にエラーが発生しました" }
```

---

## POST /api/match-journal

請求書データ（証票）と通帳データ（入出金）を照合して、仕訳候補を生成します。

### タイムアウト

最大30秒

### リクエスト

**Content-Type:** `application/json`

```json
{
  "vouchers": [
    {
      "id": "v001",
      "date": "20260110",
      "vendorName": "株式会社サンプル",
      "amount": 110000
    }
  ],
  "transactions": [
    {
      "id": "t001",
      "date": "20260110",
      "description": "ｶﾌﾞｼｷｶｲｼｬAAA 請求書支払",
      "debit": 110000,
      "credit": null
    }
  ]
}
```

**vouchers（証票リスト）：**

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `id` | string | ✓ | 一意識別子（任意の文字列） |
| `date` | string | ✓ | 請求日（YYYYMMDD） |
| `vendorName` | string | ✓ | 相手先名称 |
| `amount` | number | ✓ | 税込金額（円） |

**transactions（入出金リスト）：**

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `id` | string | ✓ | 一意識別子 |
| `date` | string | ✓ | 取引日（YYYYMMDD） |
| `description` | string | ✓ | 摘要 |
| `debit` | number\|null | ✓ | 出金金額 |
| `credit` | number\|null | ✓ | 入金金額 |

**バリデーション：**
- `vouchers` と `transactions` が両方空配列の場合は400エラー
- 一方のみ空でも処理可能

---

### レスポンス

**Status: 200 OK**

```json
{
  "results": [
    {
      "voucherId": "v001",
      "transactionId": "t001",
      "score": 0.9,
      "status": "auto",
      "scoreDetail": {
        "amount": 0.6,
        "date": 0.3,
        "name": 0.0
      }
    },
    {
      "voucherId": "v002",
      "transactionId": "t003",
      "score": 0.5,
      "status": "needs_review",
      "scoreDetail": {
        "amount": 0.4,
        "date": 0.1,
        "name": 0.0
      }
    },
    {
      "voucherId": "v003",
      "transactionId": null,
      "score": 0.0,
      "status": "unmatched",
      "scoreDetail": {
        "amount": 0.0,
        "date": 0.0,
        "name": 0.0
      }
    }
  ],
  "summary": {
    "total": 3,
    "auto": 1,
    "needs_review": 1,
    "unmatched": 1
  }
}
```

**results の各フィールド：**

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `voucherId` | string | 証票ID |
| `transactionId` | string\|null | 照合された取引ID（未照合時はnull） |
| `score` | number | 総合スコア（0.0〜1.0） |
| `status` | string | `auto` / `needs_review` / `unmatched` |
| `scoreDetail.amount` | number | 金額スコア（最大0.6） |
| `scoreDetail.date` | number | 日付スコア（最大0.3） |
| `scoreDetail.name` | number | 名前スコア（最大0.1） |

**statusの判定基準：**

| status | スコア条件 | 意味 |
|--------|-----------|------|
| `auto` | score ≥ 0.7 | 高精度で一致 → 自動照合 |
| `needs_review` | 0.4 ≤ score < 0.7 | 要確認 → 人が確認して承認 |
| `unmatched` | score < 0.4 または候補なし | 未照合 → 手動で対応が必要 |

---

### エラーレスポンス

**400 Bad Request**
```json
{ "error": "証票データまたは入出金データが必要です" }
```

---

## GET /api/usage

ログイン中のユーザーの当月使用量情報を返します。

### 認証

必須（未認証時は401）

### リクエスト

パラメータなし

```http
GET /api/usage HTTP/1.1
Cookie: sb-xxxx-auth-token=...
```

### レスポンス

**Status: 200 OK**

```json
{
  "count": 23,
  "limit": 50,
  "plan": "light",
  "status": "active",
  "yearMonth": "2026-04"
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `count` | number | 当月の処理済み件数 |
| `limit` | number | 当月の上限件数（プラン別） |
| `plan` | string | `light` / `heavy` |
| `status` | string | `trial` / `active` / `pending` / `inactive` |
| `yearMonth` | string | 対象月（YYYY-MM形式） |

**planとlimitの対応：**

| plan | status | limit |
|------|--------|-------|
| light | active | 50 |
| heavy | active | 200 |
| any | trial | 50 |

### エラーレスポンス

**401 Unauthorized**
```json
{ "error": "Unauthorized" }
```

---

## GET /api/admin/subscriptions

全ユーザーのサブスクリプション情報を取得します。

### 認証

管理者のみ（ADMIN_EMAIL と一致するアカウント）

### リクエスト

パラメータなし

### レスポンス

**Status: 200 OK**

```json
{
  "subscriptions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "a1b2c3d4-...",
      "email": "user@example.com",
      "plan": "light",
      "status": "active",
      "payment_method": "bank_transfer",
      "trial_ends_at": "2026-04-10T00:00:00+09:00",
      "subscription_start_at": "2026-04-01T00:00:00+09:00",
      "subscription_end_at": "2026-06-01T00:00:00+09:00",
      "created_at": "2026-04-01T10:30:00+09:00",
      "updated_at": "2026-04-01T11:00:00+09:00",
      "monthly_usage": 23
    }
  ]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | string | サブスクリプションのUUID |
| `user_id` | string | SupabaseのユーザーUUID |
| `email` | string | ユーザーのメールアドレス |
| `plan` | string | `light` / `heavy` |
| `status` | string | `trial` / `active` / `pending` / `inactive` |
| `payment_method` | string | `bank_transfer` / `stripe` |
| `trial_ends_at` | string\|null | トライアル終了日時（ISO8601） |
| `subscription_start_at` | string\|null | サブスク開始日時（ISO8601） |
| `subscription_end_at` | string\|null | サブスク終了日時（ISO8601） |
| `created_at` | string | レコード作成日時（ISO8601） |
| `updated_at` | string | レコード更新日時（ISO8601） |
| `monthly_usage` | number | 当月の処理件数（usage_logsから結合） |

### エラーレスポンス

**403 Forbidden**
```json
{ "error": "Forbidden" }
```

---

## PATCH /api/admin/subscriptions

サブスクリプションの状態を管理操作します。

### 認証

管理者のみ

### リクエスト

**Content-Type:** `application/json`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "action": "activate"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `id` | string | ✓ | サブスクリプションのUUID |
| `action` | string | ✓ | 実行するアクション（下記参照） |

**action の種類：**

| action | 処理内容 |
|--------|---------|
| `activate` | ステータスを`active`に変更、開始日=現在、終了日=2ヶ月後 |
| `extend` | 終了日を現在の終了日から2ヶ月延長（未設定時は現在から2ヶ月） |
| `deactivate` | ステータスを`inactive`に変更 |

### レスポンス

**Status: 200 OK**

```json
{ "success": true }
```

### エラーレスポンス

**400 Bad Request — パラメータ不足**
```json
{ "error": "id と action は必須です" }
```

**400 Bad Request — 不正なaction**
```json
{ "error": "不正な action です" }
```

**403 Forbidden**
```json
{ "error": "Forbidden" }
```

**500 Internal Server Error**
```json
{ "error": "DB更新エラーのメッセージ" }
```

---

## GET /api/subscription/status

ログイン中のユーザー自身のサブスクリプション状態を取得します。

### 認証

必須

### レスポンス

**Status: 200 OK**

```json
{
  "plan": "light",
  "status": "active",
  "trial_ends_at": null,
  "subscription_end_at": "2026-06-01T00:00:00+09:00"
}
```

---

## POST /api/subscription/bank-transfer

銀行振込による申込フォームの送信を処理します。

### 認証

必須

### リクエスト

**Content-Type:** `application/json`

```json
{
  "plan": "light",
  "name": "山田太郎",
  "companyName": "山田税理士事務所",
  "tel": "03-1234-5678"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `plan` | string | ✓ | `light` / `heavy` |
| `name` | string | ✓ | 申込者名 |
| `companyName` | string | ✓ | 事務所名 |
| `tel` | string | — | 電話番号 |

### 処理内容

1. subscriptions テーブルに `status: 'pending'` で新規レコードを作成
2. 振込先口座情報を含むレスポンスを返す

### レスポンス

**Status: 200 OK**

```json
{
  "success": true,
  "bankInfo": {
    "bankName": "〇〇銀行",
    "branchName": "〇〇支店",
    "accountType": "普通",
    "accountNumber": "1234567",
    "accountHolder": "ムラタ ナオマサ"
  },
  "amount": 10000,
  "description": "ライトプラン 2ヶ月分"
}
```

---

## GET /auth/callback

Supabase OAuthコールバックを処理するエンドポイントです。Googleログイン後にSupabaseから自動的にリダイレクトされます。

### 処理内容

1. URLクエリパラメータ `code` を受け取る
2. Supabase の `exchangeCodeForSession()` でセッションを確立
3. `/` にリダイレクト

このエンドポイントは直接呼び出すものではなく、Supabaseの認証フローによって自動的に呼び出されます。

---

## Supabase RPC関数

### increment_usage(p_user_id, p_year_month)

usage_logs テーブルの当月カウントをインクリメントします。レコードが存在しない場合は新規作成します（UPSERT）。

```sql
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_year_month TEXT  -- 例: '2026-04'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_logs (user_id, year_month, count)
  VALUES (p_user_id, p_year_month, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET count = usage_logs.count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**備考：** `SECURITY DEFINER` により、サービスロールと同様の権限でRLSをバイパスして実行されます。

---

## レート制限・制約

| 制約 | 値 | 説明 |
|------|-----|------|
| PDFファイルサイズ | 最大50MB | Next.js serverActions の設定 |
| APIタイムアウト（OCR） | 60秒 | Vercel 標準。Fluid Compute で800秒まで延長可能 |
| APIタイムアウト（照合） | 30秒 | 照合処理はCPUのみで完結するため短時間で終わる想定 |
| 月次OCR上限（ライト） | 50件/月 | プラン設定 |
| 月次OCR上限（ヘビー） | 200件/月 | プラン設定 |
| 月次OCR上限（トライアル） | 50件/月 | プラン設定 |
| ゲスト使用上限 | 5回 | localStorage管理（サーバー非管理） |
