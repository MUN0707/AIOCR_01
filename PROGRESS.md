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

## 2026-05-17 [手動仕訳の派生タスク追加]

- TaskHub に派生フォローアップ 2 件を登録（作業中に気づいた既存実装との不整合）:
  - `344bf793-61d4-4b27-b34d-9285c19caf22` PATCH /api/journal-entries/:id の entry_date 形式正規化（priority=3）
  - `6cbe29cf-2b3a-47eb-ac94-7beb18b46ccd` 手動仕訳モーダルの取引先を vendors マスタへ自動登録（priority=3）

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

## 2026-05-17 [仕訳日記帳の操作バー整理 / サイドナビ新設] → 完了

- やったこと:
  - 新規 `components/JournalSidebarNav.tsx` を追加（仕訳・帳簿 / レポート / マスタ管理 / その他 の4カテゴリ・220px幅・sticky・md+ のみ表示）
  - `app/page.tsx` の LedgerView ヘッダ操作バーから 11 個のチップ（消費税集計/消込管理/テンプレート/電子帳票/部門管理/予算管理/資金繰り/監査証跡/ユーザー管理/freee CSV/その他別ページ系）をサイドナビへ移譲
  - 残ヘッダ操作バーを 3 グループ（主アクション/書き出し/ユーティリティ）に整理し、ブランド 2 色（sky 塗り＋lime 枠線）と slate ユーティリティに削減。グループ間は `w-px h-5 bg-slate-200` で縦線区切り
  - LedgerView の return を flex 2 カラム化（左=Sidebar / 右=既存コンテンツ）

- 背景:
  - 5/14 のマルチユーザレビュー「操作バーのチップ15個を整理」（🟡 重要）
  - 多色チップ（sky/violet/amber/slate/indigo/teal/emerald/violet/rose/orange/lime）が並んで視認性低下
  - 「共通レイアウト導入後にサイドナビへ移譲」方針（ユーザー判断）

- 検証:
  - `npx tsc --noEmit` EXIT=0
  - `npx eslint app/page.tsx components/JournalSidebarNav.tsx` 既存警告のみ、新規 error/warning ゼロ
  - dev server (`npm run dev`) Ready in 3s / `curl /` HTTP 200（SSR エラーなし）
  - Playwright 目視は既存ブラウザ占有でスキップ。本番 preview で要確認

- TaskHub 同期:
  - `91c2bcb7` 操作バーのチップ15個を整理 → completed:true（commit 9f3a8ec 紐付け）
  - `65ed6c17` 共通レイアウト・サイドナビ導入 → working_memo に進捗追記（LedgerView 着手済み・他10ページ展開は bc3d3599 で追跡）
  - `bc3d3599` SidebarNav を他ページへ横展開（tax-summary/ar-ap/budget等）priority=3 → 新規作成

- 次にやること:
  - 本番（Vercel auto-deploy）で目視確認: 仕訳日記帳の左サイドナビ / 操作バーの色味
  - 他ページ（/tax-summary, /ar-ap, /budget 等）への SidebarNav 横展開（TaskHub bc3d3599）

- 学び:
  - TaskHub API `/api/cli/tasks?project_id=...&completed=false` のフィルタ組合せにバグ。`&completed=false` を付けると別プロジェクトのタスクが返ってきて、本来の生成AIOCRタスクが取得できない。`&completed=false` を外して全件取得 → クライアント側で `project_id` 一致を絞り込むのが正解

## 2026-05-20 13:00 [error_reports A/B バケツ 6件対応 + 共有 Supabase 過負荷インシデント対応]

