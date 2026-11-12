// /app/api/stage3/strategy-book/project-references/route.ts
// STAGE3: 既存プロジェクトを「計画から外す」前に、STAGE4以降から参照されているかを読み取り専用で調べる。
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { failResponse } from '@/lib/server/stage3DepartmentWrite';
import { loadStrategyAccess } from '@/lib/server/stage3Adjustment';
import { findProjectReferences } from '@/lib/server/stage3ProjectReferences';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  projectIds: z.array(z.string().min(1).max(200)).max(60),
});

export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failResponse(400, 'invalid_request');
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const access = await loadStrategyAccess(admin, req, body);
    if (!access.ok) return failResponse(access.status, access.error);

    const result = await findProjectReferences(admin, body);
    if (!result.ok) return failResponse(503, result.error);
    return NextResponse.json({ ok: true, references: result.references });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
