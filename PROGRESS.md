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

### 2026-04-14（追加）決算書を税務署式5ページ構成に再構築
- **やったこと**:
  - DBマイグレーション `20260414_company_info_opening_balances.sql` を本番DBに適用
    - `clients` に `company_code`（会社番号、英数字8文字以内）/ `legal_name`（正式名）/ `short_name`（略称）追加
    - `clients` に `UNIQUE(user_id, company_code) WHERE company_code IS NOT NULL` 部分インデックス
    - `fiscal_periods` に `opening_balances JSONB` 追加（科目名 → 期首残高）
  - `/api/clients` に PATCH 追加・GET/POST/PATCH で会社情報3項目を扱えるように
  - クライアント管理モーダルを4項目フォーム + 編集/削除UIに再構築。表示は `{company_code} {short_name}` 形式
  - `/api/fiscal-periods/[id]` に PATCH 追加（name/dates/opening_balances 更新）
  - `/api/fiscal-periods/[id]/calculate-opening` 新設：期首日より前の全仕訳から B/S 残高 + 過去PL純利益（→繰越利益剰余金）を自動算出
  - `/api/financial-statement` を refactor：`opening_balances` を加味した B/S 構築 + 株主資本等変動計算書データ（純資産科目別の opening/change/ending）を返却
  - 決算書ビュー `FinancialStatementView` を全面書き換え：
    - 期編集パネル（期首残高の手動入力 + 自動算出ボタン）追加
    - 印刷出力を **5ページ構成**に：表紙 / 貸借対照表 / 損益計算書 / 販管費内訳書 / 社員資本等変動計算書
    - A4縦・明朝体・実線格子テーブル・均等割り付け風タイトル・(単位：円) 表記の税務署式レイアウト
    - `@media print` で `break-after: page` による確実な改ページ
    - 印刷時の注意（ヘッダー/フッターOFF・背景グラフィックON）を画面に表示
- **背景**: 税理士事務所への提出を想定した日本式決算書フォーマット（決算報告書セット）の出力が必要だった。画像5枚を貼ってもらってレイアウトを確定。会社情報の管理（会社番号での絞り込み・正式名/略称の使い分け）も合わせて整備
- **次にやること**: ユーザーが実データでログインして 決算書 タブ → 期選択 → 期首残高自動算出 → 決算書を生成 → PDF出力 まで通しで動作確認。レイアウトの微調整があれば対応

### 2026-04-14（修正）期首残高エディタを科目選択式に・貸借チェック・反映バグ対策
- **やったこと**:
  - 表紙/各ページのヘッダー会社名を `legal_name` のみに変更。未設定なら「（正式名未設定）」と警告表示（`name` フォールバックを廃止）
  - 期首残高エディタの科目名を **テキスト入力 → ドロップダウン**（B/S 科目だけに絞った勘定科目マスタから選択）に変更。タイポによる silent drop を防止
  - エディタに「+ 新規科目を追加」ボタン追加。科目名 + 中区分（B/S 6択）を指定して `addAccountLocal` 経由で `/api/accounts` に POST し、追加直後に編集行に挿入
  - エディタに **貸借バランスチェック**（資産合計 / 負債+純資産合計 / 差額）をリアルタイム表示。差額0なら緑、それ以外は黄警告
  - `/api/financial-statement` を改修：opening_balances のうちマスタ未登録 / 中区分未設定の項目を `invalidOpeningBalances` として返却。決算書下に **赤い警告ボックス**で「決算書に反映されていない」旨を明示（過去のタイポ入力もこれで気付ける）
- **背景**: 「期首残高を編集しても決算書に反映されない」「ふてう預金など typo でエラー（=silent drop）になる」「貸借が一致しているか確認したい」というユーザーからの指摘。根本原因は API 側で `accountMap.get(name)?.sub_category` が null の opening を `continue` で黙って捨てていたこと。ドロップダウン化で入力時点で防止し、API 側でも警告を返すように二重防御
- **次にやること**: ユーザーに通しテストを依頼。会社情報未設定の既存クライアントは「クライアント管理」から正式名 (legal_name) を必ず入力する必要がある

