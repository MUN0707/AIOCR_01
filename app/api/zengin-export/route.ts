import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { encode } from 'iconv-lite';

export const maxDuration = 30;

// ─── 全角カナ → 半角カナ変換 ───────────────────────────────────────────────
const ZENKAKU_TO_HANKAKU: Record<string, string> = {
  'ァ':'ｧ','ア':'ｱ','ィ':'ｨ','イ':'ｲ','ゥ':'ｩ','ウ':'ｳ','ェ':'ｪ','エ':'ｴ','ォ':'ｫ','オ':'ｵ',
  'カ':'ｶ','ガ':'ｶﾞ','キ':'ｷ','ギ':'ｷﾞ','ク':'ｸ','グ':'ｸﾞ','ケ':'ｹ','ゲ':'ｹﾞ','コ':'ｺ','ゴ':'ｺﾞ',
  'サ':'ｻ','ザ':'ｻﾞ','シ':'ｼ','ジ':'ｼﾞ','ス':'ｽ','ズ':'ｽﾞ','セ':'ｾ','ゼ':'ｾﾞ','ソ':'ｿ','ゾ':'ｿﾞ',
  'タ':'ﾀ','ダ':'ﾀﾞ','チ':'ﾁ','ヂ':'ﾁﾞ','ッ':'ｯ','ツ':'ﾂ','ヅ':'ﾂﾞ','テ':'ﾃ','デ':'ﾃﾞ','ト':'ﾄ','ド':'ﾄﾞ',
  'ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ',
  'ハ':'ﾊ','バ':'ﾊﾞ','パ':'ﾊﾟ','ヒ':'ﾋ','ビ':'ﾋﾞ','ピ':'ﾋﾟ','フ':'ﾌ','ブ':'ﾌﾞ','プ':'ﾌﾟ',
  'ヘ':'ﾍ','ベ':'ﾍﾞ','ペ':'ﾍﾟ','ホ':'ﾎ','ボ':'ﾎﾞ','ポ':'ﾎﾟ',
  'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ',
  'ャ':'ｬ','ヤ':'ﾔ','ュ':'ｭ','ユ':'ﾕ','ョ':'ｮ','ヨ':'ﾖ',
  'ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ',
  'ワ':'ﾜ','ヲ':'ｦ','ン':'ﾝ',
  'ー':'ｰ','。':'｡','「':'｢','」':'｣','、':'､','・':'･','　':' ',
};

function toHankaku(str: string): string {
  return str.split('').map((c) => ZENKAKU_TO_HANKAKU[c] ?? c).join('');
}

// 半角文字のみ許容。全角が残っていたらスペースに置換
function sanitize(str: string): string {
  return toHankaku(str).replace(/[^\x20-\x7E｡-ﾟ]/g, ' ');
}

// 左詰めスペース埋め（テキストフィールド）
function lpad(value: string, len: number): string {
  const s = sanitize(value).slice(0, len);
  return s.padEnd(len, ' ');
}

// 右詰めゼロ埋め（数値フィールド）
function rpad(value: string | number, len: number): string {
  return String(value).padStart(len, '0').slice(-len);
}

// ─── 全銀レコード生成 ───────────────────────────────────────────────────────

interface CompanySettings {
  company_name_kana: string | null;
  bank_code: string | null;
  branch_code: string | null;
  account_type: string | null;
  account_number: string | null;
  account_name_kana: string | null;
  requestor_code: string | null;
}

interface ZenginItem {
  bank_code: string;
  branch_code: string;
  account_type: string;
  account_number: string;
  account_name_kana: string;
  amount: number;
}

function buildHeader(settings: CompanySettings, paymentDate: string): string {
  // paymentDate: MMDD (4桁)
  const f = (v: string | null, len: number) => lpad(v ?? '', len);
  const n = (v: string | null, len: number) => rpad(v ?? '0', len);
  let rec = '';
  rec += '1';                                      // 1: データ区分
  rec += '21';                                     // 2-3: 種別コード（総合振込）
  rec += '0';                                      // 4: コード区分（JIS）
  rec += n(settings.requestor_code ?? '0', 10);   // 5-14: 依頼人コード
  rec += f(settings.company_name_kana ?? '', 40); // 15-54: 依頼人名
  rec += lpad(paymentDate, 4);                    // 55-58: 振込指定日MMDD
  rec += n(settings.bank_code ?? '0', 4);         // 59-62: 仕向銀行番号
  rec += lpad('', 15);                            // 63-77: 仕向銀行名（省略）
  rec += n(settings.branch_code ?? '0', 3);       // 78-80: 仕向支店番号
  rec += lpad('', 15);                            // 81-95: 仕向支店名（省略）
  rec += (settings.account_type ?? '1');          // 96: 預金種目
  rec += n(settings.account_number ?? '0', 7);   // 97-103: 口座番号
  rec += lpad('', 17);                            // 104-120: ダミー
  return rec;
}

