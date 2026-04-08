#!/usr/bin/env bash
# ===================================================
# Invoice OCR — セットアップスクリプト
# ===================================================
# 使い方:
#   bash scripts/setup.sh
#
# このスクリプトは以下を実行します:
#   1. Node.js バージョンチェック
#   2. npm install（依存関係インストール）
#   3. .env.local の作成（未存在時のみ）
#   4. 環境変数の設定状況チェック
#   5. Supabase マイグレーション案内
# ===================================================

set -euo pipefail

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ヘルパー関数
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo "=========================================="
echo "  Invoice OCR — セットアップ"
echo "=========================================="
echo ""

# ─── 1. Node.js バージョンチェック ───
info "Node.js バージョンを確認中..."
if ! command -v node &> /dev/null; then
    error "Node.js がインストールされていません。"
    error "https://nodejs.org/ からインストールしてください（v20以上推奨）。"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    warn "Node.js v${NODE_VERSION} が検出されました。v20以上を推奨します。"
else
    success "Node.js $(node -v) ✓"
fi

# ─── 2. npm install ───
info "依存関係をインストール中..."
if [ -f "package.json" ]; then
    npm install
    success "npm install 完了 ✓"
else
    error "package.json が見つかりません。プロジェクトルートで実行してください。"
    exit 1
fi

# ─── 3. .env.local の作成 ───
echo ""
info ".env.local をチェック中..."
if [ -f ".env.local" ]; then
    success ".env.local は既に存在します ✓"
else
    if [ -f ".env.example" ]; then
        cp .env.example .env.local
        success ".env.example → .env.local にコピーしました"
        warn "⚠  .env.local を開いて各環境変数を設定してください！"
    else
        error ".env.example が見つかりません。手動で .env.local を作成してください。"
    fi
fi

# ─── 4. 環境変数の設定状況チェック ───
echo ""
info "環境変数の設定状況をチェック中..."

REQUIRED_VARS=(
    "ANTHROPIC_API_KEY"
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "ADMIN_EMAIL"
    "SALES_TOKEN"
)

OPTIONAL_VARS=(
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "MONTHLY_PRICE"
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
    "STRIPE_SECRET_KEY"
)

MISSING_REQUIRED=0
MISSING_OPTIONAL=0

if [ -f ".env.local" ]; then
    for var in "${REQUIRED_VARS[@]}"; do
        # .env.local から値を読み取り、プレースホルダー（xxx...）でないか確認
        VALUE=$(grep "^${var}=" .env.local 2>/dev/null | cut -d'=' -f2- | xargs 2>/dev/null || echo "")
        if [ -z "$VALUE" ] || [[ "$VALUE" == *"xxxx"* ]] || [[ "$VALUE" == *"xxxxxxxxx"* ]]; then
            warn "  [必須] ${var} — 未設定またはプレースホルダーのまま"
            MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
        else
            success "  [必須] ${var} ✓"
        fi
    done

    echo ""

    for var in "${OPTIONAL_VARS[@]}"; do
        VALUE=$(grep "^${var}=" .env.local 2>/dev/null | cut -d'=' -f2- | xargs 2>/dev/null || echo "")
        if [ -z "$VALUE" ] || [[ "$VALUE" == *"xxxx"* ]] || [[ "$VALUE" == *"xxxxxxxxx"* ]]; then
            info "  [任意] ${var} — 未設定（後から設定可能）"
            MISSING_OPTIONAL=$((MISSING_OPTIONAL + 1))
        else
            success "  [任意] ${var} ✓"
        fi
    done
else
    warn ".env.local が存在しないため環境変数チェックをスキップ"
    MISSING_REQUIRED=${#REQUIRED_VARS[@]}
fi

# ─── 5. Supabase マイグレーション案内 ───
echo ""
echo "=========================================="
echo "  Supabase マイグレーション"
echo "=========================================="
echo ""
info "以下のSQLファイルを Supabase Dashboard の SQL Editor で実行してください："
echo ""
echo "  1. docs/DB設計書.md 内の「01_create_subscriptions.sql」"
echo "  2. docs/DB設計書.md 内の「02_create_usage_logs.sql」"
echo "  3. docs/DB設計書.md 内の「03_create_rpc_increment_usage.sql」"
echo ""
info "Supabase Dashboard: https://supabase.com/dashboard"
echo ""

# ─── サマリー ───
echo "=========================================="
echo "  セットアップ結果"
echo "=========================================="
echo ""

if [ "$MISSING_REQUIRED" -eq 0 ]; then
    success "全ての必須環境変数が設定済みです ✓"
    echo ""
    success "セットアップ完了！以下のコマンドで開発サーバーを起動できます："
    echo ""
    echo "    npm run dev"
    echo ""
    echo "  → http://localhost:3000 でアクセス"
    echo ""
else
    warn "${MISSING_REQUIRED} 個の必須環境変数が未設定です。"
    warn ".env.local を編集してから開発サーバーを起動してください。"
    echo ""
    echo "  エディタで開く:  code .env.local"
    echo "  サーバー起動:    npm run dev"
    echo ""
fi

if [ "$MISSING_OPTIONAL" -gt 0 ]; then
    info "${MISSING_OPTIONAL} 個の任意環境変数が未設定です（Google OAuth、Stripe等）。"
    info "必要に応じて後から設定できます。"
fi

echo ""