### 2026-04-14 20:28 科目区分の入力必須化と編集時の即時反映
- **やったこと**:
  - `AccountCombobox` の「+ 新規追加」パネル: 区分3択（未設定/販管費/売上原価）→ **全 SUB_CATEGORY_OPTIONS のドロップダウン + 必須化**。確定ボタンを `!sub_category` で無効化
  - マスタ画面 `MasterView` の新規追加フォーム: 区分を「任意」→「必須」に。`handleAddAcc` は既存同名再利用ケースでも必ず PATCH で sub_category を上書き
  - `MasterRow` の sub_category select: `value={item.sub_category}` 直結だと PATCH→reload までの間に React の controlled component が旧値に巻き戻る → **ローカル state + useEffect で同期** に変更（楽観更新）
  - `addAccountLocal`: `expenseSubs` ハードコードを廃止し、全 sub_category → category 逆引きテーブルに置換（売上高/特別損失なども正しく分類）
  - `fetchAccounts`: `cache: 'no-store'` を追加（PATCH 直後の GET でブラウザキャッシュを回避）
- **背景**: ユーザーから「マスタで販管費→売上原価に切り替えても見た目が戻る」「仕訳編集で新規科目を追加するとき区分が未設定でも登録できてしまう」との指摘。前者は controlled component の楽観更新漏れ、後者は単純なバリデーション抜け
- **次にやること**: マスタ画面で実際に切り替えて、リロード後も値が保持されているか確認してもらう

## 2026-04-14 (未照合入出金タブ追加)
- やったこと:
  - 「仕訳実行」「日記帳」の間に **「未照合」タブ** を追加（`journalSubView = 'unmatched'`）
  - 新コンポーネント `UnmatchedView`（app/page.tsx 内）: `journalMatchResult.summary.unmatchedTransactions` を表示
  - チェックボックスで複数選択 → 上部の一括適用バーから **借方科目** と **摘要** をまとめて反映
  - 科目は既存 `AccountCombobox` を利用（新規科目追加もそのまま可能）
  - 摘要は行ごとにも上書き可能（空欄なら元摘要を使用）
  - CSV 出力時に `unmatchedTxDescriptions[idx] ?? tx.description` を使うよう変更
  - 仕訳実行タブ末尾の旧パネルは削除し、「未照合タブへ誘導するバナー」に差し替え
  - `journalSubView === 'unmatched'` を広幅レイアウト対象に追加（max-w-[1280px]）
- 背景/理由: ユーザー要望「通帳と照合しなかった入出金を見える化し、複数選択で同じ科目・摘要を一括入力したい」
- 次にやること: 実ブラウザで照合実行 → 未照合タブでの一括適用 → CSV ダウンロードまで通しで動作確認

## 2026-04-14 
- やったこと: 勘定科目マスタを区分順ソート + 科目/取引先マスタに検索ボックスと重複検出を追加
  - `app/page.tsx` MasterView: `SUB_CATEGORY_OPTIONS` の順（流動資産→固定資産→繰延資産→流動負債→…→販管費→…）で並び替え、同区分内は reading/name の昇順
  - 科目マスタ・取引先マスタそれぞれに検索入力欄（名前・読み・区分で絞り込み）
  - 同名（trim+lowercase）で重複している行に赤バッジ + 行背景、ヘッダーに重複件数
- 背景/理由: 区分がバラバラに並んでいて見辛いのと、同じ科目を複数作ってしまっていないかチェックしたいという要望
- 次にやること: 実ブラウザで並び順と検索・重複バッジの見え方を確認

## 2026-04-14 (残高タブに期間フィルタ)
- やったこと:
  - `BalanceView` に開始日/終了日の date input を追加
  - クイック切替: 全期間 / 今月 / 先月 / 今年度（4月始まり）
  - entry_date (YYYYMMDD) を文字列比較で範囲フィルタ → computeBalances に渡すエントリを事前に絞る
  - 現在の期間ラベルと「対象 N / 全 M 件」を表示
  - 該当0件時の空表示も対応
- 背景/理由: ユーザー要望「残高はいつからいつの残高か指定できるようにして」

