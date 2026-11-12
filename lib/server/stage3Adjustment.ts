import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { stage2StatusOf, type Stage2Status } from '@/lib/cascade/stage2Status';

const ACCESS_ROLES = ['admin', 'manager', 'member'] as const;

export type StrategyAccess = {
  userId: string;
  role: string;
  companyId: string;
  strategyId: string;
  revision: number;
  departments: unknown[];
  stage2: Stage2Status;
};

export type AccessFailure = { ok: false; status: number; error: string };

/**
 * 所属・戦略の照合を行う。戦略が同じ会社のものであることを、読み書きのたびに確かめる。DBへは書き込まない。
 * 全社戦略は STAGE2 の保存済み確定版だけを読む（確定していなければ companyStrategy は null）。
 */
export async function loadStrategyAccess(
  admin: SupabaseClient,
  req: Request,
  ids: { companyId: string; strategyId: string },
): Promise<{ ok: true; access: StrategyAccess } | AccessFailure> {
  const userId = await getAuthUserIdFromBearer(admin, req);
  if (!userId) return { ok: false, status: 401, error: 'unauthorized' };

  const membership = await admin
    .from('company_members')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', ids.companyId)
    .limit(1);
  if (membership.error) return { ok: false, status: 503, error: 'membership_check_unavailable' };
  const role = String(membership.data?.[0]?.role ?? '');
  if (!(ACCESS_ROLES as readonly string[]).includes(role)) return { ok: false, status: 403, error: 'forbidden' };

  const strategy = await admin
    .from('strategy_data')
    .select('id, company_id, revision, departments, stage2_final_document_edits, final_story_final')
    .eq('id', ids.strategyId)
    .maybeSingle();
  if (strategy.error) return { ok: false, status: 503, error: 'strategy_check_unavailable' };
  if (!strategy.data || strategy.data.company_id !== ids.companyId) {
    return { ok: false, status: 403, error: 'strategy_mismatch' };
  }
  if (!Array.isArray(strategy.data.departments)) return { ok: false, status: 409, error: 'unverifiable_departments' };

  const stage2 = stage2StatusOf(strategy.data.stage2_final_document_edits, strategy.data.final_story_final);
  return {
    ok: true,
    access: {
      userId,
      role,
      companyId: ids.companyId,
      strategyId: ids.strategyId,
      revision: Number(strategy.data.revision ?? 0),
      departments: strategy.data.departments,
      stage2,
    },
  };
}

/** 分析・再生成は、STAGE2の確定版がある戦略だけを対象にする。未確定と本文欠落は別のエラーにする。 */
export function requireConfirmedStrategy(access: StrategyAccess): { ok: true; companyStrategy: string } | AccessFailure {
  if (access.stage2.status === 'confirmed') return { ok: true, companyStrategy: access.stage2.companyStrategy };
  if (access.stage2.status === 'story_missing') return { ok: false, status: 409, error: 'stage2_story_missing' };
  return { ok: false, status: 409, error: 'stage2_not_confirmed' };
}