- やったこと:
  - 共有 Supabase project `lonmddwpcfalgtddaksg` が 522/504 で全 9 サイトダウン状態（pelesteia /hotels の bot による offset=29980 級の深いページネーションが原因）を発見・止血
    - `C:\Dev\260411_pelesteia\src\app\hotels\page.tsx` を `force-static` メンテ stub に差し替え（commit 6c146b5 in pelesteia repo）
    - push 後 60 秒以内に Supabase REST が 200 復帰、9 サイト復旧
  - VERCEL_TOKEN を永続化（setx + master_API一覧.xlsx 新規 Vercel シート + グローバル CLAUDE.md セクション追記）
  - aiocr の error_reports 14 件のうち A/B バケツ 6 件を修正（commit b82915a）
    - [1] d147469f: ErrorReportFab を bottom-left に移動（新規仕訳ボタンと完全重なりを解消）
    - [3] 47e8a03a: AccountCombobox 候補を name でデデュープ
    - [4] 12980b73: account_rules upsert ON CONFLICT エラー修正（SELECT→INSERT/UPDATE 分解）+ 「🏷️ ルール登録」にラベル改善
    - [6] 1b3097a2: 請求書/通帳 PDF ボタンを「📄 請求書」「🏦 通帳」ラベル付きチップ化
    - [10] d1a1729c: 自動仕訳モード時のクライアント選択「未選択（個人）」非表示化
    - [13] 8397b5f6: JournalSidebarNav から「仕訳日記帳」項目削除（上タブと重複）
  - error_reports テーブルの上記 6 件を `status='resolved'` に更新

- 背景/理由:
  - ユーザーから「エラー報告を改善して」依頼 → 未対応 error_reports の処理が本来のタスク
  - 着手直後に Supabase が全面ダウンしていることが発覚、根本原因が pelesteia の SEO 配慮不足な /hotels ページャー（force-dynamic + 全1500ページのリンク描画 + count:exact + offset+order avg_rating sort）でクローラ供給機に化けていた
  - Vercel CLI/MCP のいずれも認証なし状態だったため、Vercel ダッシュボード経由停止ではなく aiocr リポへ stub を push する形で止血
  - 「同じ Vercel トークン何回も作らされている」とのユーザー指摘でグローバル CLAUDE.md に Vercel Access Token 管理セクションを追加（Expo と同じ運用パターン）

- 残課題 / 未解決:
  - [7] b6dd7f57: 「証憑なし入出金から直接仕訳登録」機能要望 — 借方/貸方の自動補完設計（普通預金デフォルトの決定方法）が必要、C bucket として保留
  - C バケツ機能要望 7 件（[2][5][8][9][11][12][14]）の取り組み未着手
  - pelesteia /hotels を stub のままにしているため、ペット宿 SEO がダウン。**proper rewrite が必要**:
    - ウィンドウ化ページャー（1500件全リンクではなく前後±2 + 先頭/末尾）
    - `page > 50` を 404 で短絡
    - `page > 1` に robots noindex
    - `count: exact` をやめて approximate count or 別 API
    - `force-dynamic` を外して ISR 化（or RSC キャッシュ）
  - aiocr の同種 onConflict バグが match-journal/route.ts:88 と company-settings/route.ts:50 にも残存（COALESCE 式 unique index 問題）
  - **TaskHub `/api/cli/*` 全エンドポイント応答不能（5/20 発覚、グローバル CLAUDE.md 冒頭参照）** のため、当エントリは TaskHub 同期未実施

<!-- TODO: TaskHub 同期未実施: 上記の各タスクを TaskHub に正式登録する -->

## 2026-05-20 17:00 [残課題消化セッション]