## 2026-04-15 (自動仕訳の計上方式3択 + 摘要モード + OCR履歴連携)
- やったこと:
  - **計上方式を3択に拡張**: ①現金主義 / ②請求書日（発生主義） / ③役務提供月末（`monthEnd`）
    - `lib/ocr/journal-matcher.ts`: `AccountingMethod = 'accrual' | 'cash' | 'monthEnd'` に追加、`matchVouchersToTransactions` を `MatchOptions` 受付に変更（後方互換あり）
    - 月末計上モードは `voucher.periodEnd` を最優先、無ければ請求書日を月末化して費用計上
    - `extractPeriodEndFromVoucher()` を新設: 「〇月分」「2/1~2/28」「YYYY-MM」等を regex 抽出
  - **摘要モードを2択に**: `DescriptionMode = 'vendor' | 'full'`、`buildDescription` を刷新。
    - `full` で複数行のときは「最初の行 ほか」にまとめる（ユーザー指定のライン数ベース）
  - **自動仕訳UI**: 計上方式の3択 + 摘要モード2択ラジオを追加。月末計上モード選択時は照合前に期間確認モーダルを出し、自動抽出した末日を手修正できる
  - **journal_entries に `bank_ocr_upload_id` 追加**（マイグレーション適用済 / index 付き）
  - **match-journal API**: payment 行の通帳 upload_id を accrual/payment 双方にコピーして保存
  - **日記帳UI**: 既存の請求書PDFアイコンに加えて **通帳PDFアイコン（IconArchive, lime色）** を並べて表示。`/api/journal-pdf?source=bank` を新設（既存を拡張）
  - **履歴ページを一般ユーザーにも開放**: `/api/history` と `/history` から admin チェックを外し、誤アップロード修正のため本人は自分の履歴を見られるように
    - ヘッダの「履歴」ボタンも常時表示に変更
    - admin 向けの OCR 補正フォームのみ `isAdmin` でガード
  - **履歴ページに操作UI追加**:
    - 「このOCRから作られた仕訳を一括削除」ボタン（締め済みはスキップ）
    - 「紐付け法人を変更」ドロップダウン（ocr_uploads + 派生 journal_entries を一括で付け替え、締め済みはスキップ）
  - 新 API: `app/api/history/[id]/route.ts`（DELETE / PATCH）
- 背景/理由: ユーザー要望
  - 「自動仕訳で簡易〜複雑まで選べるようにしたい」→ 計上方式3択・摘要モード2択
  - 「間違えて別会社の請求書を取り込んでしまったら修正したい」→ 一括削除 + 別法人紐付け
  - 「通帳OCR・請求書OCRで読んだものを自動仕訳に連携」→ 日記帳の各仕訳から元の請求書/通帳PDFを直接開けるように（履歴からの呼び出し型ではなく、仕訳側に通帳をリンク）
- 次にやること:
  - 実ブラウザで 3 計上方式 × 2 摘要モードの組合せを通しで動作確認
  - 月末計上モードで実請求書（「3月分」「3/1~3/31」等）の抽出精度を検証
  - 履歴ページの一括削除・別法人紐付けが締めロックを正しく尊重するか確認

## 2026-04-15 16:50
- やったこと: エラー報告2件（仕訳照合画面）に対する全9項目の実装
  - #1/#8: 仕訳照合画面の借方/貸方を AccountCombobox 化（編集 + 新規科目作成）
  - #2/#7: `account_rules` テーブル新規 + `/api/account-rules` CRUD + ルール適用エンジン
    - 相手先ルール: vendor_normalized_key で借方科目を上書き（matcher 前段）
    - 摘要ルール: 未照合取引に対する科目自動提案（UnmatchedView 連携）
    - 日記帳の各行に「🏷️相手先」「🏷️摘要」ボタンでルール化（編集時に即追加）
    - マスタ画面にルール一覧セクション（種別・パターン・科目 + 追加/削除）
  - #3: エラー報告モーダルを position:fixed 絶対位置で背景透過、ヘッダをドラッグで移動可能
  - #4: `VoucherInput.withholdingTax` を追加。matcher がネット金額で照合し、振替仕訳「未払費用/預り金」を自動生成。請求書OCR後の `<details>` UI で voucher ごとに源泉税を入力
  - #5: 同一相手先合算パス。未照合 voucher を vendor_key でグルーピングし、合計金額で残り通帳取引との照合を再試行（`matchVouchersToTransactions` 出力を API 側で post-process）
  - #6: サブビュータブバー右横に「エラー報告」ボタンを常駐（全サブビューで使える）
  - #9: 部分登録フロー。`/api/match-journal` に `save:false` を追加し、照合時は DB 保存しない。新 `/api/journal-entries/persist-match` が選択済みの voucher グループだけを保存。フロント側はチェックボックス + 「選択を登録 / 残り全て登録」ボタン