function buildDataRecord(item: ZenginItem): string {
  let rec = '';
  rec += '2';                                 // 1: データ区分
  rec += rpad(item.bank_code, 4);            // 2-5: 被仕向銀行番号
  rec += lpad('', 15);                       // 6-20: 被仕向銀行名（省略）
  rec += rpad(item.branch_code, 3);          // 21-23: 被仕向支店番号
  rec += lpad('', 15);                       // 24-38: 被仕向支店名（省略）
  rec += '0000';                             // 39-42: 手形交換所番号
  rec += item.account_type;                 // 43: 預金種目
  rec += rpad(item.account_number, 7);      // 44-50: 口座番号
  rec += lpad(item.account_name_kana, 30); // 51-80: 受取人名
  rec += rpad(item.amount, 10);             // 81-90: 振込金額
  rec += '0';                               // 91: 新規コード
  rec += lpad('', 20);                      // 92-111: EDI情報
  rec += lpad('', 9);                       // 112-120: ダミー
  return rec;
}

function buildTrailer(count: number, total: number): string {
  let rec = '';
  rec += '8';                  // 1: データ区分
  rec += rpad(count, 6);      // 2-7: 合計件数
  rec += rpad(total, 12);     // 8-19: 合計金額
  rec += lpad('', 101);       // 20-120: ダミー
  return rec;
}

function buildEnd(): string {
  return '9' + lpad('', 119); // 1 + 119 = 120
}

// ─── ハンドラ ──────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId') || null;
  const paymentDate = (searchParams.get('paymentDate') ?? '').replace(/-/g, '').slice(4, 8); // MMDD
  const idsParam = searchParams.get('ids') ?? '';
  const ids = idsParam ? idsParam.split(',').filter(Boolean) : [];

  if (!paymentDate || paymentDate.length !== 4) {
    return NextResponse.json({ error: '振込日（paymentDate: YYYY-MM-DD）が必要です' }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: '振込対象レコードID（ids）が必要です' }, { status: 400 });
  }

  const service = createServiceClient();

  // 自社銀行情報
  let settingsQuery = service.from('company_settings').select('*').eq('user_id', user.id);
  if (clientId) settingsQuery = settingsQuery.eq('client_id', clientId);
  else settingsQuery = settingsQuery.is('client_id', null);
  const { data: settingsRow } = await settingsQuery.maybeSingle();
  const settings: CompanySettings = settingsRow ?? {
    company_name_kana: null, bank_code: null, branch_code: null,
    account_type: '1', account_number: null, account_name_kana: null, requestor_code: null,
  };

  // AR/AP レコード（買掛金のみ想定）
  const { data: arApRows, error: arApErr } = await service
    .from('ar_ap_records')
    .select('id, counterparty, amount, paid_amount')
    .eq('user_id', user.id)
    .in('id', ids);
  if (arApErr) return NextResponse.json({ error: arApErr.message }, { status: 500 });

  // 対応する vendors の銀行情報を counterparty 名で引く
  const counterparties = [...new Set((arApRows ?? []).map((r) => r.counterparty as string))];
  const { data: vendorRows } = await service
    .from('vendors')
    .select('name, bank_code, branch_code, account_type, account_number, account_name_kana')
    .eq('user_id', user.id)
    .in('name', counterparties);

  const vendorMap = new Map((vendorRows ?? []).map((v) => [v.name, v]));

  const items: ZenginItem[] = [];
  const missing: string[] = [];

  for (const rec of (arApRows ?? [])) {
    const remaining = Number(rec.amount) - Number(rec.paid_amount);
    if (remaining <= 0) continue;
    const vendor = vendorMap.get(rec.counterparty);
    if (!vendor?.bank_code || !vendor?.branch_code || !vendor?.account_number || !vendor?.account_name_kana) {
      missing.push(rec.counterparty);
      continue;
    }
    items.push({
      bank_code: vendor.bank_code,
      branch_code: vendor.branch_code,
      account_type: vendor.account_type ?? '1',
      account_number: vendor.account_number,
      account_name_kana: vendor.account_name_kana,
      amount: Math.round(remaining),
    });
  }

  if (missing.length > 0) {
    return NextResponse.json({ error: `以下の取引先に銀行情報が未登録です: ${missing.join(', ')}` }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: '振込対象の残高がありません' }, { status: 400 });
  }

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);
  const lines = [
    buildHeader(settings, paymentDate),
    ...items.map(buildDataRecord),
    buildTrailer(items.length, totalAmount),
    buildEnd(),
  ];
  const text = lines.join('\r\n') + '\r\n';

  // Shift-JIS エンコード → ArrayBuffer へ変換
  const nodeBuffer: Buffer = encode(text, 'Shift_JIS');
  const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength) as ArrayBuffer;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = encodeURIComponent(`全銀振込_${dateStr}.txt`);

  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