- やったこと:
  - **aiocr onConflict バグ残存箇所 2件を修正** → commit 8dd6270
    - `app/api/match-journal/route.ts`: vendors の unique index は COALESCE(client_id,'') 式インデックスのため `onConflict: 'user_id,normalized_key'` が PostgREST 仕様上マッチせず upsert がサイレント失敗していた。`.insert()` + 23505 (unique_violation) のみ握り潰しに変更。あわせて newVendorRows に `client_id: clientId` を追加。
    - `app/api/company-settings/route.ts`: 純カラム unique (user_id, client_id) だが client_id NULL を distinct 扱いするため重複検知漏れ。`account_rules` 同様の SELECT → UPDATE/INSERT 分解に置換。
    - tsc EXIT=0、push 済み
  - **pelesteia /hotels の proper rewrite** → commit 2e1c784 (in pelesteia repo)
    - 5/20 メンテ stub からの正規復旧。`force-dynamic` 撤去、`MAX_PAGE=50` 超は `notFound()` で 404 短絡、`page>1` / フィルタ付き URL は robots noindex、`count: 'exact'` → `count: 'planned'` (全表 COUNT 回避)、ページャーをウィンドウ型 (1 / … / 中央±2 / … / last + prev/next) に。ヒストグラム / タグマスタは page=1 のみ計算。
    - tsc EXIT=0、push 済み
  - **[7] 「証憑なし入出金から直接仕訳登録」設計メモ作成** → memory/project_design_unmatched_to_journal.md
    - error_report b6dd7f57 / 24e9102a の関連性整理、Phase 1-4 の段階設計、貸方自動補完 3 段階 (bankAccountName → bank_accounts マスタ → 普通預金 フォールバック)、consume_status の二重登録防止案を記載。MEMORY.md にも索引追加。
  - **C バケツ 7 件 + [7] 実装本体を TaskHub に登録**:
    - [C1] 科目作成時の読み・区分・預金フラグ自動推定 (`1d6c2fec`, p=3)
    - [C2] 仕訳生成時に摘要が空になるケースの解消 (`d682b784`, p=3)
    - [C3] 端数・微差の入出金消し込み精度向上 507/1196 (`7c47c569`, p=3)
    - [C4] マスタ画面の client_id 横断表示を絞り込みオン化 (`caddcccc`, p=3)
    - [C5] クライアント設定に課税事業者フラグ + 設定 UI (`5b35540e`, p=3)
    - [C6] 法人選択ミスで作成した仕訳の救済動線（一括クライアント変更）(`21179992`, p=3)
    - [C7] 直接仕訳登録した後の事後証憑紐付け 24e9102a (`01ffa3ba`, p=3)
    - [7] 証憑なし入出金から直接仕訳登録 (実装 Phase 1-3) (`a1c0e166`, p=2)
  - TaskHub `/api/cli/*` の応答も復旧確認済み (HTTP 200 / 2.9s) — 5/20 朝の不能事象は自然解消、グローバル CLAUDE.md 冒頭セクションどおり

- 背景/理由:
  - 5/20 午前の error_reports A/B バケツ 6件対応 + pelesteia 過負荷インシデント止血の続き
  - onConflict バグは account_rules の修正と同根（COALESCE 式 unique index + PostgREST 仕様）であり、aiocr 全体で同パターンを潰し切る必要があった
  - pelesteia /hotels はメンテ stub のままだとペット宿 SEO がダウンしっぱなしになるので、ボット過負荷耐性を持たせた上で正規復旧
  - [7] 設計と C バケツ整理は「次セッションで実装に入れる準備」までを今セッションのスコープに

- 次にやること:
  - 本番 (Vercel auto-deploy) で pelesteia /hotels と aiocr の company-settings 更新動作を目視確認
  - [7] / [C1〜C7] の中から優先実装する 1〜2 件をユーザー判断で選ぶ
  - aiocr の残 open error_reports 8 件は [7] + [C1〜C7] でカバー済み（status='open' は実装着手まで残置）

## 2026-05-20 19:00 [経理担当目線レビュー→段階A〜C 一括実装]