- 背景/理由: 実務フィードバックに基づく。特に源泉税・合算払・ルール記憶は会計事務所の手作業を大幅に削減するコア機能
- 次にやること / 未解決:
  - 預り金の第2段階照合（後日の税務署支払い）はまだ未照合タブで手動割当 → ルール化候補
  - MasterView のルール一覧、正規化後パターンの見え方がやや分かりづらいので UI 調整余地あり
  - 部分登録後に `journalMatchResult` を再マッチせず表示し続けているが、ページ遷移で state が消える点は要検討（draft テーブル化が将来の検討事項）

## 2026-04-15 17:20
- やったこと: 追加2項目の実装
  - 預り金の自動照合: matcher API に post-pass を追加。voucher.withholdingTax>0 の各結果について、残りの通帳出金で金額一致＋計上日以降 の取引があれば `withholdingPaymentEntry` (預り金/普通預金) を自動生成。MatchResult 型に `withholdingPaymentEntry?: PaymentEntry` を追加し、テーブル・CSV・persist-match・save の全経路で反映
  - 部分登録後の未登録仕訳を未照合タブで可視化: MatchResultTable に `onlyUnregistered` フィルタ prop を追加。未照合タブに「未登録の仕訳 N 件」セクションを常駐させ、そこからも「選択を登録 / 残り全て登録 / 仕訳実行タブへ」が呼べる
- 背景/理由: 1件目の対応で手動照合を求めた箇所を自動化。未登録仕訳は journalMatchResult state のみに保存されているのでタブ遷移で失われる心配はないが、未照合タブに集約して見やすくした
- 次にやること / 未解決:
  - 預り金の照合条件はまだ「金額一致＋日付 ≧ 計上日」のみ。複数の源泉を同じ税務署への1本にまとめて納付するケースは未対応（合算照合の拡張が必要）
  - ページ完全リロード時は state が消えるため、継続運用するなら draft テーブルが必要

## 2026-04-15 (固定資産・減価償却 実装)
- やったこと:
  - 新マイグレーション `20260415_fixed_assets_depreciation.sql`: `fixed_assets`（3区分 / 定額法のみ実装）、`accounting_rules`（期間履歴で間接法/直接法切替 + 月次/年次）、`accounts.fixed_asset_type` 追加、`journal_entries` に `source_fixed_asset_id` + `depreciation_period` 追加
  - API: `/api/fixed-assets` GET/POST, `/api/fixed-assets/[id]` GET/PATCH/DELETE, `/api/accounting-rules` GET/POST/DELETE, `/api/depreciation/generate` POST（月次/年次・append/overwrite モード）, `/api/depreciation/check` GET（理論値との差分）
  - `/fixed-assets/[id]` 詳細登録画面（別タブ想定）を新設
  - `persist-match` 改修: 借方が固定資産科目の仕訳を検出したら `fixed_assets` に `status='pending'` で自動連番登録し、フロントに `newAssets` を返す
  - フロント (`app/page.tsx`): persist-match の返り値を見て `window.open('/fixed-assets/[id]')` を一括オープン。BalanceView に「固定資産」セクション（3区分ごと小計 + 資産1行展開 + 新規登録フォーム）、減価償却仕訳生成パネル（期間/タイミング/モード）、会計ルール設定パネル、期末整合チェックを追加
