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
