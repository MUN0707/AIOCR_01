# Progress

## 2026-05-08 14:00
- やったこと:
  - web画面エラー報告 3件対応（aiocr）→ commit a194122
  - 総勘定元帳ページ（app/general-ledger/page.tsx）: account/日付フィルタをAPIに渡さずlimit=50で集計していたバグを修正。科目選択時はaccount+from/toをAPIに渡しlimit=100000で全件取得するよう変更。科目一覧はjournal-balance APIから取得
  - DB: 重複インデックス削除（ocr_upload_id x2, voucher_group_id x2）＋複合インデックス(user_id, client_id, entry_date)追加で残高読み込み高速化
  - 日記帳ビュー（app/page.tsx）: 借方/貸方フィルタ入力後Enterを押すと「その科目の総勘定元帳を開く」ボタンが表示される
  - error_reports を resolved に更新: 8ea4ba7e, f54ba132, e68833fa

- 背景:
  - 8ea4ba7e（集計ミス）: 総勘定元帳がlimit=50でaccountフィルタなしのため10000件中50件しか集計せず数値が狂っていた
  - f54ba132（読み込み遅い）: インデックス不足＋重複インデックスのI/O無駄
  - e68833fa（科目フィルタ+元帳リンク）: 日記帳から総勘定元帳への導線不足

## 2026-05-08 17:00
- やったこと: 会計ソフト強化 🔴1〜4 を一気に実装
  - 🔴1: 消費税区分(tax_category)を仕訳に追加（4区分・セレクト・バッジ）commit 7d79a51
  - 🔴2: 消費税集計レポートページ（/tax-summary）- 本則課税計算・未分類警告 commit e83c07e
  - 🔴3: 顧問先に適格請求書登録番号（T+13桁）追加 commit 5307fa7
  - 🔴4: 電子帳票保存管理ページ（/edocuments）- 電帳法3要件 commit 52379df
  - 全件 Supabase マイグレーション適用済み・Vercel デプロイ済み

- 次にやること:
  - 🔴5: キャッシュフロー計算書（決算書の第3書類）
  - 🟡6: 売掛金・買掛金の消込管理
  （以降ロードマップ順）

## 2026-05-08 15:30
- やったこと: 会計ソフト強化ロードマップ策定 + 消費税区分(tax_category)実装
  - 足りない会計機能17項目を優先度付きで整理
  - journal_entries に tax_category カラム追加（課税売上/非課税売上/課税仕入/免税・不課税）
  - 仕訳一覧に「消費税区分」列追加（セレクトで編集、カラーバッジで表示）
  - PATCH API allowed リスト更新、CSVエクスポート対応、Supabase マイグレーション適用
  - commit: 7d79a51 / デプロイ済み

- 次にやること:
  - 🔴2: 消費税集計レポート（課税売上高・課税仕入高の集計。申告書向け）
  - 🔴3: インボイス（適格請求書）発行機能
  - 🔴4: 電子帳簿保存法対応
  - 🔴5: キャッシュフロー計算書
  （以降ロードマップ順に継続）

- 残り未対応（他プロジェクトの報告）:
  - 8cf4384e / d6eef3ee: inheritance-tax-chat（表現・タブ構成改善）
  - b6e86d88: taxbestsearch（スマホUI）
  - 1a8f8292: taskhub（スマホタイトル）

## 2026-05-08 （続き）
- やったこと:
  - 上記残り4件の報告対応 → 全件 resolved 更新済み
  - inheritance-tax-chat（8cf4384e / d6eef3ee）→ commit 595e832
    - TrustDiagnosis.tsx: Q1タイトル「親の判断能力」→「ご本人の判断能力」に変更
    - ProductsClient.tsx: タブ順を「生前贈与・資産管理会社・家族信託」に変更（隣接化）
  - taskhub（1a8f8292）→ commit b71041d
    - fitProjectGrid() にモバイル早期return追加（JS インラインstyleがCSSを妨害していた）
    - .project-header-name / .progress-task-title のモバイルフォントサイズ縮小
  - taxbestsearch Header.tsx（b6e86d88）→ commit b19d9be
    - ヘッダーnavをモバイルで「マッチング」のみ表示・他はsm以上で表示に
    - ボタンサイズをモバイルでtext-xs/py-1に縮小
  - merumaga-tax dashboard layout.tsx（b6e86d88）→ commit 7d3b7cf
    - navをモバイルで縦積み・sm以上で横並びに変更
    - 「契約・請求書」「お問い合わせ」「法人名」はsm以上でのみ表示

