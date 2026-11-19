import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertMinRole, getAuthUserIdFromBearer, requireMembership, resolveCompanyIdFromStrategyId } from '@/lib/server/rbacGuard';

export type AutofillAuth = { userId: string; companyId: string; strategyId: string };

export const isAutofillDisabled = (): boolean => process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true';

/** 停止設定・認証・役割（manager以上）・戦略と会社の対応を、サーバーで確認する */
export async function authorizeAutofill(req: Request, companyId: string, strategyId: string): Promise<{ ok: true; auth: AutofillAuth } | { ok: false; response: NextResponse }> {
  if (isAutofillDisabled()) return { ok: false, response: NextResponse.json({ error: 'autofill_disabled' }, { status: 503 }) };
  const admin = getSupabaseAdmin();
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const membership = await requireMembership(admin, userId, companyId);
  if (!membership) return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  try {
    await assertMinRole(membership, 'manager');
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'insufficient_role' }, { status: 403 }) };
  }
  const strategyCompany = await resolveCompanyIdFromStrategyId(admin, strategyId);
  if (strategyCompany !== companyId) return { ok: false, response: NextResponse.json({ error: 'strategy_mismatch' }, { status: 403 }) };
  return { ok: true, auth: { userId, companyId, strategyId } };
}

export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
