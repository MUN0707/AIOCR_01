/**
 * 通帳 OCR
 * 銀行通帳・口座明細PDFから取引一覧を抽出する
 */

import Anthropic from '@anthropic-ai/sdk';
import { BankStatementInfo } from './types';
import { parseJsonSafe } from './utils';
import { calcCost, UsageInfo } from './cost';

const PROMPT_BANK_STATEMENT = `このPDFは銀行の通帳または口座明細書です。すべての取引を抽出し、以下のJSON形式のみで返答してください。説明文や前置きは一切不要です。JSONのみ出力してください。

{
  "bankName": "〇〇銀行",
  "accountNumber": "****1234",
  "transactions": [
    {
      "date": "20240101",
      "description": "振込　カブシキカイシャXX",
      "debit": null,
      "credit": 550000,
      "balance": 1200000
    },
    {
      "date": "20240105",
      "description": "ATM引出し",
      "debit": 50000,
      "credit": null,
      "balance": 1150000
    }
  ]
}

抽出ルール：
- bankName：銀行名（支店名含む。例: "三菱UFJ銀行 渋谷支店"）。不明な場合は"不明"
- accountNumber：口座番号（下4桁のみ "****1234" 形式に伏せる）。不明な場合は"不明"
- date：取引日をYYYYMMDD形式。不明な場合は"不明"
- description：摘要・取引内容のテキストをそのまま抽出
- debit：出金・引出し金額（整数・円）。なければ null
- credit：入金・預入れ金額（整数・円）。なければ null
- balance：残高（整数・円）。なければ null
- 純粋なJSONのみ返すこと。マークダウンのコードブロックも不要`;

interface ClaudeBankStatementResponse {
  bankName: string;
  accountNumber: string;
  transactions: BankStatementInfo['transactions'];
}

export async function processBankStatementPdf(
  pdfBuffer: Buffer,
  anthropic: Anthropic
): Promise<{ bankName: string; accountNumber: string; transactions: BankStatementInfo['transactions']; totalPages: number; usage: UsageInfo }> {
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: PROMPT_BANK_STATEMENT },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claudeからの応答が不正です');
  }

  const claudeData = parseJsonSafe<ClaudeBankStatementResponse>(textContent.text);

  if (!claudeData.transactions || !Array.isArray(claudeData.transactions)) {
    throw new Error('通帳データの解析に失敗しました');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const usage = calcCost(response.usage.input_tokens, response.usage.output_tokens);
  return {
    bankName: claudeData.bankName || '不明',
    accountNumber: claudeData.accountNumber || '不明',
    transactions: claudeData.transactions,
    totalPages,
    usage,
  };
}
