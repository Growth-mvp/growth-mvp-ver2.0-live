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

/**
 * Rate limit キー生成専用の JWT parser（署名検証なし）
 * ⚠️ 重要: 認証・認可判定には絶対に使用しないこと
 * このメソッドは Base64 デコードのみで、署名検証を行いません
 * Rate limit キー生成など、セキュリティに関わらない用途のみ
 * 認証が必要な場面では必ず getAuthenticatedUserIdWithVerification() を使用してください
 */
export function extractSubFromJWTForRateLimit(token: string): string | null {
  try {
    // Bearer token は通常 3 パートに分かれている: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // payload をデコード（Base64URL）- 署名検証なし
    const payload = parts[1];
    if (!payload) {
      return null;
    }

    // Base64URL をデコード
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);

    // sub claim を取得
    return typeof parsed.sub === 'string' && parsed.sub.length > 0 ? parsed.sub : null;
  } catch (error) {
    // デコード失敗時は null
    return null;
  }
}
