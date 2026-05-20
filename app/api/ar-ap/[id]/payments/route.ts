import { NextResponse } from 'next/server';

/**
 * 売掛金・買掛金は仕訳から自動派生するため、消込明細 API は廃止。
 * 消込は「支払/入金の仕訳を立てる」（借方=AP系科目 or 貸方=AR系科目 / 普通預金 等）に統一。
 */

export const maxDuration = 5;

export async function POST() {
  return NextResponse.json(
    {
      error: '消込は仕訳画面から支払/入金仕訳を作成してください（借方: 買掛金/未払金 → 貸方: 普通預金 等）。',
    },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: '消込仕訳は仕訳画面から削除してください。',
    },
    { status: 410 },
  );
}