- やったこと: 「請求書/通帳PDF→仕訳→未払金の内訳即答」の業務動線を整える3点改修
  - **段階A 振込手数料の自動判定バナー** (commit 48b495e)
    - `app/page.tsx` UnmatchedView に `isBankFeeCandidate` 判定 + 確認バナー追加
    - 条件: 出金額 100〜880円 / 11の倍数（1.1で割って整数）/ 摘要に既存vendor名なし
    - チェックボックスで個別除外可、OK で支払手数料/振込手数料を一括計上
  - **段階B vendor_id 正規化** (commit aa35169)
    - migration 20260520_journal_entries_vendor_id (適用済み): vendor_id UUID NULL + FK + index
    - `lib/vendor-resolve.ts` 新設: `resolveVendor` / `resolveVendorsBatch`（既存検索 → 無ければ insert）
    - 適用先 4 サイト: match-journal / journal-entries POST / journal-entries/import / journal-entries/persist-match
    - 旧 vendors/merge API に vendor_id 経由 UPDATE を追加（既存表記揺れ救済）
    - 既存 MasterView の「あいまい重複候補」UI で手動マージ可（findSimilarPairs ベース）
    - depreciation/dispose は vendor_name 空のため変更不要
  - **段階C ar_ap_records 廃止 / journal_entries 派生ビュー化** (commit 3f630e8)
    - migration 20260520_drop_ar_ap_records (適用済み): ar_ap_records / ar_ap_payments を DROP（事前確認 0 件）
    - GET /api/ar-ap: 買掛金/未払金/未払費用 or 売掛金/未収入金/未収金 を vendor×科目で集計
    - POST/PATCH/DELETE と payments エンドポイントは 410 Gone でスタブ化
    - /ar-ap を残高一覧+元帳ドリルダウンに全面書き換え（手入力フォーム/消込モーダル削除）

- 背景/理由:
  - レビュー観点: 「請求書OCR→未払費用ハードコード」「/ar-ap が仕訳と二重管理」「vendor_name 表記揺れで集計破綻」「振込手数料の手仕訳負荷」を経理目線で指摘
  - vendor_name の正規化は match-journal で既に部分的に行われていたが、vendor_id がないため統合操作が文字列置換に依存していた → FK 化で名寄せ後の整合が崩れない
  - ar_ap_records は OCR から自動投入されない孤立テーブルで、ユーザーが手入力する前提だったが利用 0 件 → 廃止して journal_entries 派生に統一する判断

- 検証:
  - tsc EXIT=0 / next build EXIT=0
  - ESLint 新規エラーゼロ（既存の line 8935 のみ残存）
  - Supabase migration 適用済み x 2: vendor_id 追加 / ar_ap_* DROP
  - 段階A/B/C すべて push 済み、Vercel auto-deploy で本番反映

- 次にやること:
  - 本番（Vercel）で /ar-ap の vendor×科目残高、振込手数料バナー、OCR仕訳から vendor_id 入っているかを目視確認
  - 表記揺れ既存データの統合は MasterView の「あいまい重複候補」セクションで実施
  - 既存 [7] / [C1〜C7] 未着手タスク

## 2026-05-20 16:55
- やったこと: [MU🔴3] 監査ログ失敗時にトランザクションを破棄（TaskHub a2ef2b75 対応）
  - migration `20260520_journal_entries_audit_trigger` 適用済み
    - `log_journal_entry_changes()` 関数（SECURITY DEFINER, search_path=public）
    - AFTER UPDATE / AFTER DELETE on `journal_entries` で `journal_audit_logs` を強制 INSERT
    - UPDATE 時は変更があったキーのみ before/after に格納（updated_at は除外）
  - `app/api/journal-entries/[id]/route.ts` PATCH/DELETE の `void service.from('journal_audit_logs').insert(...)` を削除
- 背景/理由:
  - 旧実装は `void` で fire-and-forget。audit insert が失敗しても本体 UPDATE/DELETE が通り、財務監査の前提（変更履歴が必ず残る）が崩れる
  - await 5xx 化案もあったが、本体は既に commit 済みで巻き戻せない → DB トリガで同 trx 内 INSERT に切替えて漏れを構造的にゼロ化
