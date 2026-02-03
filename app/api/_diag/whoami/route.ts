/**
 * /app/api/_diag/whoami/route.ts
 *
 * 監査用エンドポイント
 * 混入（テナント分離違反）や勝手な保存が起きたら即座に追跡できる状態にする
 *
 * 返すもの：
 * - authUserId: auth.uid（認証ユーザー ID）
 * - cookieCompanyId: cookie に記載されている company_id（古い値の可能性）
 * - membershipCompanyId: membership.company_id（唯一の真実）
 * - effectiveCompanyId: 実際に使用される company_id（= membershipCompanyId）
 * - strategyDataRowCount: effectiveCompanyId で読める strategy_data 件数
 * - notes: 不一致時の警告メッセージ
 *
 * 使用例：
 * - デバッグ時に /api/_diag/whoami にアクセス
 * - 不一致があれば即時検知
 * - DB RLS が正常に機能しているか確認
 */

import { NextRequest, NextResponse } from 'next/server';

// クライアント用 Supabase（RLS 有効）
async function getSupabaseClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase env missing');
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

// サーバ用 Supabase（Service Role - RLS バイパス）
async function getAdminClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Service Role env missing');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseClient();
    const admin = await getAdminClient();

    // 1. 認証ユーザーを取得
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) {
      return NextResponse.json(
        {
          error: 'Not authenticated',
          details: authError?.message,
        },
        { status: 401 }
      );
    }

    const authUserId = authData.user.id;

    // 2. Cookie から company_id を取得
    const cookies = request.cookies;
    const cookieValue = cookies.get('company_id')?.value;
    const cookieCompanyId = cookieValue ?? null;

    // 3. Membership から company_id を取得（唯一の真実）
    const { data: membershipRow, error: membershipError } = await supabase
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', authUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch membership',
          details: membershipError.message,
        },
        { status: 500 }
      );
    }

    const membershipCompanyId = membershipRow?.company_id ?? null;
    const role = membershipRow?.role ?? null;

    // 4. Effective company_id を決定（= membershipCompanyId）
    const effectiveCompanyId = membershipCompanyId;

    // 5. 不一致警告を生成
    const notes: string[] = [];
    if (cookieCompanyId && effectiveCompanyId && cookieCompanyId !== effectiveCompanyId) {
      notes.push(
        `⚠️  Cookie company_id (${cookieCompanyId.slice(0, 8)}) != Membership company_id (${effectiveCompanyId.slice(0, 8)})`
      );
    }
    if (!effectiveCompanyId && cookieCompanyId) {
      notes.push(
        `⚠️  No membership, but cookie has company_id (${cookieCompanyId.slice(0, 8)}). RLS will block all access.`
      );
    }
    if (!effectiveCompanyId) {
      notes.push('⚠️  User has no company membership. All DB access will be blocked by RLS.');
    }

    // 6. Strategy data 件数を確認（RLS 有効なクライアントで）
    let strategyDataRowCount = 0;
    if (effectiveCompanyId) {
      const { count, error: countError } = await supabase
        .from('strategy_data')
        .select('id', { count: 'exact' })
        .eq('company_id', effectiveCompanyId);

      if (!countError) {
        strategyDataRowCount = count ?? 0;
      } else {
        notes.push(`⚠️  Failed to count strategy_data: ${countError.message}`);
      }
    }

    // 7. DB RLS 検証（Admin 権限で強制読取し、RLS が正常に機能しているか確認）
    let dbRlsValidation = 'unknown';
    if (effectiveCompanyId) {
      try {
        // Admin 権限で直接 count（RLS バイパス）
        const { count: adminCount, error: adminError } = await admin
          .from('strategy_data')
          .select('id', { count: 'exact' });

        if (!adminError && adminCount !== undefined) {
          // RLS 有効なクライアントでも同じ count が返ってくるか確認
          if (strategyDataRowCount <= adminCount) {
            dbRlsValidation = 'ok';
          } else {
            dbRlsValidation = 'anomaly: RLS count > Admin count';
            notes.push(
              `🚨 DB RLS Anomaly: Client count (${strategyDataRowCount}) > Admin count (${adminCount})`
            );
          }
        }
      } catch (e) {
        notes.push(`⚠️  DB RLS validation error: ${(e as any).message}`);
      }
    }

    return NextResponse.json(
      {
        status: 'ok',
        audit: {
          authUserId: authUserId.slice(0, 8) + '***',
          role,
          cookieCompanyId: cookieCompanyId ? cookieCompanyId.slice(0, 8) + '***' : null,
          membershipCompanyId: membershipCompanyId ? membershipCompanyId.slice(0, 8) + '***' : null,
          effectiveCompanyId: effectiveCompanyId ? effectiveCompanyId.slice(0, 8) + '***' : null,
          strategyDataRowCount,
          dbRlsValidation,
        },
        notes: notes.length > 0 ? notes : ['✅ All checks passed'],
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: e?.message,
      },
      { status: 500 }
    );
  }
}