- 背景/理由: 税理士実務向けに固定資産の残高管理・自動償却仕訳が必須。ユーザー要望は「取得仕訳は仕訳画面、詳細は別タブ、年度末決算仕訳 or 月次決算の選択、重複計上防止、期末整合チェック」
- 次にやること / 未解決:
  - **定率法・生産高比例法が未対応**（必須・memory にも TODO 記録済み）
  - Supabase SQL Editor で `20260415_fixed_assets_depreciation.sql` を**手動実行する必要あり**
  - 固定資産除却 (disposed) のフローは UI 未実装（売却/除却仕訳との連動）
  - 会計ルール変更時、過去に生成済みの償却仕訳を再計算する仕組みは未実装（手動で overwrite 再生成が必要）

## 2026-04-15 #2 (固定資産: 定率法・除却売却・ルール再計算)
- やったこと:
  - Supabase MCP 経由で `20260415_fixed_assets_depreciation` マイグレーション適用（migration ファイル側も disposal_date/disposal_type/disposal_amount カラム追加で同期）
  - `lib/depreciation/calculator.ts` 新設: `straight_line` / `declining_balance` (新200%定率) / `declining_balance_old` (旧定率法: `1 - (10%/取得価額)^(1/n)` 近似) の月次償却計算を共通化
  - `/api/depreciation/generate` を calculator.ts ベースに全面書き換え（年次/月次 × append/overwrite の既存ロジックは維持）
  - `/api/depreciation/check` も calculator.ts 経由に変更
  - `/api/depreciation/recalc` 新設: 会計ルール変更時の再計算。`mode=rewrite` (期間内償却仕訳を削除→最新ルールで再生成) と `mode=adjust` (既存は保持し差額のみ開始日に一括修正仕訳) を選択
  - `/api/fixed-assets/[id]/dispose` 新設: 除却 (`retired`) / 売却 (`sold`) を判定し、累計額消込 + 固定資産除却損/売却損益を自動生成。間接法/直接法は当日有効の accounting_rule を参照
  - `app/fixed-assets/[id]/page.tsx`: 定率法・旧定率法を選択可能に（生産高比例法は disabled のまま）
  - `app/page.tsx`:
    - 新 state `consumedUnmatchedIdx: Set<number>`: 売却時に消し込んだ未照合入金の元配列インデックスを保持
    - UnmatchedView の transactions prop をこの state でフィルタ → 売却紐付け後は未照合リストから消える
    - FixedAssetSection に「処分」ボタン + ダイアログ追加。売却モード時は入出金明細の credit>0 を select で選択可能、選択時に journal_entry に `bank_ocr_upload_id` が紐付き、同時に `onConsumeUnmatched(idx)` で未照合から除外
    - 会計ルールパネルに「再計算」パネル追加（期間 / モード選択 / 実行ボタン）
- 背景/理由: 前回の実装で TODO に残っていた定率法・除却/売却・ルール再計算を対応。ユーザー要望「売却仕訳で消し込んだ入出金明細が未照合に残らないようにする」を `consumedUnmatchedIdx` でセッション内で解決
- 次にやること / 未解決:
  - **定率法の税法厳密性**: 改定償却率・保証率・国税庁償却率表は未対応（memory: project_todo_depreciation_declining.md）
  - **生産高比例法**: enum のみ、実装なし（memory: project_todo_depreciation_units.md）
  - `consumedUnmatchedIdx` はセッション state なのでページリロードで消える（永続化するなら bank_tx テーブル側にフラグ列が必要）
  - 会計ルール変更時の自動起動は未実装。手動で「再計算を実行」ボタンを押す必要あり
  - 有形除却時に固定資産台帳ページから「取消」する動線なし（手動で journal_entries から該当 entry_type='disposal' を削除 + status を戻す必要）

