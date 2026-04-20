import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

/**
 * GET /api/match-logs/latest?clientId=xxx
 * 指定クライアントの最新照合ログを返す（照合結果の復元用）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const clientId = request.nextUrl.searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'clientId が必要です' }, { status: 400 });
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from('journal_match_logs')
      .select('id, results, summary, created_at')
      .eq('user_id', user.id)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ log: null });
    }

    return NextResponse.json({
      log: {
        id: data.id,
        results: data.results,
        summary: data.summary,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('match-logs/latest エラー:', error);
    return NextResponse.json({ error: '照合ログの取得に失敗しました' }, { status: 500 });
  }
}
