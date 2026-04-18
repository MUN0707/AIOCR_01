"""
ダミー請求書PDF生成スクリプト
─────────────────────────────
税理士が顧問先から受け取るような請求書を8枚作成し、
1つの合体PDFにまとめる。デモ動画撮影用。

使い方:
  python scripts/generate-dummy-invoices.py

出力:
  public/demo/dummy-invoices-combined.pdf  (合体版)
  public/demo/individual/                  (個別PDF 8枚)
"""

import os
import random
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── フォント設定 ──────────────────────────────────────
# Windows の游ゴシックを使用。なければ MS Gothic にフォールバック
FONT_CANDIDATES = [
    ("YuGothic", "C:/Windows/Fonts/YuGothR.ttc"),
    ("MSGothic", "C:/Windows/Fonts/msgothic.ttc"),
]

JP_FONT = None
for name, path in FONT_CANDIDATES:
    if os.path.exists(path):
        try:
            pdfmetrics.registerFont(TTFont(name, path))
            JP_FONT = name
            break
        except Exception:
            continue

if JP_FONT is None:
    print("WARNING: 日本語フォントが見つかりません。文字化けする可能性があります。")
    JP_FONT = "Helvetica"

# ── 出力先 ────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "public" / "demo"
INDIVIDUAL_DIR = OUT_DIR / "individual"
OUT_DIR.mkdir(parents=True, exist_ok=True)
INDIVIDUAL_DIR.mkdir(parents=True, exist_ok=True)

# ── ダミーデータ ──────────────────────────────────────
COMPANIES = [
    {"name": "株式会社サンプル商事", "address": "東京都千代田区丸の内1-1-1", "tel": "03-1234-5678"},
    {"name": "合同会社テスト建設", "address": "大阪府大阪市北区梅田2-2-2", "tel": "06-2345-6789"},
    {"name": "有限会社デモ印刷", "address": "愛知県名古屋市中区栄3-3-3", "tel": "052-345-6789"},
    {"name": "株式会社架空システム", "address": "福岡県福岡市博多区博多駅前4-4-4", "tel": "092-456-7890"},
    {"name": "合同会社モック物流", "address": "北海道札幌市中央区北5条西5-5-5", "tel": "011-567-8901"},
    {"name": "株式会社ダミー食品", "address": "宮城県仙台市青葉区一番町6-6-6", "tel": "022-678-9012"},
    {"name": "有限会社サンプル電機", "address": "広島県広島市中区紙屋町7-7-7", "tel": "082-789-0123"},
    {"name": "株式会社テスト工業", "address": "京都府京都市下京区四条通8-8-8", "tel": "075-890-1234"},
]

ITEMS_POOL = [
    ("コピー用紙 A4 500枚入×10", 3500),
    ("トナーカートリッジ 黒", 8800),
    ("事務用デスク OA-200", 45000),
    ("会議室チェア×4脚", 32000),
    ("ノートPC ThinkPad X1", 198000),
    ("クラウドストレージ 月額利用料", 5500),
    ("社内研修テキスト印刷 100部", 28000),
    ("名刺印刷 1000枚", 4500),
    ("Webサイト保守管理費", 55000),
    ("清掃業務委託 月額", 38000),
    ("セキュリティソフト年間ライセンス", 12000),
    ("プロジェクター EPSON EB-2000", 89000),
    ("段ボール箱 大×50", 7500),
    ("宅配便送料 着払い", 2800),
    ("社員向け書籍購入 5冊", 9200),
]

RECIPIENT = "税理士法人サンプル会計"
RECIPIENT_ADDRESS = "東京都港区六本木9-9-9"