## 2026-04-15 14:00
- やったこと:
  - サイト経由で送られたエラー報告（journal-entry モード 2件・計4項目 ※軽いUI系のみ）に対応
  - `handlePersistSelected` に欠陥チェック追加: 日付/金額/借方/貸方のいずれかが未入力の仕訳は登録不可（項目一覧を alert 表示）
  - 仕訳照合テーブルを `table-fixed` + `colgroup` 化し `min-w-[960px]` を撤廃 → 横スクロール解消（文字サイズはそのまま）
  - 計上行の 日付/金額/摘要 をインライン編集可能化（これまで表示のみ）、各行に「× 削除」、グループ末尾に「+ 行を追加」ボタン
  - PDFプレビューを「アプリ内モーダル」→「別ウインドウ（window.open + iframe）」に変更。ポップアップブロック時は従来モーダルにフォールバック
- 背景/理由: 複数の請求書・通帳を見比べたいのに、モーダルは1枚ずつしか開けないため
- 次にやること / 未解決:
  - 残り2項目（②口座マスタ機能 / ④源泉税自動検知）は別PRで対応予定
  - 887gkTU003 の通帳OCR→仕訳連携ボタン不在の件は ② 口座マスタ実装時に動線を見直す

## 2026-04-15 15:30
- やったこと:
  - 口座マスタ機能（②）: `bank_accounts` テーブル新設、`/api/bank-accounts` GET/POST、通帳OCR後に「口座 → 預金科目」設定パネル追加。保存すると次回OCR時に自動復元、仕訳照合時に貸方科目として使用
  - 源泉税自動検知（④）: `lib/ocr/invoice-ocr.ts` のプロンプトに `withholdingTax` フィールド追加（請求書に明示されている場合のみ抽出、推測はしない）。OCR後に `withholdingTaxBuf` に自動プリフィル、UI に「OCR自動検知 N件」バッジ表示
  - `TransactionInput` に `bankAccountName` フィールド追加、matcher・match-journal の合算・源泉パスで `creditAccount` を `tx.bankAccountName || '普通預金'` に変更
- 背景/理由: 887gkTU003 のように複数口座を持つクライアントで「この口座はその他預金、あの口座は普通預金」と分けたい。源泉税は手動入力がADHD的に抜けがちなのでOCR自動化
- 次にやること / 未解決:
  - 口座マスタのGETで `client_id NULL` と `client_id 指定` の両方をフォールバック表示するかは未決（現状は指定clientだけ）
  - 源泉税プロンプトの精度は本番データで要検証。請求書に記載ない支払報酬は null（手動入力）のまま

## 2026-04-15 16:00
- やったこと:
  - 確定申告OCR (`lib/ocr/tax-return-ocr.ts`) の `PROMPT_TAX_RETURN` を全面刷新。documentType の選択肢を6種→約35種に拡充（申告書本体/決算書/控除明細/源泉徴収票/控除証明書/消費税/本人確認 にカテゴリ分け）。該当なしの場合は `"その他（実際の書類名）"` 形式で必ず実書類名を含める指示を追加
- 背景/理由: 2026-04-14 アップロード分（横川綾乃 令和7年 31p / 26件）を Supabase の `ocr_uploads.ocr_result` で確認したところ、26件すべて documentType="その他" に倒れていた。旧プロンプトの選択肢が「確定申告書A/B、青色決算書、収支内訳書、医療費控除明細書、寄附金控除証明書、源泉徴収票、その他」しかなく、現実の控除証明書群（生保/地震/年金/iDeCo/ふるさと納税 等）を全部その他で吸ってしまっていた
- 次にやること / 未解決:
  - 横川さんPDFで再OCR検証（既存PDFは Storage `ocr-uploads/9e73d4fa-.../1776159849997________.pdf` に保存済み）
  - 拡充後も「その他」になる書類があれば追加カテゴリ検討