- 検証:
  - tsc --noEmit EXIT=0
  - BEGIN/ROLLBACK 付きの動作確認で UPDATE/DELETE どちらも audit_logs に before/after 付きで行が積まれることを確認
- 次にやること:
  - `app/api/journal-entries/route.ts:114` の `'created'` 用 void insert は別タスク化（INSERT トリガ追加 or await 化）

## 2026-05-20 21:35
- やったこと: メインドメイン (`ocr.taxbestsearch.com`) での password ログイン後に /login に戻される問題への cookie 修正 (commit 6329a21)
  - `utils/supabase/cookie-options.ts`: `VERCEL_ENV` 判定を `NEXT_PUBLIC_VERCEL_ENV` 優先に変更
    - `process.env.VERCEL_ENV` は server runtime のみで設定され browser bundle には展開されない仕様 → client 側で常に `secure: false` / `domain: undefined` になっていた
    - `Domain` 属性付き cookie を `Secure` 無しで書く形になり、ブラウザによっては `SameSite=Lax` + `Domain` 付きで保存拒否される
  - `proxy.ts` middleware: `setAll` の `supabaseResponse.cookies.set` で `AUTH_COOKIE_OPTIONS` をマージするように修正
    - refresh 時に domain なし cookie が並列で書かれ、後段の `getUser()` が混乱する状態を解消
  - Vercel env に `NEXT_PUBLIC_VERCEL_ENV=production` を追加 (vercel CLI で改行混入したため API 経由で再投入)
  - shared-memory `supabase_magic_link_auth.md` を最初に読まずに Magic Link 化を提案した件は反省、`memory/feedback_read_shared_memory_first.md` に再発防止メモを保存
- 背景/理由:
  - サブ (`invoice-ocr-tawny.vercel.app`) では /admin に入れたがメインでは login 画面のままループ
  - Playwright クリーンセッションでは loop も再現せず、ユーザー Chrome 固有の壊れ cookie + コード側の secure/domain 未設定バグの複合と判定
  - shared-memory は Magic Link 文脈の落とし穴 (Redirect URLs allowlist の `?**` サフィックス必須等) を集約しているが、AIOCR は subscriptions ベースゲートで Magic Link 採用対象外。今回の cookie 問題は password 認証側のバグだったので shared-memory の手順とは別経路で対応
- 検証:
  - tsc --noEmit EXIT=0
  - Vercel 本番デプロイ走行中 (commit 6329a21)
- 次にやること:
  - ユーザーがメイン側で site data clear → ログイン → /admin の流れを再テスト
  - 解消しなければ Playwright + Google OAuth (or password) で実際の Set-Cookie ヘッダを観察して仮説検証

## 2026-05-20 17:30
- やったこと: [MU🔴5] 管理者ロールを DB 化（TaskHub 3ac8c94e 対応）
  - migration `20260520_aiocr_admins_table` 適用済み
    - `public.aiocr_admins(user_id PK ref auth.users, email, note, created_at)` + RLS（自分の行のみ SELECT 可）
    - 初期データ: 既存 `ADMIN_EMAIL=negitoro0707@gmail.com` のユーザーを `aiocr_admins` に INSERT
  - `lib/auth-admin.ts` 新設: `isAdmin(user)` ヘルパー（service client で `aiocr_admins.user_id` 存在チェック）
  - 認可用途 8 箇所を `isAdmin(user)` 呼び出しに置換
    - `proxy.ts` middleware（admin は全アクセス可）
    - `app/auth/callback/route.ts`（admin はサブスク作成スキップ）
    - `app/api/admin/subscriptions/route.ts`
    - `app/api/admin/error-reports/route.ts`
    - `app/api/subscription/status/route.ts`（admin は active 扱い）
    - `app/api/process-pdf/route.ts`（admin は使用回数チェック迂回）
    - `app/api/me/route.ts`（isAdmin フラグ）
    - `app/api/corrections/route.ts`
  - 通知メール送信先用途（`subscribe/route.ts`, `report-error/route.ts`）は `ADMIN_EMAIL` env のまま残存（認可ではないため）
