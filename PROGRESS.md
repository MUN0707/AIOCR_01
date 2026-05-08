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
- やったこと: 🔴5 キャッシュフロー計算書を実装 → commit 533b827
  - GET /api/cash-flow 新設（間接法）
    - 当期純利益 + 減価償却加算 + 流動資産負債の増減 = 営業CF
    - 固定資産の取得/売却 = 投資CF（「累計額」科目は除外）
    - 固定負債・純資産（繰越除く）の増減 = 財務CF
  - 決算書生成時に financial-statement と cash-flow を並列フェッチ
  - DecisionReportPaper に CashFlowPage（第6ページ）を追加。cfResult が取得できた場合のみ印刷ページに追加
  - 既存 TS エラー2件を修正（edocuments 型キャスト、LedgerView の selectedClientId → clientId）

- 次にやること:
  - 🟡6: 売掛金・買掛金の消込管理
  - 🟡7: 補助科目
  （以降ロードマップ順）