## 2026-05-08 （新セッション）
- やったこと: 🔴5〜🟡8 を一気に実装
  - 🔴5 キャッシュフロー計算書 → commit 533b827
    - GET /api/cash-flow（間接法）、DecisionReportPaper に第6ページ追加
  - 🟡6 売掛金・買掛金の消込管理 → commit 9af6fd2
    - ar_ap_records / ar_ap_payments テーブル追加（Supabase マイグレーション）
    - GET/POST /api/ar-ap、PATCH/DELETE /api/ar-ap/[id]、POST/DELETE /api/ar-ap/[id]/payments
    - /ar-ap ページ: タブ切替・消込・部分消込・支払期日超過赤字警告
  - 🟡7 補助科目 → commit 971dcaf
    - accounts.parent_account_id 追加（自己参照FK）
    - 科目マスタに階層表示・「補助+」ボタン・補助科目インライン追加フォーム
  - 🟡8 仕訳テンプレート・繰り返し仕訳 → commit fc60b55
    - journal_templates テーブル追加（Supabase マイグレーション）
    - GET/POST /api/journal-templates、DELETE/POST /api/journal-templates/[id]
    - /templates ページ: テンプレート管理・起票UI
    - 日記帳操作バーに「テンプレート」リンク追加（amber色）

- 次にやること:
  - 🟡10: 全銀データ出力 → commit d2e5f13（実装済み）
    - company_settings テーブル、vendors に銀行情報カラム追加
    - GET/PUT /api/company-settings、GET /api/zengin-export（Shift-JIS 全銀フォーマット）
    - /zengin ページ（自社銀行設定・取引先銀行情報・ファイルDL）
    - 買掛金管理ページに「全銀出力」ボタン
  - 🟢11: 部門管理（次セッション以降）
  （以降ロードマップ順）

## 2026-05-08 （新セッション・続き）
- やったこと: 🟢11 部門管理を実装 → commit 54869de
  - departments テーブル追加（Supabaseマイグレーション適用済み）
  - journal_entries に department_id カラム追加
  - GET/POST /api/departments、PATCH/DELETE /api/departments/[id]
  - GET /api/department-report（部門別損益: revenue/expense/profit 集計）
  - /departments ページ: 部門一覧管理 + 期間指定の部門別損益レポート
  - 日記帳テーブルに「部門」列追加（インライン select で仕訳から直接設定可）
  - 日記帳操作バーに「部門管理」リンク追加（indigo色）

- 次にやること:
  - 🟢12: 予算管理（予算 vs 実績比較レポート）→ commit 10c79f1（完了）
  - 🟢13: 資金繰り表
  - 🟢14〜17: 以降ロードマップ順

## 2026-05-08 （続き）
- やったこと: 🟢12 予算管理を実装 → commit 10c79f1
  - budgets テーブル追加（Supabaseマイグレーション適用済み）
  - GET/POST /api/budgets（重複時は既存行をUPDATE）、DELETE /api/budgets/[id]
  - GET /api/budget-report（科目別・月別の予算 vs 実績・達成率）
  - /budget ページ: 予算入力（月別+年間一括12等分）+ 実績比較（月指定/年合計）
  - 日記帳操作バーに「予算管理」リンク追加（teal色）
- 次にやること:
  - 🟢13: 資金繰り表（月次資金繰り予測）

## 2026-05-08 （続き）
- やったこと: 🟢13 資金繰り表 → commit e3aaede
  - GET /api/cash-projection（現金科目を名前パターンで自動検出・月別収支明細）
  - /cash-projection ページ: サマリーカード・月別テーブル・内訳展開・残高マイナス赤表示
  - 日記帳操作バーに「資金繰り」リンク追加（emerald色）

