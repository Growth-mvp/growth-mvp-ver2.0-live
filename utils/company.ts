// /utils/company.ts
import { supabase } from '@/utils/supabase/client';

/** PostgREST エラーをざっくり解析（列不存在 42703 などの判定用） */
function looksMissingColumn(errOrResp: unknown, col: string) {
  const e: any = errOrResp && typeof errOrResp === 'object' ? errOrResp : {};
  const info = {
    code: e?.code ?? e?.error?.code ?? '',
    message: e?.message ?? e?.error?.message ?? '',
    details: e?.details ?? e?.error?.details ?? '',
  };
  const msg = `${info.code} ${info.message} ${info.details}`.toLowerCase();
  return (
    info.code === '42703' ||
    msg.includes(col.toLowerCase()) ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

/**
 * ユーザーの所属 company_id を解決する。
 * - まずは updated_at / created_at で「新しい順」を試す
 * - **列が無い/スキーマ差異**の場合は、company_id のみで再取得（順不同・先頭1件）
 * - 0件でもエラーにしない（maybeSingle）
 * - RLS/通信エラー時は null を返す
 */
export async function resolveCompanyId(userId?: string): Promise<string | null> {
  if (!userId) return null;

  // 1) “新しい順”（列が存在する環境向け）
  const q1 = await supabase
    .from('company_members')
    .select('company_id, updated_at, created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 成功
  if (!q1.error && q1.data?.company_id) {
    return String(q1.data.company_id);
  }

  // 列が無い / スキーマ差異 → フォールバック
  if (q1.error && (looksMissingColumn(q1.error, 'updated_at') || looksMissingColumn(q1.error, 'created_at'))) {
    const q2 = await supabase
      .from('company_members')
      .select('company_id') // 最小列
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!q2.error && q2.data?.company_id) {
      return String(q2.data.company_id); // 順不同だが 1件は拾える
    }
    if (q2.error) {
      console.error('resolveCompanyId fallback error', {
        code: (q2.error as any)?.code,
        message: (q2.error as any)?.message,
        details: (q2.error as any)?.details,
      });
    }
    return null; // 0件 or RLS 等
  }

  // その他の“本当の”エラー
  if (q1.error) {
    console.error('resolveCompanyId error', {
      code: (q1.error as any)?.code,
      message: (q1.error as any)?.message,
      details: (q1.error as any)?.details,
    });
  }
  // 0件 or RLS 等
  return null;
}
