/**
 * 税理士法人向け 営業メール一斉送信スクリプト
 *
 * 使い方:
 *   npx tsx scripts/send-sales-email.ts --dry-run    # 送信せずプレビュー
 *   npx tsx scripts/send-sales-email.ts --limit 5    # 最初の5件だけ送信
 *   npx tsx scripts/send-sales-email.ts              # 全件送信
 *
 * 必要な環境変数 (.env.local):
 *   RESEND_API_KEY=re_xxxx (フルアクセスキー)
 *   RESEND_SALES_FROM=Invoice OCR <invoice-ocr@taxbestsearch.com>
 *
 * CSV: ../260216_税理士事務所リスト化/zeirishi_houjin.csv
 */

import { Resend } from 'resend'
import * as fs from 'fs'
import * as path from 'path'

// ── 設定 ──
const CSV_PATH = path.resolve(__dirname, '../../260216_税理士事務所リスト化/zeirishi_houjin.csv')
const PDF_PATH = path.resolve(__dirname, '../【営業】メール添付用PDF/InvoiceOCR_サービス案内.pdf')
const SENT_LOG = path.resolve(__dirname, '../sales-sent-log.json')
const RATE_LIMIT_MS = 500 // Resend free tier: 2 emails/sec

// ── 引数パース ──
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity

// ── CSV パーサー ──
function parseCSV(filePath: string): Record<string, string>[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim())
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim() })
    return obj
  })
}

// ── 送信済みログ ──
function loadSentLog(): Set<string> {
  if (!fs.existsSync(SENT_LOG)) return new Set()
  const data = JSON.parse(fs.readFileSync(SENT_LOG, 'utf-8'))
  return new Set(data)
}
function saveSentLog(log: Set<string>) {
  fs.writeFileSync(SENT_LOG, JSON.stringify([...log], null, 2))
}

// ── HTML メール本文 ──
function buildEmailHTML(firmName: string): string {
  return `
<div style="font-family:'Noto Sans JP',sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;line-height:1.8;">
  <p>${firmName} 御中</p>
  <p>突然のご連絡を差し上げます失礼をお許しください。<br>
  請求書PDFの分割・命名作業を自動化するクラウドツール「Invoice OCR」を開発・提供しております。</p>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:20px 0;">
    <p style="font-weight:bold;color:#0284c7;margin:0 0 8px;">こんなお悩みはありませんか？</p>
    <ul style="margin:0;padding-left:20px;">
      <li>顧問先から届いた数十ページのPDFを1枚ずつ開いて確認している</li>
      <li>「日付_取引先_金額.pdf」とファイル名を毎回手入力している</li>
      <li>確定申告の時期に大量の書類仕分けに追われている</li>
    </ul>
  </div>

  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin:20px 0;">
    <p style="font-weight:bold;color:#16a34a;margin:0 0 8px;">Invoice OCR でできること</p>
    <ul style="margin:0;padding-left:20px;">
      <li>PDFをアップロードするだけで、AIが請求書を1枚ずつ自動分割</li>
      <li>日付・取引先・金額を読み取り、ファイル名を自動生成</li>
      <li>ZIPでまとめてダウンロード</li>
    </ul>
  </div>

  <p>月額1,500円（税込）からご利用いただけます。<br>
  <strong>3日間の無料トライアル（カード登録不要）</strong>をご用意しておりますので、<br>
  まずは実際の請求書でお試しいただけますと幸いです。</p>

  <div style="text-align:center;margin:24px 0;">
    <a href="https://ocr.taxbestsearch.com/lp/invoice"
       style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
      無料トライアルはこちら
    </a>
  </div>

  <p>添付のPDFにサービス概要をまとめておりますので、<br>
  ご検討の際にご参照いただけますと幸いです。</p>

  <p>ご不明な点がございましたら、お気軽にご返信ください。</p>

  <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
  <table style="font-size:13px;color:#475569;">
    <tr><td style="padding:2px 0;"><strong>Invoice OCR</strong></td></tr>
    <tr><td style="padding:2px 0;">お問い合わせ: <a href="mailto:invoice-ocr@taxbestsearch.com" style="color:#0ea5e9;">invoice-ocr@taxbestsearch.com</a></td></tr>
    <tr><td style="padding:2px 0;">サービスサイト: <a href="https://ocr.taxbestsearch.com" style="color:#0ea5e9;">https://ocr.taxbestsearch.com</a></td></tr>
  </table>

  <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
  <p style="font-size:11px;color:#94a3b8;">
    このメールは税理士事務所・税理士法人向けにお送りしております。<br>
    配信停止をご希望の場合は、本メールに「配信停止」とご返信ください。<br>
    今後のメール送信を速やかに停止いたします。
  </p>
</div>`
}

