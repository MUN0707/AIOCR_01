/**
 * 取引先名の正規化キー生成
 * 株式会社A / ㈱A / (株)A / A社 / Ａ などを同一視するための名寄せキー。
 */
export function normalizeVendorKey(name: string): string {
  if (!name) return '';
  return name
    // 法人格を除去
    .replace(/株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|NPO法人|医療法人|学校法人|宗教法人|社会福祉法人/g, '')
    .replace(/㈱|㈲|㈳|㈵/g, '')
    .replace(/（株）|\(株\)|（有）|\(有\)|（合）|\(合\)/g, '')
    // 末尾の「社」「グループ」など軽い接尾辞は残す（誤マージ防止）
    // 全角英数→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    // 全角スペース・半角スペース・記号類を除去
    .replace(/[　\s・･\-_／/]/g, '')
    .toLowerCase()
    .trim();
}