## 2026-04-16 16:30
- やったこと:
  - **#2 エラー報告FAB修正**: `ErrorReportFab` から `pathname === '/'` 除外を削除し、確定申告モード等メインページ上でもFABを表示。01/02/03ステップガイドを `invoice`/`tax-return` モード限定に変更（通帳・仕訳・BS/PLモードでは非表示）
  - **#3 法人紐づけ変更時の確認ダイアログ**: `app/history/page.tsx` の `handleReassignClient` に `window.confirm` 追加。旧法人名→新法人名と仕訳移動の旨を表示し、キャンセル可能に
  - **#1 既存OCRデータから再照合機能**: 4ステップ分離の第一弾
    - `GET /api/ocr-uploads?clientId=xxx`: 法人別OCRアップロード一覧（通帳・請求書、仕訳件数付き）
    - `POST /api/ocr-uploads/load`: 指定アップロードのOCR結果を一括取得
    - 仕訳実行タブに「新規アップロード / 既存データから再照合」切替UIを追加
    - 既存OCRデータを選択→bankOcr/invoiceOcr復元→口座マスタ自動紐付け→照合実行が可能に
- 背景/理由: 会社PCからのエラー報告3件（確定申告でFABが出ない、法人紐づけ変更が確認なし、既にOCR済みデータで再照合ができない）への対応
- 次にやること / 未解決:
  - 実ブラウザで既存データ再照合フローの通しテスト
  - 再照合時に旧仕訳を自動削除するかどうかのUX改善（現在は手動削除が必要）

## 2026-04-16 21:00
- やったこと: 仕訳CSVインポート機能を追加
  - `lib/csv-import-presets.ts`: 弥生会計・freee・マネーフォワードの列マッピングプリセット + CSVパーサー
  - `app/api/journal-entries/import/route.ts`: CSVインポートAPIエンドポイント（認証必須、500件バッチ挿入）
  - `app/page.tsx` LedgerView: 日記帳タブにCSVインポートモーダル追加（ソフト選択→ファイル選択→プレビュー→一括挿入）
  - データが空の状態でもインポートボタンを表示
  - entry_type='manual', match_status='imported' で挿入
- 背景/理由: 弥生からの仕訳移管のため、どのPCからでもCSVをアップロードしてインポートできるようにしたい
- 次にやること / 未解決:
  - 実際の弥生CSVで動作テスト（列名が想定通りかの確認）
  - 重複インポート防止（同一CSVの二重取り込み検知）は未実装

## 2026-04-16 22:00
- やったこと: エラー報告8件を確認・対応済み6件を resolved に更新・未対応3件を修正
  - **重複アップロード自動除外**: `ocr_uploads.file_hash` (SHA-256) カラム追加。`/api/process-pdf` でハッシュ照合→409 DUPLICATE_FILE を返却。フロント側はスキップして残りファイルを続行
  - **摘要ボタン途切れ修正**: 日記帳テーブルに `min-width: 1100px` + `overflow-x-auto` を設定。固定列幅を圧縮し摘要列に十分な幅を確保。ルール化ボタンをアイコンのみ（🏷️/📝）に変更
  - **仕訳照合画面から通帳PDF閲覧**: 費用計上行に🏦ボタンを追加し、照合された通帳PDFを別ウインドウで開けるように
  - **法人紐づけ変更時の仕訳処理選択**: 履歴ページの法人変更時に「1=移動 / 2=削除」の選択式に変更。API側も `deleteEntries` オプション対応
  - **再照合時の旧仕訳自動削除**: 既存データ読み込み時に「旧仕訳を削除してから再照合するか」を確認ダイアログで選択可能に
- 背景/理由: サイト経由のエラー報告（4/15〜4/16分）への対応。重複アップロードは実運用で同じPDFを間違えて二重取り込みするケースが発生していた
- 次にやること / 未解決:
  - 重複検知はSHA-256ベースなので、同一内容で名前だけ違うファイルも検知される（意図通り）。ただし「強制的に再アップロード」するUIはまだない
  - 法人紐づけ変更後の再照合フローの通しテスト

## 2026-04-16 13:00
- やったこと:
  - **エラー報告にsite_nameカラム追加**: 複数サイトからのエラー報告が混在する問題を解決。`error_reports`テーブルに`site_name`列追加、管理画面にサイト名バッジ＋フィルタ機能を追加。Vercel環境変数`NEXT_PUBLIC_SITE_NAME=aiocr`を設定
  - **履歴画面にカテゴリタブ追加**: 左サイドバーに「請求書／入出金明細／確定申告書／すべて」のフィルタタブを追加
  - **履歴詳細に紐づく仕訳一覧を表示**: 各アップロードの詳細パネルに、`journal_entries`テーブルから`ocr_upload_id`/`bank_ocr_upload_id`で紐づく仕訳を取得・表示（日付・借方/貸方・金額・照合ステータスなど）
