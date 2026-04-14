import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, isAdmin: false });
  }
  return NextResponse.json({
    authenticated: true,
    isAdmin: user.email === process.env.ADMIN_EMAIL,
  });
}