- 背景/理由:
  - 旧実装は `user.email === process.env.ADMIN_EMAIL` のみで認可していた
  - 環境変数漏洩で誰でも管理者操作可能、複数管理者にも未対応、ローテーション不可能
  - DB 化により: 漏洩リスク低減、複数管理者対応、追加管理者は SQL 1 行で済む
- 検証:
  - tsc --noEmit EXIT=0
  - aiocr_admins テーブルに 1 行（negitoro0707@gmail.com）が登録済みであることを SELECT で確認
- 次にやること:
  - 本番デプロイ後、admin として /admin にアクセスして閲覧可否を目視確認
  - 通知用 `ADMIN_EMAIL` env はそのまま残しているので Vercel env からは削除しなくてよい

## 2026-05-22 16:46
- やったこと: cookie の Domain をアクセス中ホストから動的決定するよう修正（commit 7d44074）
  - error_report `71edbc56`（村田・会社PCからログイン不可）/ `0536626f`（「認証エラーが発生しました」表示）対応 → 両方 status=resolved 済
  - `utils/supabase/cookie-options.ts`: `AUTH_COOKIE_OPTIONS` 固定定数を廃止し `authCookieOptions(host)` 関数化。`taxbestsearch.com` 配下のホストのみ `Domain=.taxbestsearch.com`、それ以外（vercel.app / localhost）は host-only cookie
  - `utils/supabase/cookie-options.server.ts` 新設: Host ヘッダから cookieOptions を解決する server 専用ヘルパー（next/headers 依存をブラウザバンドルから隔離）
  - `client.ts`（window.location.host）/ `server.ts`（headers）/ `proxy.ts`（request.headers）/ `auth/callback/route.ts`（request.headers）を実ホスト参照に変更
  - 同型の inline supabase client を持つ API ルート 6 本（subscription/status・subscription/bank-transfer・admin/error-reports・admin/subscriptions・invoice/[id]/download・subscribe）を共有 `createClient()` に統合（重複 141 行削減）
- 背景/理由:
  - このアプリは `ocr.taxbestsearch.com`（メイン）と `invoice-ocr-tawny.vercel.app`（会社フィルタ回避サブ）の 2 ドメイン同時公開
  - 5/20 commit 6329a21 で `NEXT_PUBLIC_VERCEL_ENV=production` を追加 → client bundle でも `Domain=.taxbestsearch.com` 固定が効くようになった
  - ブラウザは自ホストに一致しない Domain 属性の cookie を「丸ごと拒否」する。vercel.app 上で PKCE verifier・セッション cookie が一切保存できず、Google OAuth callback が `exchangeCodeForSession` で verifier を見つけられず `/login?error=auth` →「認証エラーが発生しました」、password ログインも /login ループ
  - 村田さんの「会社PC」は会社 Web フィルタ回避のため vercel.app 側を使う運用 → サブ URL が今回壊れていた。5/20 のメイン側 cookie 修正がサブ側を壊した形
  - `NEXT_PUBLIC_VERCEL_ENV` env はもう参照していない（残しても無害なので Vercel env からの削除は不要）
- 検証:
  - tsc --noEmit EXIT=0 / next build EXIT=0
  - ホスト別の cookie 属性をロジック追跡で確認（taxbestsearch.com→Domain付き / vercel.app→host-only secure / localhost→host-only 非secure）
- 次にやること:
  - 本番デプロイ後、村田さんに会社PC（vercel.app 側）で site data クリア → ログイン再テストを依頼
  - 解消しなければ Playwright で実際の Set-Cookie ヘッダを vercel.app 上で観察
  - 5/18 起票の aiocr error_report（b6dd7f57 / 24e9102a 等の証憑→仕訳系）は別タスク（C バケツ設計）として未着手のまま残存

