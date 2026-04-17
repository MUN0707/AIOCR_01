/**
 * 確定申告書 OCR
 *
 * TODO: IKANの確定申告OCRコードが届いたら、
 *       PROMPT_TAX_RETURN と抽出ロジックをIKANのものに差し替える
 */

import Anthropic from '@anthropic-ai/sdk';
import { TaxReturnInfo } from './types';
import { sanitizeFileName, extractPages, parseJsonSafe, convertToSeireki } from './utils';
import { calcCost, UsageInfo } from './cost';

// ──────────────────────────────────────────────────────────
// プロンプト（IKANのプロンプトをここに差し替える）
// ──────────────────────────────────────────────────────────

const PROMPT_TAX_RETURN = `このPDFには確定申告関連書類が含まれています。すべての書類を1ページずつ厳密に特定し、以下のJSON形式のみで返答してください。説明文は一切不要です。JSONのみ出力してください。

{
  "documents": [
    {
      "pageStart": 1,
      "pageEnd": 2,
      "year": "令和5年分",
      "taxpayerName": "山田太郎",
      "documentType": "申告書第一表",
      "totalIncome": 5000000,
      "taxPayable": 120000
    }
  ]
}

抽出ルール：
- pageStart / pageEnd：1始まりのページ番号（整数）。1つの書類が複数ページにまたがる場合のみ範囲でまとめる。別書類は必ず別エントリに分ける
- year：申告年度（例: "令和5年分" "2023年分" "令和7年"）。不明な場合は"不明"
- taxpayerName：納税者（申告者）の氏名。不明な場合は"不明"
- totalIncome：総所得金額または売上金額（整数・円）。不明な場合はnull
- taxPayable：納付すべき所得税額（整数・円）。不明な場合はnull
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要

【documentType の決定方法（最重要）】
書類の表題・様式名・上部の見出しを必ず読み取り、下記カテゴリのうち**最も近いもの**を選んでください。安易に「その他」に逃げないこと。以下のいずれかに該当するなら必ずその名称を使う：

▼ 申告書本体
  "申告書第一表", "申告書第二表", "申告書第三表（分離課税用）", "申告書第四表（損失申告用）",
  "申告書付表", "修正申告書", "確定申告書A", "確定申告書B"

▼ 決算書・内訳書
  "青色申告決算書（一般用）", "青色申告決算書（農業所得用）", "青色申告決算書（不動産所得用）",
  "収支内訳書（一般用）", "収支内訳書（農業所得用）", "収支内訳書（不動産所得用）"

▼ 控除関連の明細書・計算書
  "医療費控除の明細書", "セルフメディケーション税制の明細書",
  "寄附金控除に関する明細書", "住宅借入金等特別控除額の計算明細書",
  "株式等に係る譲渡所得等の金額の計算明細書"

▼ 源泉徴収票・支払通知書
  "給与所得の源泉徴収票", "公的年金等の源泉徴収票", "退職所得の源泉徴収票",
  "上場株式配当等の支払通知書", "特定口座年間取引報告書"

▼ 控除証明書（添付書類）
  "生命保険料控除証明書", "地震保険料控除証明書",
  "社会保険料（国民年金保険料）控除証明書", "国民健康保険料納付確認書",
  "小規模企業共済等掛金払込証明書", "iDeCo掛金払込証明書",
  "寄附金受領証明書", "ふるさと納税受領証明書",
  "住宅ローン年末残高証明書"

▼ 消費税
  "消費税及び地方消費税の確定申告書（一般用）", "消費税及び地方消費税の確定申告書（簡易課税用）",
  "消費税課税事業者届出書", "適格請求書発行事業者の登録申請書"

▼ 本人確認・その他
  "マイナンバー確認書類", "本人確認書類", "還付金受取口座情報"

▲ 上記カテゴリのいずれにも該当しない場合のみ、"その他（実際の書類名）" の形式で必ず実書類名を含めてください。
  例: "その他（株式異動証明書）", "その他（不動産売買契約書）"
  「その他」だけで終わらせるのは禁止です。必ず括弧内に書類タイトルを記載してください。`;

// ──────────────────────────────────────────────────────────
// OCR処理
// ──────────────────────────────────────────────────────────

interface ClaudeTaxReturnResponse {
  documents: TaxReturnInfo[];
}

export async function processTaxReturnPdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic,
  options?: { skipPdfExtraction?: boolean; pageOffset?: number }
): Promise<{ items: Array<TaxReturnInfo & { fileName: string; pdfBase64: string }>; totalPages: number; usage: UsageInfo }> {
  const pdfBase64 = pdfBuffer.toString('base64');
  const pageOffset = options?.pageOffset ?? 0;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: PROMPT_TAX_RETURN },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeTaxReturnResponse>(textContent.text);

  if (!claudeData.documents || !Array.isArray(claudeData.documents)) {
    throw new Error('確定申告データの解析に失敗しました');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const items = await Promise.all(
    claudeData.documents.map(async (doc, idx) => {
      const pStart = (doc.pageStart || 1) + pageOffset;
      const pEnd = (doc.pageEnd || doc.pageStart || 1) + pageOffset;

      let splitBase64 = '';
      if (!options?.skipPdfExtraction) {
        const splitBuffer = await extractPages(pdfBuffer, pStart - pageOffset, pEnd - pageOffset);
        splitBase64 = splitBuffer.toString('base64');
      }

      const rawYear = String(doc.year || '不明');
      const year = sanitizeFileName(convertToSeireki(rawYear));
      const name = sanitizeFileName(String(doc.taxpayerName || '不明'));
      const type = sanitizeFileName(String(doc.documentType || 'その他'));
      // ページ範囲 + 連番でユニーク化（同名衝突でZIP上書きを防ぐ）
      const pageLabel = pStart === pEnd ? `p${pStart}` : `p${pStart}-${pEnd}`;
      const seq = String(idx + 1).padStart(2, '0');

      // 不明部分を省略してファイル名を簡潔に
      const parts = [
        year !== '不明' ? year : '',
        name !== '不明' ? name : '',
      ].filter(Boolean);
      const prefix = parts.length > 0 ? parts.join('_') : '';

      return {
        ...doc,
        pageStart: pStart,
        pageEnd: pEnd,
        year: convertToSeireki(rawYear),
        fileName: `${prefix ? prefix + '_' : ''}${seq}_${pageLabel}_${type}.pdf`,
        pdfBase64: splitBase64,
      };
    })
  );

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return { items, totalPages, usage };
}