## 2026-05-08 （続き2）
- やったこと: 🟢14〜17 承認フロー・監査証跡・CSVエクスポート・ユーザーロール管理 → commit 1062781
  - 🟢14 仕訳承認フロー:
    - journal_entries.approval_status カラム追加（マイグレーション適用済み）
    - journal_audit_logs テーブル追加（PATCH/DELETE 時に before/after スナップショット記録）
    - client_members テーブル追加
    - PATCH/DELETE API に void service.from('journal_audit_logs').insert(...) でログ追加
    - POST /api/journal-entries/[id]/approve（action: approved/rejected/draft/pending）
    - LedgerEntry インターフェースに approval_status 追加
    - 仕訳テーブルに「承認」列追加（ApprovalBadge/ApprovalCellコンポーネント）
    - 承認済: lime色バッジ、承認待・草稿: 承認/却下ボタン表示
  - 🟢15 監査証跡:
    - GET /api/audit-log（clientId/entryId/limit フィルタ）
    - /audit-log ページ: DataDiff（before→after差分表示）・作成/変更/削除バッジ
  - 🟢16 ユーザーロール:
    - GET/POST/DELETE /api/client-members（approver/entry/viewer ロール管理）
    - /user-roles ページ: 顧問先別メンバー追加・削除・ロール説明
  - 🟢17 CSVエクスポート:
    - GET /api/export?format=freee|yayoi|mf（BOM付きCSV・日付範囲・顧問先フィルタ）
  - アクションバーに「監査証跡」（violet）「CSV出力」（orange）「ユーザー管理」（rose）追加
  - colSpan 11→12（承認列追加分）
  - TypeScript エラー修正（then().catch() → void）

- 次にやること:
  - ロードマップ全17項目が完了（🔴1-5, 🟡6-10, 🟢11-17）
  - 残課題: OCR命名ルール改善・確定申告OCR精度・減価償却定率法精度

## 2026-05-13 ユーザー目線レビュー結果（次セッション以降のUI改善タスク）

- やったこと: 会計ソフト全体をユーザー目線でレビュー。機能網羅性は高いが「初見で使えない」状態。改善点を優先度付きで整理し、次セッションのタスクとして登録（TaskHub 同期済み）
- 背景: 🟢11〜17 を一気に積んだ結果、page.tsx 10,553行・操作バーにチップ15個・共通ナビ無し・モバイル対応ほぼゼロ・/guide が旧プラン名のまま、という状態。機能の網羅性 vs 情報設計(IA) のバランスが崩れている

### 🔴 重大（次セッション最優先）
1. **共通レイアウト・サイドナビの導入** — `app/layout.tsx` に「日次／月次／期末／管理」のサイドバー。チップ15個地獄を解消し、各サブページの「← 日記帳に戻る」を廃止
2. **メイン操作バーのチップ整理** — `app/page.tsx:5301-5380` の15個の多色チップを、カテゴリ別グルーピング＋ブランド2色（sky/lime）へ削減
3. **/guide 更新** — `app/guide/page.tsx` は OCR分割の説明のみ。会計機能（仕訳・部門・予算・資金繰り・承認・電子帳票）を追記。旧プラン名「ヘビープラン」を現行プラン名に修正
4. **モバイル対応（最低3画面）** — 日記帳／残高／仕訳実行をスマホで使える状態に。現状 `sm:hidden` 等が page.tsx 内に4箇所しかない

### 🟡 中
5. **手動仕訳入力UIの明示化** — 振替伝票入力（OCR/CSV経由でない素の仕訳追加）の入口が見つけにくい
6. **`target="_blank"` 見直し** — 操作バーリンクの9個が新規タブ。1日業務でタブ10枚溜まる。共通シェル導入後に SPA 遷移へ
7. **初回オンボーディングウィザード** — 顧問先→会計期間→期首残高→勘定科目→部門/補助 の順序を提示するセットアップ画面

### 🟢 小（まとめて1タスク）
8. **細部改善** — (a) クライアント未選択時の表現統一（「共通」「全員」「個人」がバラバラ）/ (b) confirm() → モーダル / (c) エラー報告ボタンをグローバルFABへ / (d) テーブル列幅ハードコード見直し / (e) 監査色とロール色の凡例衝突 解消

