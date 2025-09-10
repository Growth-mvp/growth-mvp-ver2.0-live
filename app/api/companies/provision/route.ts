// /app/api/companies/provision/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerUser } from '@/lib/supabaseServer'; // Cookie セッションから user を取得

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// createClient の戻りと合わせた型
type AdminClient = SupabaseClient<any, 'public', any>;

type Body = {
  companyName?: string;
  /** 任意: company_members に列がある場合だけ使われます */
  departmentId?: string | null;
};

function json(status: number, obj: unknown, cookies?: string[]) {
  const res = NextResponse.json(obj, { status });
  if (cookies && cookies.length) {
    cookies.forEach((c) => res.headers.append('Set-Cookie', c));
  }
  return res;
}

function getBearer(req: NextRequest) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^\s*Bearer\s+(.+)\s*$/i);
  return m?.[1] ?? null;
}

/** フォールバック用の会社名を生成（UTCタイムスタンプ入り） */
function makeDefaultCompanyName(email?: string | null) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  if (email) return `Company of ${email} (${ts})`;
  return `My Company (${ts})`;
}

/** Set-Cookie: company_id */
function buildCompanyCookie(companyId: string, isHttps: boolean) {
  const attrs = [
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`, // 30 days
    isHttps ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
  return `company_id=${encodeURIComponent(companyId)}; ${attrs}`;
}

/**
 * strategy_data の初期行を「存在しなければ」作成し、
 * 既存/新規に関わらず strategyId を返す。
 */
async function ensureStrategySeed(
  admin: AdminClient,
  userId: string,
  companyId: string
): Promise<{ ok: true; created: boolean; strategyId: string } | { ok: false; error: any }> {
  // 既存チェック
  const existed = await admin
    .from('strategy_data')
    .select('id')
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();

  if (!existed.error && existed.data?.id) {
    return { ok: true, created: false, strategyId: String(existed.data.id) };
  }

  // 挿入（snake_case カラムで投入）
  const now = new Date().toISOString();
  const seed = {
    company_id: companyId,
    user_id: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,

    // 文字列系は空でOK
    company_name: '',
    foundation_year: '',
    location: '',
    industry: '',
    revenue: '',
    employees: '',
    business_content: '',
    customer_segment: '',
    thought: '',
    mission: '',
    vision: '',
    value: '',
    strength: '',
    weakness: '',
    opportunity: '',
    threat: '',

    // JSONB は必ず NOT NULL で投入
    departments: [] as unknown[],
    story: [] as unknown[],
    answers2: [] as unknown[],
    final_story: [] as unknown[],
    csv_finance_data: {} as Record<string, unknown>,

    // 列が存在すれば保存される（無ければ無視される）
    strategy_summary: null as unknown,
    editable_cascade: null as unknown,
    editable_cascade_result: null as unknown,
  };

  const ins = await admin.from('strategy_data').insert([seed]).select('id').single();

  if (ins.error) {
    const code = (ins as any).error?.code;
    if (code === '23505' || code === '409') {
      // 重複等の競合は再取得で拾う
      const re = await admin
        .from('strategy_data')
        .select('id')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();
      if (!re.error && re.data?.id) {
        return { ok: true, created: false, strategyId: String(re.data.id) };
      }
      return { ok: false, error: ins.error };
    }
    return { ok: false, error: ins.error };
  }

  return { ok: true, created: true, strategyId: String(ins.data?.id) };
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { ok: false, code: 'server_not_configured' });
  }

  // Service Role（RLS無視）クライアント
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  }) as AdminClient;

  try {
    // 1) 認証: まず Cookie（App Router 推奨）→ ダメなら Bearer
    let userId: string | null = null;
    let userEmail: string | null = null;

    // 1-1) Cookie セッション（App Router）経由
    try {
      const { user } = await getServerUser();
      if (user?.id) {
        userId = user.id as string;
        userEmail = (user.email as string) ?? null;
      }
    } catch {
      /* noop */
    }

    // 1-2) Bearer が来ていれば上書き
    if (!userId) {
      const token = getBearer(req);
      if (!token) return json(401, { ok: false, code: 'no_auth', message: 'cookie or bearer required' });

      const { data: ures, error: uerr } = await admin.auth.getUser(token);
      if (uerr || !ures?.user?.id) {
        return json(401, { ok: false, code: 'invalid_token', details: uerr });
      }
      userId = ures.user.id as string;
      userEmail = (ures.user.email as string) ?? null;
    }

    // 2) 入力
    let body: Body = {};
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        body = (await req.json()) as Body;
      }
    } catch {
      // body なしでもOK（companyName は後でフォールバック生成）
    }

    const companyNameRaw = (body.companyName || '').trim();
    const companyName = companyNameRaw || makeDefaultCompanyName(userEmail);
    const departmentId = body.departmentId ?? null;

    // 3) 既所属チェック（多重作成防止）→ 成功扱いで返す
    {
      const { data: ex, error: exErr } = await admin
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId!)
        .maybeSingle();

      if (!exErr && ex?.company_id) {
        // 既所属でも strategy_data が無いケースがあるので seed を試みる
        const seeded = await ensureStrategySeed(admin, userId!, String(ex.company_id));
        const cookie = buildCompanyCookie(String(ex.company_id), req.nextUrl.protocol === 'https:');

        return json(
          200,
          {
            ok: true,
            companyId: ex.company_id,
            strategyId: seeded.ok ? seeded.strategyId : null, // ★ 追加
            note: 'already_in_company',
          },
          [cookie],
        );
      }
    }

    // 4) RPC があれば優先（原子・冪等）
    const { data: rpcData, error: rpcErr } = await admin.rpc('provision_company', {
      p_user_id: userId!,
      p_company_name: companyName,
    });

    if (!rpcErr && rpcData) {
      const cid = String(rpcData);
      const seeded = await ensureStrategySeed(admin, userId!, cid);
      const cookie = buildCompanyCookie(cid, req.nextUrl.protocol === 'https:');

      return json(
        200,
        {
          ok: true,
          companyId: cid,
          strategyId: seeded.ok ? seeded.strategyId : null, // ★ 追加
          via: 'rpc',
        },
        [cookie],
      );
    }

    // 5) フォールバック（手動原子処理）
    // 5-1) companies 作成
    const { data: insCompany, error: insErr } = await admin
      .from('companies')
      .insert([{ name: companyName, created_by: userId! }])
      .select('id')
      .single();

    if (insErr || !insCompany?.id) {
      return json(500, {
        ok: false,
        code: 'create_company_failed',
        details: insErr,
        rpcError: rpcErr,
      });
    }
    const companyId = String(insCompany.id);

    // 5-2) 自分を admin で参加（冪等）
    const payload: Record<string, any> = {
      company_id: companyId,
      user_id: userId!,
      role: 'admin',
    };
    if (departmentId !== null) payload['department_id'] = departmentId;

    let insMember = await admin.from('company_members').upsert(payload, {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: false,
    });

    // 列なし（undefined_column）フォールバック
    if (insMember.error && (insMember as any).error?.code === '42703') {
      const payloadNoDept = { company_id: companyId, user_id: userId!, role: 'admin' };
      insMember = await admin.from('company_members').upsert(payloadNoDept, {
        onConflict: 'company_id,user_id',
        ignoreDuplicates: false,
      });
    }

    if (insMember.error) {
      // 重複（unique/PK）なら成功扱い
      if ((insMember as any).error?.code === '23505') {
        const seeded = await ensureStrategySeed(admin, userId!, companyId);
        const cookie = buildCompanyCookie(companyId, req.nextUrl.protocol === 'https:');

        return json(
          200,
          {
            ok: true,
            companyId,
            strategyId: seeded.ok ? seeded.strategyId : null, // ★ 追加
            note: 'duplicate_membership_treated_as_success',
          },
          [cookie],
        );
      }
      // 途中失敗: 会社だけ残さない（簡易ロールバック）
      await admin.from('companies').delete().eq('id', companyId);
      return json(500, {
        ok: false,
        code: 'join_admin_failed',
        companyId,
        details: insMember.error,
        rpcError: rpcErr,
      });
    }

    // 5-3) strategy_data の初期行を“存在しなければ”作成
    const seedRes = await ensureStrategySeed(admin, userId!, companyId);
    if (!seedRes.ok) {
      const cookie = buildCompanyCookie(companyId, req.nextUrl.protocol === 'https:');
      return json(
        500,
        {
          ok: false,
          code: 'strategy_seed_failed',
          companyId,
          details: seedRes.error,
          rpcError: rpcErr,
        },
        [cookie],
      );
    }

    const cookie = buildCompanyCookie(companyId, req.nextUrl.protocol === 'https:');
    return json(
      200,
      {
        ok: true,
        companyId,
        strategyId: seedRes.strategyId, // ★ 追加
        via: 'fallback',
        strategySeeded: seedRes.created,
      },
      [cookie],
    );
  } catch (e: any) {
    return json(500, { ok: false, code: 'internal_error', message: e?.message ?? String(e) });
  }
}