- 背景/理由: ユーザーからのエラー報告2件への対応（#1: 履歴画面の改善要望、#2は別プロジェクト）
- 次にやること / 未解決: 他プロジェクトにも`ErrorReportFab`を設置している場合、各`.env.local`とVercelに`NEXT_PUBLIC_SITE_NAME`を設定する必要あり

## 2026-04-17 15:00
- やったこと:
  - **大容量PDF時のJSONパースエラー修正**: Vercelのボディサイズ上限（4.5MB）を超えるPDFアップロード時に非JSONレスポンス（"Request Entity Too Large"）が返り、`res.json()` が `Unexpected token` エラーを出していた。全4箇所の `/api/process-pdf` fetch呼び出しで try-catch を追加し、ユーザーにわかりやすいエラーメッセージ（「4MB以下のPDFをお試しください」）を表示
  - **確定申告モードでクライアント選択を非表示**: 確定申告は個人のみ対象のため、`mode === 'tax-return'` 時はクライアント選択バーを非表示にし、タブ切替時に `selectedClientId` をリセット
  - **大容量PDF自動分割機能**: 3.5MB超のPDFをpdf-libでページ単位に自動分割し、チャンクごとにAPIへ順次送信。全モード（請求書・確定申告・通帳OCR・自動仕訳）に対応。`lib/pdf-split.ts` を新規追加
  - **PDF分割にページ数上限(10ページ/チャンク)追加**: ファイルサイズが小さくてもページ数が多いPDFで処理が途中で切れる問題に対応
  - **モード表示明示化**: 結果ヘッダーに「確定申告モード」「請求書・領収書モード」バッジを追加。ふるさと納税PDFを請求書モードで処理してしまうミスを防止
  - **重複チェックにmode条件追加**: 同じPDFでもモード違い（請求書→確定申告）なら再処理可能に
- 背景/理由: エラーレポート3件への対応（トークンエラー＋確定申告の法人選択問題＋ふるさと納税のモード誤り）

## 2026-04-17 18:30
- やったこと:
  - **ファイル名の年度表記を西暦統一**: 確定申告モードで「令和7年」と「2025年」が混在していたのを、`convertToSeireki()`関数で和暦→西暦に自動変換するよう修正
  - **ファイル名の「不明_不明_」解消**: yearとtaxpayerNameが不明の場合は省略し「(要対応)_01_p2_その他.pdf」形式に簡潔化
  - **4MB超PDFの表示欠け根本修正**: APIレスポンスにbase64 PDFを含めるとVercelの4.5MB制限に抵触する問題を、クライアント側PDF抽出方式に変更。チャンク分割時にpageOffsetを追跡し、APIはメタデータのみ返却→ブラウザ側でpdf-libを使い元ファイルからページ抽出
  - **OCR結果CSV保存機能追加**: 請求書・確定申告モードの結果テーブルをCSVでエクスポートするボタンを追加。一旦保存→調整→会計ソフトインポートのワークフローに対応
- 背景/理由: エラーレポート3件への対応（CSV保存要望＋4MB超データ欠け＋ファイル名表記問題）
  - **仕訳CSVのSupabase保存機能追加**: 自動仕訳で生成したCSVを`ocr-uploads`バケットに保存するAPI(`/api/journal-csv`)を新設。`saved_csvs`テーブルでメタデータ管理。DLは`/api/journal-csv/download?path=...`。会計ソフトインポート前にPC上で分析・修正するワークフローに対応
  - **ファイル名の(要対応)も削除**: year/name不明時は連番+ページ+書類名のみ
  - **CSVインポートエラー時のCSV送信機能**: インポート失敗時に「CSVを送信して対応依頼」ボタンを表示。CSVファイル+会計ソフト名+エラー内容を`error_reports`に記録（category=csv-import）。管理者がDL・分析して新プリセット追加可能