### 次々セッション以降の予約
9. **マルチユーザ視点レビュー（次セッション）** — `client_members` テーブルはあるが招待メールフロー無し・API は `eq('user_id', user.id)` 縛りで実質1ユーザー1テナント構造。レビューで深掘り
10. **販売・差別化戦略レビュー（次々セッション）** — 会計ソフト3強（freee/弥生/MF）に対する強みと差別化ポイントを整理

- 次にやること:
  - 次セッションでまず🔴1（共通レイアウト導入）から着手
  - その前に「マルチユーザ視点レビュー（タスク9）」を先にやるかはユーザー確認

## 2026-05-14 マルチユーザ視点レビュー + 販売・差別化レビュー

- やったこと: 前セッション予約のタスク9（マルチユーザレビュー）とタスク10（販売・差別化レビュー）を一気に実施。TaskHub に 19 件登録（[MU🔴1〜5] [MU🟡6〜11] [MU🟢12〜14] [SALES⚡A〜E]）
- 背景: 次セッションで UI 改善（共通レイアウト等）に着手する前に、構造的問題（マルチテナント・販売戦略）を棚卸ししておく必要があった

### マルチユーザレビューの主要発見
- 🔴 重大: RLS が `journal_entries` / `accounts` / `vendors` / `clients` / `budgets` / `departments` / `edocuments` / `journal_audit_logs` / `client_members` / `ar_ap_records` / `journal_templates` で**未設定**。authenticated キーで直接 SQL を投げれば全件参照・改ざんが可能。マルチユーザ展開のブロッカー
- 🔴 client_members テーブルは作成済みだが招待メールフロー無し・API は全 `eq('user_id', user.id)` でオーナー縛り → 招待された member ユーザーは何も見られない「飾り状態」
- 🔴 journal_audit_logs への insert が `void` 呼び出しでエラー欠落リスク
- 🔴 client_id = NULL（共通マスタ）が複数ユーザー間で相互汚染しうる設計
- 🔴 ADMIN 権限が ENV メール 1 個のハードコード比較のみ
- 🟡 process-pdf の clientId 無検証 / bulk-delete の client_id 一貫性チェック無し / accounts 科目名変更の N+1 / journal-ledger limit 100,000 / PLAN_LIMITS ハードコード / ゲスト fingerprint 使い回し対策薄

### 販売・差別化レビューの結論
- ポジション: **「OCR起点の税理士向けクラウド会計」** — freee/MF/弥生にはない体験順序の逆転
- 売り文句6点: ①AI OCR精度（Claude）②PDF束分割というユニークペイン解決 ③TKCの1/10価格 ④電帳法・インボイス・消費税区分 標準装備 ⑤監査証跡・承認フロー ⑥CSV出力でロックインしない
- **避けるべき訴求**: 銀行API連携・e-Tax・人事労務・経費精算（freee/MFの最強領域、敵の土俵）
- 1行訴求案: 「OCRスタートで作られた、税理士事務所のための小回りクラウド会計。電帳法・インボイス・監査証跡まで標準装備で、月¥3,980」
- 売る前に埋めるべき弱み 5 件（[SALES⚡A〜E]）: 通帳OCR再パッケージ / e-Tax非対応の説明線引き / モバイル対応 / 1事例獲得 / サポート即応化

### 関連
- memory に「銀行API連携訴求を避ける理由」を保存（`memory/project_sales_avoid_bank_api.md`）
- TaskHub 全 19 件登録（priority 1: 5件 / priority 2: 11件 / priority 3: 3件）

- 次にやること:
  - ユーザーがレビュー結果を確認 → 着手順序を決定
  - 優先候補: [MU🔴1] RLS 導入（マルチユーザ展開のブロッカーかつ単独で完結可）／🔴1 UI改善（共通レイアウト）／[SALES⚡A] 通帳OCR訴求の LP 改修

## 2026-05-14 [MU🔴1] RLS 一括導入 → 完了

