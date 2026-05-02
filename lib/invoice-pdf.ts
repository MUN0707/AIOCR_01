// 区分記載請求書（または適格請求書）PDF を生成。
// 適格事業者登録番号が環境変数で設定されていれば適格請求書として "T..." を表示する。
//
// 環境変数（請求書発行元の事業者情報。Vercel の Project Settings に設定）
//   INVOICE_ISSUER_NAME             販売事業者名
//   INVOICE_ISSUER_ADDRESS          所在地
//   INVOICE_ISSUER_PHONE            電話番号（任意）
//   INVOICE_ISSUER_EMAIL            連絡先メール
//   INVOICE_ISSUER_REGISTRATION_NO  適格請求書発行事業者登録番号（"T..." / 未設定なら区分記載）
//   INVOICE_BANK_NAME               振込先銀行名
//   INVOICE_BANK_BRANCH             支店名
//   INVOICE_BANK_ACCOUNT_TYPE       口座種別（普通 / 当座）
//   INVOICE_BANK_ACCOUNT_NO         口座番号
//   INVOICE_BANK_ACCOUNT_NAME       口座名義

import PDFDocument from 'pdfkit';
import path from 'node:path';

export type InvoiceLineItem = {
  name: string;
  quantity: number;
  unitPrice: number; // 税抜単価
};

export type InvoiceData = {
  invoiceNo: string;
  issuedAt: Date;
  dueAt: Date;
  issuedToName: string;       // 請求先（会社名・事務所名）
  issuedToContact?: string;   // 担当者名
  items: InvoiceLineItem[];
  taxRate?: number;           // デフォルト 0.10
  notes?: string;
};

const FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf');

function fmtYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const taxRate = data.taxRate ?? 0.10;
  const subtotal = data.items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
  const tax = Math.floor(subtotal * taxRate);
  const total = subtotal + tax;

  const issuerName = process.env.INVOICE_ISSUER_NAME || '（販売事業者名 未設定）';
  const issuerAddress = process.env.INVOICE_ISSUER_ADDRESS || '';
  const issuerPhone = process.env.INVOICE_ISSUER_PHONE || '';
  const issuerEmail = process.env.INVOICE_ISSUER_EMAIL || 'info@taxbestsearch.com';
  const issuerRegNo = process.env.INVOICE_ISSUER_REGISTRATION_NO || '';
  const bankName = process.env.INVOICE_BANK_NAME || '（後日ご連絡）';
  const bankBranch = process.env.INVOICE_BANK_BRANCH || '（後日ご連絡）';
  const bankAccountType = process.env.INVOICE_BANK_ACCOUNT_TYPE || '普通';
  const bankAccountNo = process.env.INVOICE_BANK_ACCOUNT_NO || '（後日ご連絡）';
  const bankAccountName = process.env.INVOICE_BANK_ACCOUNT_NAME || '（後日ご連絡）';
  const isQualified = issuerRegNo.startsWith('T');

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.registerFont('Jp', FONT_PATH);
      doc.font('Jp');

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // タイトル
      doc.fontSize(22).text(isQualified ? '適格請求書' : '請求書', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666')
        .text(`請求書番号: ${data.invoiceNo}    発行日: ${fmtDate(data.issuedAt)}    支払期日: ${fmtDate(data.dueAt)}`, { align: 'center' });
      doc.moveDown(1.5);
      doc.fillColor('#000');

      // 請求先（左） / 販売者（右）
      const colY = doc.y;
      doc.fontSize(11).text('請求先', 50, colY);
      doc.fontSize(13).text(`${data.issuedToName} 御中`, 50, colY + 16);
      if (data.issuedToContact) {
        doc.fontSize(10).fillColor('#444').text(`ご担当: ${data.issuedToContact} 様`, 50, colY + 36);
        doc.fillColor('#000');
      }

      const rightX = 320;
      doc.fontSize(11).text('販売事業者', rightX, colY);
      doc.fontSize(11).text(issuerName, rightX, colY + 16);
      doc.fontSize(9).fillColor('#444');
      let rightY = colY + 32;
      if (issuerAddress) { doc.text(issuerAddress, rightX, rightY, { width: 220 }); rightY += 14; }
      if (issuerPhone) { doc.text(`TEL: ${issuerPhone}`, rightX, rightY); rightY += 12; }
      doc.text(`Email: ${issuerEmail}`, rightX, rightY); rightY += 12;
      if (issuerRegNo) { doc.text(`登録番号: ${issuerRegNo}`, rightX, rightY); rightY += 12; }
      doc.fillColor('#000');

      doc.y = Math.max(colY + 80, rightY + 8);
      doc.moveDown(1);

      // 合計（強調）
      doc.fontSize(11).fillColor('#444').text('ご請求金額（税込）', { continued: false });
      doc.fontSize(24).fillColor('#0f766e').text(fmtYen(total));
      doc.moveDown(0.6);
      doc.fillColor('#000');

      // 明細テーブル
      const tableTop = doc.y + 6;
      const colX = { name: 50, qty: 320, unit: 380, sum: 470 };
      doc.fontSize(10).fillColor('#fff').rect(50, tableTop, 500, 22).fill('#0f766e');
      doc.fillColor('#fff');
      doc.text('品目', colX.name + 6, tableTop + 6);
      doc.text('数量', colX.qty + 6, tableTop + 6, { width: 50, align: 'right' });
      doc.text('単価（税抜）', colX.unit + 6, tableTop + 6, { width: 80, align: 'right' });
      doc.text('金額（税抜）', colX.sum + 6, tableTop + 6, { width: 80, align: 'right' });
      doc.fillColor('#000');

      let rowY = tableTop + 28;
      for (const it of data.items) {
        const line = it.quantity * it.unitPrice;
        doc.fontSize(10);
        doc.text(it.name, colX.name + 6, rowY, { width: 260 });
        doc.text(String(it.quantity), colX.qty + 6, rowY, { width: 50, align: 'right' });
        doc.text(fmtYen(it.unitPrice), colX.unit + 6, rowY, { width: 80, align: 'right' });
        doc.text(fmtYen(line), colX.sum + 6, rowY, { width: 80, align: 'right' });
        rowY += 22;
      }
      doc.moveTo(50, rowY).lineTo(550, rowY).strokeColor('#cbd5e1').stroke();
      rowY += 8;

      // 小計・税・合計
      doc.fontSize(10).strokeColor('#000');
      const labelX = 360;
      const valX = 470;
      doc.text('小計（税抜）', labelX, rowY, { width: 100, align: 'right' });
      doc.text(fmtYen(subtotal), valX, rowY, { width: 80, align: 'right' });
      rowY += 16;
      doc.text(`消費税（${(taxRate * 100).toFixed(0)}%）`, labelX, rowY, { width: 100, align: 'right' });
      doc.text(fmtYen(tax), valX, rowY, { width: 80, align: 'right' });
      rowY += 18;
      doc.fontSize(11);
      doc.text('合計（税込）', labelX, rowY, { width: 100, align: 'right' });
      doc.text(fmtYen(total), valX, rowY, { width: 80, align: 'right' });
      doc.y = rowY + 30;

      // 振込先案内
      doc.fontSize(11).fillColor('#000').text('お振込先', 50, doc.y);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#333');
      doc.text(`銀行名: ${bankName}`);
      doc.text(`支店名: ${bankBranch}`);
      doc.text(`口座種別: ${bankAccountType}`);
      doc.text(`口座番号: ${bankAccountNo}`);
      doc.text(`口座名義: ${bankAccountName}`);
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666').text(
        `※ 支払期日（${fmtDate(data.dueAt)}）までにお振込みください。振込手数料はお客様ご負担にてお願いいたします。`
      );
      if (!isQualified) {
        doc.moveDown(0.4);
        doc.fontSize(9).fillColor('#666').text(
          '※ 本請求書は区分記載請求書です。適格請求書発行事業者の登録完了後、改めて適格請求書を発行いたします。'
        );
      }
      if (data.notes) {
        doc.moveDown(0.6);
        doc.fontSize(10).fillColor('#000').text('備考');
        doc.fontSize(10).fillColor('#444').text(data.notes);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// 請求書番号の生成（年月+連番、SupabaseのRPC的な原子性は invoice_counters でロック）
import { createServiceClient } from '@/utils/supabase/service';

export async function nextInvoiceNo(): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const service = createServiceClient();
  // 既存行を取得 → 連番を 1 増やす（同時実行があると軽い競合あり、運用規模なら許容）
  const { data: counter } = await service
    .from('invoice_counters')
    .select('last_seq')
    .eq('ym', ym)
    .maybeSingle();
  const nextSeq = (counter?.last_seq ?? 0) + 1;
  await service
    .from('invoice_counters')
    .upsert({ ym, last_seq: nextSeq, updated_at: new Date().toISOString() }, { onConflict: 'ym' });
  return `INV-${ym}-${String(nextSeq).padStart(4, '0')}`;
}
