// /lib/authUtils.ts
/**
 * JWT認証ユーティリティ
 * API ハンドラと middleware で共通利用
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Bearer token から認証済みユーザーの ID を取得（署名検証済み）
 * Supabase の auth.getUser(token) で署名検証を実施
 * 失敗時は null を返す
 */
export async function getAuthenticatedUserIdWithVerification(
  req: Request
): Promise<string | null> {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;

    if (!token) {
      return null;
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);

    if (error || !data.user?.id) {
      return null;
    }

    return data.user.id;
  } catch (error) {
    return null;
  }
}

/**
 * リクエストが認証済みかを確認（署名検証済み）
 * true の場合、ユーザーは認証済み
 */
export async function isAuthenticatedWithVerification(req: Request): Promise<boolean> {
  const userId = await getAuthenticatedUserIdWithVerification(req);
  return userId !== null;
}