- やったこと: マルチユーザレビューで最優先課題だった RLS（Row Level Security）導入を完了 → commit b5136eb / push 済み
  - **実態調査結果**: レビュー時の想定は「全コアテーブル未設定」だったが、実際に RLS 完全無効だったのは 4 テーブル（departments / budgets / journal_audit_logs / client_members）のみ。その他は RLS 有効だがポリシー未定義で service role 経由でしか動かない状態
  - **対応範囲（15 テーブル）**:
    - RLS 有効化 + owner ポリシー追加: departments / budgets / journal_audit_logs / client_members
    - 多層防御 owner ポリシー追加（RLS は既に有効）: journal_entries / accounts / vendors / ar_ap_records / ar_ap_payments / journal_templates / company_settings / journal_closings / journal_match_logs
    - 危険な qual=true 公開ポリシーを置換: ocr_uploads / ocr_corrections
  - **マイグレーション**: `supabase/migrations/20260514_enable_rls_and_owner_policies.sql`（Supabase MCP の apply_migration で適用済み）
  - **全ポリシー仕様**: `roles=authenticated`, `auth.uid()=user_id`（client_members のみ `owner_user_id`）。`FOR ALL` で SELECT/INSERT/UPDATE/DELETE 一括
  - **検証**: tsc EXIT=0、Supabase Advisor 上の 15 テーブル分の警告 0 件、pg_policies で 15 ポリシー作成確認
  - **API への影響なし**: API ハンドラは `createServiceClient` 経由でアクセスしており、service role は PostgreSQL の RLS bypass 仕様により全ポリシーをスキップする

- 背景:
  - service role 経由前提なので「攻撃者が anon キーで直接 Supabase に SQL を投げる」シナリオが主たる脅威
  - 4 テーブルだけは RLS 無効だったため、anon キーから budgets/departments/journal_audit_logs/client_members の全件参照・改ざんが可能だった（重大）
  - 他のテーブルはポリシー無しのため anon からは触れないが、service role が漏れた瞬間に防御層がなくなる構造だったので、多層防御として owner ポリシーを追加した
  - レビュー時の想定誤り（範囲）は memory ではなく Progress.md にだけ残す（恒久的な事実ではないため）

- 次にやること:
  - [MU🔴2] client_members を実権限化（招待トークン + メンバーが参加 client_id にアクセスできるポリシー）— 招待フローと共通権限ヘルパーをセットで実装
  - or 当初予定の UI 改善（共通レイアウト / チップ整理 / /guide 更新 / モバイル対応）
  - or [SALES⚡A] 通帳 OCR 訴求の LP 改修


## 2026-05-17 [/guide ページ更新] → 完了

- やったこと:
  - `app/guide/page.tsx` に「OCR と連動する会計機能」セクションを新設（commit b42ba9f）
  - 6 機能カードを 2 列グリッドで配置。それぞれ該当ページへの Link 化
    - 仕訳・総勘定元帳 (`/general-ledger`)
    - 部門管理 (`/departments`)
    - 予算管理 (`/budget`)
    - 資金繰り・CF予測 (`/cash-projection`)
    - 承認フロー・監査証跡 (`/audit-log`)
    - 電子帳票・電帳法対応 (`/edocuments`)
  - 旧プラン名「ヘビープラン」を 2 箇所修正
    - ステップ02 note: `ヘビープランは両モード対応` → `全プランで両モード対応`
    - 対応書類 確定申告書類 note: `ヘビープランのみ` → `全プラン対応`

- 背景:
  - 5/14 のマルチユーザレビュー「次にやること」UI 改善カテゴリの 1 タスクを消化
  - 会計機能群（部門/予算/資金繰り/承認/電帳法）は実装済みなのに /guide では一切触れられておらず、見込み客に価値が伝わっていなかった
  - 旧プラン名は pricing 比較表（確定申告モードは全プラン ✓）と不整合

- 検証:
  - `npx tsc --noEmit` EXIT=0
  - 差分: 1 file changed, +62 / -2 lines

- 次にやること:
  - [SALES⚡A] 通帳 OCR 訴求の LP 改修 / 共通レイアウトの整理 / モバイル対応 など、UI改善カテゴリの残タスク

- TaskHub 同期: 元プロジェクト `mmqri0ck8q9z1` 内の既存タスク `dd5b4e14-a3ab-4f48-a271-69bf8b74dc67` を `completed=true` に更新。最初に GET の取り回しを誤って「消失した」と誤認し新プロジェクト `62a0ce07-...` を重複作成したが、確認後に重複を DELETE し `.taskhub` を `mmqri0ck8q9z1` に復元済