def generate_invoice_pdf(filepath: str, company: dict, invoice_date: date, items: list, invoice_no: str):
    """1枚の請求書PDFを生成する"""
    c = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    # ── ヘッダー背景 ──
    c.setFillColor(colors.HexColor("#f0f9ff"))
    c.rect(0, h - 100 * mm, w, 100 * mm, fill=1, stroke=0)

    # ── タイトル ──
    c.setFillColor(colors.HexColor("#0369a1"))
    c.setFont(JP_FONT, 28)
    c.drawCentredString(w / 2, h - 25 * mm, "請  求  書")

    # ── 請求番号・日付 ──
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont(JP_FONT, 10)
    c.drawRightString(w - 20 * mm, h - 38 * mm, f"請求番号: {invoice_no}")
    c.drawRightString(w - 20 * mm, h - 44 * mm, f"発行日: {invoice_date.strftime('%Y年%m月%d日')}")

    # ── 宛先（左上） ──
    c.setFont(JP_FONT, 14)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.drawString(20 * mm, h - 55 * mm, f"{RECIPIENT}  御中")

    c.setFont(JP_FONT, 9)
    c.setFillColor(colors.HexColor("#64748b"))
    c.drawString(20 * mm, h - 62 * mm, RECIPIENT_ADDRESS)

    # ── 差出人（右上） ──
    c.setFont(JP_FONT, 12)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.drawRightString(w - 20 * mm, h - 55 * mm, company["name"])

    c.setFont(JP_FONT, 9)
    c.setFillColor(colors.HexColor("#64748b"))
    c.drawRightString(w - 20 * mm, h - 62 * mm, company["address"])
    c.drawRightString(w - 20 * mm, h - 68 * mm, f"TEL: {company['tel']}")

    # ── 区切り線 ──
    c.setStrokeColor(colors.HexColor("#0369a1"))
    c.setLineWidth(1.5)
    c.line(20 * mm, h - 75 * mm, w - 20 * mm, h - 75 * mm)

    # ── 合計金額 ──
    subtotal = sum(qty * price for _, price, qty in items)
    tax = int(subtotal * 0.1)
    total = subtotal + tax

    c.setFont(JP_FONT, 9)
    c.setFillColor(colors.HexColor("#64748b"))
    c.drawString(20 * mm, h - 83 * mm, "ご請求金額（税込）")

    c.setFont(JP_FONT, 24)
    c.setFillColor(colors.HexColor("#0369a1"))
    c.drawString(20 * mm, h - 93 * mm, f"¥{total:,}")

    # ── 明細テーブル ──
    table_top = h - 110 * mm
    col_x = [20 * mm, 110 * mm, 135 * mm, w - 20 * mm]

    # ヘッダー行
    c.setFillColor(colors.HexColor("#0369a1"))
    c.rect(20 * mm, table_top - 8 * mm, w - 40 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(JP_FONT, 9)
    c.drawString(col_x[0] + 3 * mm, table_top - 6 * mm, "品目")
    c.drawString(col_x[1] + 3 * mm, table_top - 6 * mm, "単価")
    c.drawString(col_x[2] + 3 * mm, table_top - 6 * mm, "数量")
    c.drawRightString(col_x[3] - 3 * mm, table_top - 6 * mm, "金額")

    # データ行
    y = table_top - 8 * mm
    for i, (item_name, price, qty) in enumerate(items):
        y -= 8 * mm
        if i % 2 == 0:
            c.setFillColor(colors.HexColor("#f8fafc"))
            c.rect(20 * mm, y, w - 40 * mm, 8 * mm, fill=1, stroke=0)

        c.setFillColor(colors.HexColor("#334155"))
        c.setFont(JP_FONT, 9)
        c.drawString(col_x[0] + 3 * mm, y + 2 * mm, item_name)
        c.drawString(col_x[1] + 3 * mm, y + 2 * mm, f"¥{price:,}")
        c.drawString(col_x[2] + 3 * mm, y + 2 * mm, str(qty))
        c.drawRightString(col_x[3] - 3 * mm, y + 2 * mm, f"¥{price * qty:,}")

    # ── 小計・税・合計 ──
    y -= 15 * mm
    c.setStrokeColor(colors.HexColor("#e2e8f0"))
    c.setLineWidth(0.5)
    c.line(100 * mm, y + 10 * mm, w - 20 * mm, y + 10 * mm)

    c.setFont(JP_FONT, 10)
    c.setFillColor(colors.HexColor("#334155"))
    c.drawString(100 * mm, y + 3 * mm, "小計")
    c.drawRightString(w - 20 * mm, y + 3 * mm, f"¥{subtotal:,}")

    y -= 7 * mm
    c.drawString(100 * mm, y + 3 * mm, "消費税（10%）")
    c.drawRightString(w - 20 * mm, y + 3 * mm, f"¥{tax:,}")

    y -= 9 * mm
    c.setStrokeColor(colors.HexColor("#0369a1"))
    c.setLineWidth(1.5)
    c.line(100 * mm, y + 8 * mm, w - 20 * mm, y + 8 * mm)

    c.setFont(JP_FONT, 14)
    c.setFillColor(colors.HexColor("#0369a1"))
    c.drawString(100 * mm, y, "合計（税込）")
    c.drawRightString(w - 20 * mm, y, f"¥{total:,}")

    # ── 振込先 ──
    y -= 25 * mm
    c.setFillColor(colors.HexColor("#f0f9ff"))
    c.roundRect(20 * mm, y - 5 * mm, w - 40 * mm, 22 * mm, 3 * mm, fill=1, stroke=0)

    c.setFont(JP_FONT, 10)
    c.setFillColor(colors.HexColor("#0369a1"))
    c.drawString(25 * mm, y + 12 * mm, "【お振込先】")
    c.setFont(JP_FONT, 9)
    c.setFillColor(colors.HexColor("#334155"))
    c.drawString(25 * mm, y + 4 * mm, "サンプル銀行　東京支店　普通　1234567")
    c.drawString(25 * mm, y - 2 * mm, f"口座名義: {company['name']}")

    # ── フッター ──
    c.setFont(JP_FONT, 8)
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.drawCentredString(w / 2, 15 * mm, f"{company['name']} | {company['address']} | {company['tel']}")

    c.save()


def merge_pdfs(pdf_paths: list, output_path: str):
    """複数のPDFを1つに結合する"""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for pdf_path in pdf_paths:
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            writer.add_page(page)

    with open(output_path, "wb") as f:
        writer.write(f)


def main():
    random.seed(42)  # 再現性のため固定シード

    base_date = date(2026, 3, 1)
    individual_paths = []

    print("=" * 50)
    print("ダミー請求書PDF生成")
    print("=" * 50)

    for i, company in enumerate(COMPANIES):
        # 日付をばらけさせる（3月〜4月）
        inv_date = base_date + timedelta(days=random.randint(0, 45))

        # 品目をランダムに2〜4個選ぶ
        num_items = random.randint(2, 4)
        selected = random.sample(ITEMS_POOL, num_items)
        items = [(name, price, random.randint(1, 5)) for name, price in selected]

        invoice_no = f"INV-2026-{i + 1:04d}"

        filename = f"invoice_{i + 1:02d}_{company['name']}.pdf"
        filepath = str(INDIVIDUAL_DIR / filename)

        generate_invoice_pdf(filepath, company, inv_date, items, invoice_no)

        subtotal = sum(qty * price for _, price, qty in items)
        total = subtotal + int(subtotal * 0.1)
        print(f"  [{i + 1}/8] {company['name']}")
        print(f"        日付: {inv_date}  合計: {total:,}円")
        print(f"        → {filename}")

        individual_paths.append(filepath)

    # 合体PDF
    combined_path = str(OUT_DIR / "dummy-invoices-combined.pdf")
    merge_pdfs(individual_paths, combined_path)

    print()
    print(f"合体PDF → public/demo/dummy-invoices-combined.pdf")
    print(f"個別PDF → public/demo/individual/ ({len(individual_paths)}枚)")
    print()
    print("デモ動画撮影時はこの合体PDFをアップロードしてください！")


if __name__ == "__main__":
    main()
