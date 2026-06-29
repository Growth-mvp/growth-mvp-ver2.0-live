// /lib/authUtils.ts
/**
 * JWT認証ユーティリティ
 * API ハンドラと middleware で共通利用
 */

/**
 * Bearer token から JWT ペイロードの sub (subject) を抽出
 * 署名検証は行わない（API側で実施）
 * デコード失敗や無効な形式の場合は null を返す
 */
export function extractSubFromBearerToken(token: string): string | null {
  try {
    // Bearer token は通常 3 パートに分かれている: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // payload をデコード（Base64URL）
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
    // デコード失敗時は null（無効な token 扱い）
    return null;
  }
}

/**
 * リクエストの Authorization ヘッダから認証済みユーザーの sub を取得
 * 失敗時は null を返す
 */
export function getAuthenticatedUserSub(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;

  if (!token) {
    return null;
  }

  return extractSubFromBearerToken(token);
}

/**
 * リクエストが認証済みかを確認
 * true の場合、ユーザーは認証済み
 */
export function isAuthenticated(req: Request): boolean {
  return getAuthenticatedUserSub(req) !== null;
}
