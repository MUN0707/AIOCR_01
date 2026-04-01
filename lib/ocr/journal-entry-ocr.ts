/**
 * 自動仕訳 OCR
 * 請求書・領収書・通帳など各種財務書類から会計仕訳を自動生成する
 */

import Anthropic from '@anthropic-ai/sdk';
import { JournalEntry } from './types';
import { parseJsonSafe } from './utils';

const PROMPT_JOURNAL_ENTRY = `このPDFは会計・財務書類（請求書、領収書、通帳、レシート等）です。記載されているすべての取引について会計仕訳を生成し、以下のJSON形式のみで返答してください。説明文は一切不要です。JSONのみ出力してください。

{
  "entries": [
    {
      "date": "20240101",
      "debitAccount": "仕入高",
      "creditAccount": "買掛金",
      "amount": 100000,
      "description": "株式会社〇〇 1月分仕入",
      "taxType": "課税仕入10%"
    },
    {
      "date": "20240101",
      "debitAccount": "仮払消費税等",
      "creditAccount": "買掛金",
      "amount": 10000,
      "description": "株式会社〇〇 1月分仕入 消費税",
      "taxType": "課税仕入10%"
    }
  ]
}

仕訳生成ルール：
- date：取引日をYYYYMMDD形式。不明な場合は"不明"
- debitAccount（借方）・creditAccount（貸方）：以下の勘定科目から最適なものを選択
  資産: 現金, 普通預金, 当座預金, 売掛金, 未収金, 立替金, 前払費用, 仮払消費税等
  負債: 買掛金, 未払金, 前受金, 預り金, 仮受消費税等
  収益: 売上高, 受取利息, 雑収入
  費用: 仕入高, 給料手当, 外注費, 地代家賃, 水道光熱費, 通信費, 交通費,
        旅費交通費, 消耗品費, 事務用品費, 広告宣伝費, 接待交際費, 会議費,
        支払手数料, 保険料, 修繕費, 減価償却費, 雑費
- amount：金額（税抜が基本。消費税は別行で仮払/仮受消費税等として計上）
- description：取引内容の摘要（書類上のテキストから簡潔に）
- taxType：消費税区分を以下から選択
  "課税仕入10%", "課税仕入8%（軽減）", "課税売上10%", "課税売上8%（軽減）",
  "非課税", "不課税", "対象外", "免税"
- 消費税は別行で「仮払消費税等」または「仮受消費税等」として仕訳すること
- 1つの書類に複数取引がある場合はすべて列挙する
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`;

interface ClaudeJournalEntryResponse {
  entries: JournalEntry[];
}

export async function processJournalEntryPdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic
): Promise<{ entries: JournalEntry[]; totalPages: number }> {
  const pdfBase64 = pdfBuffer.toString('base64');

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
          { type: 'text', text: PROMPT_JOURNAL_ENTRY },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeJournalEntryResponse>(textContent.text);

  if (!claudeData.entries || !Array.isArray(claudeData.entries)) {
    throw new Error('仕訳データの解析に失敗しました');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  return { entries: claudeData.entries, totalPages };
}
