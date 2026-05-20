import { NextResponse } from 'next/server';

/**
 * 売掛金・買掛金は仕訳から自動派生するため、PATCH/DELETE は廃止。
 * 既存ファイルは 410 Gone を返すスタブとして残し、誤呼び出しを安全に検出する。
 */

export const maxDuration = 5;

export async function PATCH() {
  return NextResponse.json(
    {
      error: '売掛金・買掛金は仕訳から自動派生する方式に変更されました。仕訳画面から該当仕訳を編集してください。',
    },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: '売掛金・買掛金は仕訳から自動派生する方式に変更されました。仕訳画面から該当仕訳を削除してください。',
    },
    { status: 410 },
  );
}
