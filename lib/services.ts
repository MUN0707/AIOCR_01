// 統合申込みフォームで使う、サービス・プラン定義の中央レジストリ。
// Invoice OCR と 税理士向けメルマガの2サービス分をここに集約する。

export type ServiceId = 'aiocr' | 'merumaga';

export type AiocrPlanId = 'lite' | 'standard' | 'pro' | 'enterprise';
export type MerumagaPlanId = 'tier1' | 'tier2' | 'tier3';

export type ServiceDef = {
  id: ServiceId;
  name: string;
  shortName: string;
  description: string;
  lpUrl: string;
  accent: string; // tailwind color base ('sky' | 'emerald' 等)
};

export const SERVICES: Record<ServiceId, ServiceDef> = {
  aiocr: {
    id: 'aiocr',
    name: '請求書 PDF 分割ツール（Invoice OCR）',
    shortName: 'Invoice OCR',
    description: '請求書 PDF を AI が解析し、自動で分割・命名・ZIP 一括 DL。',
    lpUrl: 'https://invoice-ocr-tawny.vercel.app/lp/invoice',
    accent: 'sky',
  },
  merumaga: {
    id: 'merumaga',
    name: '税理士事務所スタッフ育成メルマガ',
    shortName: '育成メルマガ',
    description: 'スタッフのよくあるミスを週1配信・10分で学べる。年52号で税務実務を網羅。',
    lpUrl: 'https://mail.taxbestsearch.com/',
    accent: 'emerald',
  },
};

export const AIOCR_PLANS: Record<
  AiocrPlanId,
  { id: AiocrPlanId; name: string; price: number; limit: string; description: string }
> = {
  lite: { id: 'lite', name: 'ライト', price: 1500, limit: '30件/月', description: '個人事業主・少量処理向け' },
  standard: { id: 'standard', name: 'スタンダード', price: 3980, limit: '100件/月', description: '1人税理士・少数顧問先向け' },
  pro: { id: 'pro', name: 'プロ', price: 9800, limit: '300件/月', description: '税理士事務所・15社規模向け' },
  enterprise: { id: 'enterprise', name: 'エンタープライズ', price: 19800, limit: '1,000件/月', description: '大規模事務所・法人向け' },
};

export const MERUMAGA_PLANS: Record<
  MerumagaPlanId,
  { id: MerumagaPlanId; name: string; range: string; price: number; maxMembers: number | null }
> = {
  tier1: { id: 'tier1', name: '〜10人', range: '従業員10人まで', price: 3000, maxMembers: 10 },
  tier2: { id: 'tier2', name: '〜20人', range: '従業員11〜20人', price: 4000, maxMembers: 20 },
  tier3: { id: 'tier3', name: '20人超', range: '従業員21人以上', price: 5000, maxMembers: null },
};

export function merumagaPlanFromMemberCount(count: number): MerumagaPlanId {
  if (count <= 10) return 'tier1';
  if (count <= 20) return 'tier2';
  return 'tier3';
}

export function merumagaFeeFromMemberCount(count: number): number {
  return MERUMAGA_PLANS[merumagaPlanFromMemberCount(count)].price;
}

// マイページから各サービスの管理画面へのリンク先
export const MERUMAGA_DASHBOARD_URL = 'https://mail.taxbestsearch.com/dashboard';
