// /app/api/debug/strategy/route.ts
import { NextResponse } from 'next/server';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId') || '';
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const { data, error } = await getFullStrategyDataByCompany(companyId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({
    hasData: !!data,
    departmentsCount: Array.isArray(data?.departments) ? data!.departments.length : 0,
    sample0: data?.departments?.[0] ?? null,
    raw: data,
  });
}