## 2026-05-17 [初回オンボーディングウィザード /onboarding] → 完了

- やったこと:
  - 新規ページ `app/onboarding/page.tsx` を新設（commit 00c7288, +848 行）
  - 5 ステップウィザード:
    1. 顧問先（会社名 / 正式名称 / 会社番号 / インボイス登録番号）→ POST /api/clients
    2. 会計期間（期名 / 期首 / 期末。3月決算デフォルト）→ POST /api/fiscal-periods
    3. 期首残高（現金・普通預金・売掛金・買掛金・資本金・繰越利益剰余金 等 9 科目のプリセット）→ PATCH /api/fiscal-periods/{id} で opening_balances JSONB に保存
    4. 勘定科目（既存科目一覧 + 追加フォーム）→ POST /api/accounts
    5. 部門/補助科目（1画面で両方）→ POST /api/departments / POST /api/accounts (parent_account_id)
  - プログレスバー + ステップインジケータ（sky-500 / lime-500 グラデ）
  - 自動リダイレクト: `app/page.tsx` 1247 行付近の clients fetch に `localStorage.aiocr_onboarding_done` 判定を追加。clients=0 件 + 未完了なら router.replace('/onboarding')
  - ヘッダ「あとで設定する →」ボタン + Step2 以降は「スキップ」ボタンで離脱可能
  - 完了画面 → メイン (/) へ「OCR を始める」/ /guide へのリンク

- 背景:
  - 5/14 のマルチユーザレビュー「次にやること」UI 改善カテゴリのタスク（中優先度）
  - 新規ログイン後の手順が分散しており「最初に何をやるか」が不明という指摘

- 検証:
  - `npx tsc --noEmit` EXIT=0
  - `npx eslint app/onboarding/page.tsx` EXIT=0
  - `npx next build` 成功、`/onboarding` が ○ (static) として登録
  - 既存 `app/page.tsx` の `react-hooks/set-state-in-effect` エラーは事前から存在（line 8595/HEAD）。今回の変更は無関係

- 次にやること:
  - TaskHub 該当タスクの completed 化
  - 本番（Vercel auto-deploy）で動作確認

## 2026-05-17 [手動仕訳入力UI（振替伝票入力）の明示化] → 完了

- やったこと:
  - 新規 API `app/api/journal-entries/route.ts`（POST）追加: 手動仕訳1件登録用エンドポイント。`entry_type='manual'` / `match_status='manual'` / `voucher_group_id` 自動生成 / 締め日チェック / 監査ログ記録 (action='created')
  - `app/page.tsx` ヘッダ部分にフローティング「+ 新規仕訳」ボタンを追加（fixed bottom-6 right-6 z-40・sky-400・全ビュー共通・ログインユーザーのみ表示）
  - 振替伝票入力モーダル（max-w-lg）: 日付（今日デフォ）/借方科目/貸方科目/金額/摘要/消費税区分/取引先 の7フィールド
  - 借方/貸方は既存 `AccountCombobox`（科目マスタ連動＋新規追加）、取引先は datalist で `vendorsList` から候補補完
  - 保存成功時 `bumpLedgerRefresh()` で日記帳ビューを即時リフレッシュ

- 背景:
  - 5/14 のマルチユーザレビュー「次にやること」UI 改善カテゴリ（🟡 重要）: OCR/CSV/銀行明細経由の登録動線はあるが、純粋な振替伝票入力の入口が見つけづらいという指摘
  - 「日記帳に + 新規仕訳 ボタン」の元案を全ビュー共通フローティングに格上げ（ユーザー選択）

- 検証:
  - `npx tsc --noEmit` EXIT=0
  - `npx next build` 成功、`/api/journal-entries` が新規 ƒ (Dynamic) ルートとして登録
  - 既存の `react-hooks/set-state-in-effect` エラー（line 8868）は事前から存在、無関係

- 次にやること:
  - TaskHub 該当タスクの completed 化
  - 本番（Vercel auto-deploy）で動作確認
