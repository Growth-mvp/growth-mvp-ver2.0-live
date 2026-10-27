import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decideMfaAccess } from '@/lib/auth/mfaPolicy';

export type AdminMfaResult =
  | { ok: true; userId: string; isAdmin: boolean }
  | {
      ok: false;
      status: 401 | 403 | 503;
      error:
        | 'unauthorized'
        | 'mfa_enrollment_required'
        | 'mfa_required'
        | 'invalid_aal'
        | 'mfa_check_unavailable';
    };

function bearerToken(req: Request): string | null {
  const match = /^bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
  return match ? match[1] : null;
}

/**
 * 管理者操作の前に呼ぶ MFA ガード。
 * - JWT は署名と期限を検証する（getClaims）。不正・期限切れは 401。
 * - 管理者（どの会社でも company_members.role = admin）でなければ判定しない。権限の可否は各ルートが決める。
 * - 管理者は MFA の登録が必須。未登録は 403 mfa_enrollment_required。
 * - 登録済みの管理者は aal2 が必須（判定は decideMfaAccess）。
 * 注意: 環境の確認（接続先のプロジェクト）には、この JWT の内容を使わない。
 */
export async function requireAdminMfa(admin: SupabaseClient, req: Request): Promise<AdminMfaResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };

  let userId: string;
  let aal: unknown;
  try {
    const { data, error } = await admin.auth.getClaims(token);
    if (error || !data?.claims?.sub) return { ok: false, status: 401, error: 'unauthorized' };
    userId = data.claims.sub as string;
    aal = data.claims.aal;
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  let isAdmin: boolean;
  try {
    const { data, error } = await admin
      .from('company_members')
      .select('company_id')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .limit(1);
    if (error || !Array.isArray(data)) return { ok: false, status: 503, error: 'mfa_check_unavailable' };
    isAdmin = data.length > 0;
  } catch {
    return { ok: false, status: 503, error: 'mfa_check_unavailable' };
  }
  if (!isAdmin) return { ok: true, userId, isAdmin: false };

  let hasVerifiedFactor: boolean;
  try {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error || !data || !Array.isArray(data.factors)) {
      return { ok: false, status: 503, error: 'mfa_check_unavailable' };
    }
    hasVerifiedFactor = data.factors.some((f: { status?: string }) => f.status === 'verified');
  } catch {
    return { ok: false, status: 503, error: 'mfa_check_unavailable' };
  }
  if (!hasVerifiedFactor) return { ok: false, status: 403, error: 'mfa_enrollment_required' };

  const decision = decideMfaAccess({ aal, hasVerifiedFactor });
  if (!decision.allowed) {
    return { ok: false, status: 403, error: decision.reason };
  }
  return { ok: true, userId, isAdmin: true };
}
