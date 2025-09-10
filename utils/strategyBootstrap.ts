// /utils/strategyBootstrap.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * サインイン済み userId から strategy_data を「サーバAPI経由で」取得 or 作成して ID を返す。
 * - クライアント直 upsert は行わない（RLS/必須列/会社解決の問題を避ける）
 * - まず /api/companies/provision を叩き、404なら /api/provision にフォールバック
 * - 成功レスポンスは { ok: true, companyId, strategyId } を期待
 */
export async function ensureStrategyId(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  if (!userId) {
    throw new Error('userId が未定義です（ログイン状態を確認してください）');
  }

  // セッションからアクセストークンを取得
  const { data: ses } = await supabase.auth.getSession();
  const token = ses?.session?.access_token;
  if (!token) {
    throw new Error('ログインセッションが見つかりません（access_token なし）');
  }

  // 1st: /api/companies/provision
  const primaryUrl = '/api/companies/provision';
  const altUrl = '/api/provision'; // 2nd: 互換ルート（環境によっては存在しない）

  // 実際の呼び出し
  const call = async (url: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // レスポンスを robust にパース
    const raw = await res.text();
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* noop */ }

    // 成功
    if (res.ok && json?.ok && typeof json?.strategyId === 'string' && json.strategyId) {
      return { ok: true as const, strategyId: json.strategyId as string, companyId: json?.companyId as string | undefined };
    }

    // 404 はフォールバック対象にする
    if (res.status === 404) {
      return { ok: false as const, notFound: true as const, error: json?.error || `404 Not Found: ${url}` };
    }

    // その他はエラー詳細を返す
    const detail = json?.error || raw || `HTTP ${res.status}`;
    return { ok: false as const, notFound: false as const, error: detail };
  };

  // まず primary を叩く
  const r1 = await call(primaryUrl);
  if (r1.ok) return r1.strategyId;

  // 404 のときのみ alt へ
  if (r1.notFound) {
    const r2 = await call(altUrl);
    if (r2.ok) return r2.strategyId;

    // alt も失敗した場合
    throw new Error(
      `[provision API 失敗] ${altUrl}: ${r2.error}`
    );
  }

  // primary が 404 以外の失敗
  throw new Error(
    `[provision API 失敗] ${primaryUrl}: ${r1.error}`
  );
}