// ── メイン ──
async function main() {
  // 環境変数読み込み
  const envPath = path.resolve(__dirname, '../.env.local')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/)
      if (match) process.env[match[1].trim()] = match[2].trim()
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  const fromAddr = process.env.RESEND_SALES_FROM || 'Invoice OCR <invoice-ocr@taxbestsearch.com>'

  if (!apiKey) {
    console.error('ERROR: RESEND_API_KEY not found in .env.local')
    process.exit(1)
  }

  // CSV 読み込み
  const rows = parseCSV(CSV_PATH)
  const EXCLUDE_VALUE = '個人情報の保護に関する方針'

  // メアドあり法人を抽出（同一メアドは最初の1件だけ）
  const seen = new Set<string>()
  const targets = rows.filter(r => {
    const email = (r['事務所メールアドレス'] || '').toLowerCase()
    if (!email || email === EXCLUDE_VALUE.toLowerCase() || !email.includes('@')) return false
    if (seen.has(email)) return false
    seen.add(email)
    return true
  })

  console.log(`\n📊 CSV読み込み完了`)
  console.log(`   法人総数: ${rows.length}`)
  console.log(`   メアドあり: ${targets.length}`)
  console.log(`   送信上限: ${limit === Infinity ? '全件' : limit}`)
  console.log(`   モード: ${isDryRun ? '🔍 DRY RUN（送信しない）' : '📧 送信モード'}\n`)

  // 送信済みログ
  const sentLog = loadSentLog()
  const unsent = targets.filter(t => !sentLog.has(t['事務所メールアドレス']))
  console.log(`   送信済み: ${sentLog.size}`)
  console.log(`   未送信: ${unsent.length}\n`)

  if (unsent.length === 0) {
    console.log('✅ 全件送信済みです')
    return
  }

  // PDF読み込み
  const pdfBuffer = fs.readFileSync(PDF_PATH)
  const pdfBase64 = pdfBuffer.toString('base64')

  const resend = new Resend(apiKey)
  const toSend = unsent.slice(0, limit)

  let sent = 0
  let failed = 0

  for (const row of toSend) {
    const email = row['事務所メールアドレス']
    const firmName = row['法人名'] || row['法人名称'] || '御社'

    if (isDryRun) {
      console.log(`  [DRY] → ${email} (${firmName})`)
      sent++
      continue
    }

    try {
      await resend.emails.send({
        from: fromAddr,
        to: email,
        subject: '【ご案内】請求書PDFの分割・命名を自動化するツール',
        html: buildEmailHTML(firmName),
        attachments: [
          {
            filename: 'InvoiceOCR_サービス案内.pdf',
            content: pdfBase64,
          }
        ],
      })

      sentLog.add(email)
      sent++
      console.log(`  ✅ ${sent}/${toSend.length} → ${email} (${firmName})`)

      // レート制限
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS))
    } catch (err: any) {
      failed++
      console.error(`  ❌ FAIL → ${email}: ${err.message}`)
    }

    // 10件ごとにログ保存
    if (sent % 10 === 0) saveSentLog(sentLog)
  }

  // 最終ログ保存
  saveSentLog(sentLog)

  console.log(`\n📊 送信完了`)
  console.log(`   成功: ${sent}`)
  console.log(`   失敗: ${failed}`)
  console.log(`   累計送信済み: ${sentLog.size}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
