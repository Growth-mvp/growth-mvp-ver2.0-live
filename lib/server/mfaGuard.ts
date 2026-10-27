import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decideMfaAccess } from '@/lib/auth/mfaPolicy';

export type MfaGuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; error: 'unauthorized' | 'mfa_required' | 'invalid_aal' | 'mfa_check_unavailable' };

function bearerToken(req: Request): string | null {
  const match = /^bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
  return match ? match[1] : null;
}

/**
 * 保護対象のルートで使う MFA ガード。
 * - JWT は署名と期限を検証する（getClaims）。不正・期限切れは 401。
 * - aal は JWT のクレームから読む。検証済みの要素の有無は管理 API で確認する。
 * - 判定は lib/auth/mfaPolicy.ts の decideMfaAccess に任せる。
 * 注意: 環境の確認（接続先のプロジェクト）には、この JWT の内容を使わない。
 */
export async function requireMfaSatisfied(admin: SupabaseClient, req: Request): Promise<MfaGuardResult> {
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

  const decision = decideMfaAccess({ aal, hasVerifiedFactor });
  if (!decision.allowed) {
    return { ok: false, status: 403, error: decision.reason };
  }
  return { ok: true, userId };
}
