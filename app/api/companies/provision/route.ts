// /app/api/companies/provision/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerUser } from '@/lib/supabaseServer';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type AdminClient = SupabaseClient<any, 'public', any>;

type Body = {
  companyName?: string;
  departmentId?: string | null;
};

/* ============== 小ヘルパ ============== */
function json(status: number, obj: unknown, cookies?: string[]) {
  const res = NextResponse.json(obj, { status });
  if (cookies && cookies.length) cookies.forEach((c) => res.headers.append('Set-Cookie', c));
  return res;
}

function getBearer(req: NextRequest) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^\s*Bearer\s+(.+)\s*$/i);
  return m?.[1] ?? null;
}

function makeDefaultCompanyName(email?: string | null) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  return email ? `Company of ${email} (${ts})` : `My Company (${ts})`;
}

function buildCompanyCookie(companyId: string, isHttps: boolean) {
  const attrs = ['Path=/', 'SameSite=Lax', `Max-Age=${60 * 60 * 24 * 30}`, isHttps ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
  return `company_id=${encodeURIComponent(companyId)}; ${attrs}`;
}

// 常に id を返す（uuid想定）
function pickId(row: any): string | null {
  const v = row?.id ?? null;
  return typeof v === 'string' && v ? v : null;
}

async function findStrategyByCompany(admin: AdminClient, companyId: string) {
  return admin.from('strategy_data').select('id').eq('company_id', companyId).limit(1).maybeSingle();
}

async function findStrategyByUser(admin: AdminClient, userId: string) {
  return admin.from('strategy_data').select('id').eq('user_id', userId).limit(1).maybeSingle();
}

/** profiles.id = userId が無ければ最小行を作る（存在すれば何もしない） */
async function ensureProfileExists(admin: AdminClient, userId: string) {
  try {
    const ex = await admin.from('profiles').select('id').eq('id', userId).limit(1).maybeSingle();
    if (!ex.error && ex.data?.id) return { ok: true };
    const now = new Date().toISOString();
    const ins = await admin
      .from('profiles')
      .insert([{ id: userId, created_at: now, updated_at: now }])
      .select('id')
      .single();
    if (ins.error) return { ok: true, note: 'profile_insert_error_ignored', detail: ins.error };
    return { ok: true };
  } catch (e) {
    return { ok: true, note: 'profile_check_failed_ignored', detail: String(e) };
  }
}

/** 指定列が無い（42703）かどうかの簡易判定 */
function looksMissingColumn(errOrResp: any, col: string) {
  const code = errOrResp?.error?.code ?? errOrResp?.code ?? '';
  const msg = `${errOrResp?.error?.message ?? errOrResp?.message ?? ''} ${
    errOrResp?.error?.details ?? errOrResp?.details ?? ''
  }`
    .toLowerCase()
    .trim();
  return code === '42703' || msg.includes(col.toLowerCase()) || (msg.includes('column') && msg.includes('does not exist'));
}
const looksMissingDepartmentId = (e: any) => looksMissingColumn(e, 'department_id');

/**
 * strategy_data の初期行を“存在しなければ”作成し、strategyId を返す。
 * 重要ポイント：
 *  - 既存は company_id → 無ければ user_id で探索
 *  - 挿入は最小5カラムのみ（company_id, user_id, updated_by, created_at, updated_at）
 *  - FK(23503) は profiles を作って 1 回だけ再試行
 *  - 返却 ID は常に `id`
 */
async function ensureStrategySeed(
  admin: AdminClient,
  userId: string,
  companyId: string
): Promise<{ ok: true; created: boolean; strategyId: string } | { ok: false; error: any }> {
  // 1) 既存チェック：company_id
  {
    const ex = await findStrategyByCompany(admin, companyId);
    const sid = !ex.error ? pickId(ex.data) : null;
    if (sid) return { ok: true, created: false, strategyId: sid };
  }

  // 2) 既存チェック：user_id（スキーマに user_id 一意制約があるプロジェクト向けの保険）
  {
    const exU = await findStrategyByUser(admin, userId);
    const sid = !exU.error ? pickId(exU.data) : null;
    if (sid) return { ok: true, created: false, strategyId: sid };
  }

  // 3) 無ければ作成（最小フィールドのみ）
  const now = new Date().toISOString();
  const seedMinimal = {
    company_id: companyId,
    user_id: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  };

  const tryInsert = async () =>
    admin.from('strategy_data').insert([seedMinimal]).select('id').single();

  let ins = await tryInsert();

  // FK: profiles がない → 1回だけ作って再試行
  if ((ins as any).error && (ins as any).error.code === '23503') {
    await ensureProfileExists(admin, userId);
    ins = await tryInsert();
  }

  if ((ins as any).error) {
    const code = (ins as any).error.code;
    if (code === '23505' || code === '409') {
      // 重複：user_id 優先 → ダメなら company_id
      const reU = await findStrategyByUser(admin, userId);
      const sidU = !reU.error ? pickId(reU.data) : null;
      if (sidU) return { ok: true, created: false, strategyId: sidU };

      const reC = await findStrategyByCompany(admin, companyId);
      const sidC = !reC.error ? pickId(reC.data) : null;
      if (sidC) return { ok: true, created: false, strategyId: sidC };

      return { ok: false, error: (ins as any).error };
    }
    return { ok: false, error: (ins as any).error };
  }

  const newId = pickId((ins as any).data);
  if (!newId) return { ok: false, error: new Error('inserted but id missing') };
  return { ok: true, created: true, strategyId: newId };
}

/* ============== route ============== */
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { ok: false, code: 'server_not_configured' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  }) as AdminClient;

  try {
    // 1) 認証（Cookie → Bearer）
    let userId: string | null = null;
    let userEmail: string | null = null;

    try {
      const { user } = await getServerUser();
      if (user?.id) {
        userId = user.id as string;
        userEmail = (user.email as string) ?? null;
      }
    } catch {
      // ignore
    }

    if (!userId) {
      const token = getBearer(req);
      if (!token) {
        return json(401, { ok: false, code: 'no_auth', message: 'cookie or bearer required' });
      }
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
      // ignore
    }
    const companyName = (body.companyName || '').trim() || makeDefaultCompanyName(userEmail);
    const departmentId = body.departmentId ?? null;

    // HTTPS 判定（Set-Cookie Secure判定用）
    const isHttps = (req.nextUrl?.protocol || '').toLowerCase() === 'https:';

    // 3) 既所属チェック（多重作成防止）
    {
      const { data: ex, error: exErr } = await admin
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId!)
        .maybeSingle();

      if (!exErr && ex?.company_id) {
        const seeded = await ensureStrategySeed(admin, userId!, String(ex.company_id));
        const cookie = buildCompanyCookie(String(ex.company_id), isHttps);

        if (!(seeded as any).ok) {
          console.warn('[provision] seed failed on already_in_company:', {
            userId,
            companyId: ex.company_id,
            error: (seeded as any).error,
          });
        }

        return json(
          200,
          {
            ok: true,
            companyId: ex.company_id,
            strategyId: (seeded as any).ok ? (seeded as any).strategyId : null,
            note: 'already_in_company',
            seedError: (seeded as any).ok
              ? undefined
              : {
                  code: (seeded as any).error?.code ?? null,
                  message: (seeded as any).error?.message ?? String((seeded as any).error ?? ''),
                },
          },
          [cookie],
        );
      }
    }

    // 4) RPC（あれば優先）
    const { data: rpcData, error: rpcErr } = await admin.rpc('provision_company', {
      p_user_id: userId!,
      p_company_name: companyName,
    });

    if (!rpcErr && rpcData) {
      const cid = String(rpcData);
      const seeded = await ensureStrategySeed(admin, userId!, cid);
      const cookie = buildCompanyCookie(cid, isHttps);

      if (!(seeded as any).ok) {
        console.warn('[provision] seed failed on rpc:', { userId, companyId: cid, error: (seeded as any).error });
      }

      return json(
        200,
        {
          ok: true,
          companyId: cid,
          strategyId: (seeded as any).ok ? (seeded as any).strategyId : null,
          via: 'rpc',
          seedError: (seeded as any).ok
            ? undefined
            : {
                code: (seeded as any).error?.code ?? null,
                message: (seeded as any).error?.message ?? String((seeded as any).error ?? ''),
              },
        },
        [cookie],
      );
    }

    // 5) フォールバック（手動原子処理）
    const { data: insCompany, error: insErr } = await admin
      .from('companies')
      .insert([{ name: companyName, created_by: userId! }])
      .select('id')
      .single();

    if (insErr || !insCompany?.id) {
      return json(500, { ok: false, code: 'create_company_failed', details: insErr, rpcError: rpcErr });
    }
    const companyId = String(insCompany.id);

    // upsert（department_id あり → 無ければフォールバック）
    let insMember = await admin
      .from('company_members')
      .upsert(
        [{ company_id: companyId, user_id: userId!, role: 'admin', ...(departmentId !== null ? { department_id: departmentId } : {}) }],
        { onConflict: 'company_id,user_id', ignoreDuplicates: false }
      );

    if (insMember.error && looksMissingDepartmentId(insMember)) {
      insMember = await admin
        .from('company_members')
        .upsert(
          [{ company_id: companyId, user_id: userId!, role: 'admin' }],
          { onConflict: 'company_id,user_id', ignoreDuplicates: false }
        );
    }

    if (insMember.error) {
      if ((insMember as any).error?.code === '23505') {
        const seeded = await ensureStrategySeed(admin, userId!, companyId);
        const cookie = buildCompanyCookie(companyId, isHttps);

        if (!(seeded as any).ok) {
          console.warn('[provision] seed failed on duplicate_membership:', {
            userId,
            companyId,
            error: (seeded as any).error,
          });
        }

        return json(
          200,
          {
            ok: true,
            companyId,
            strategyId: (seeded as any).ok ? (seeded as any).strategyId : null,
            note: 'duplicate_membership_treated_as_success',
            seedError: (seeded as any).ok
              ? undefined
              : {
                  code: (seeded as any).error?.code ?? null,
                  message: (seeded as any).error?.message ?? String((seeded as any).error ?? ''),
                },
          },
          [cookie],
        );
      }
      // 失敗時は companies をロールバック
      await admin.from('companies').delete().eq('id', companyId);
      return json(500, { ok: false, code: 'join_admin_failed', companyId, details: insMember.error, rpcError: rpcErr });
    }

    const seedRes = await ensureStrategySeed(admin, userId!, companyId);
    const cookie = buildCompanyCookie(companyId, isHttps);

    if (!(seedRes as any).ok) {
      console.warn('[provision] seed failed on fallback:', { userId, companyId, error: (seedRes as any).error });
      return json(
        500,
        { ok: false, code: 'strategy_seed_failed', companyId, details: (seedRes as any).error, rpcError: rpcErr },
        [cookie],
      );
    }

    return json(
      200,
      {
        ok: true,
        companyId,
        strategyId: (seedRes as any).strategyId,
        via: 'fallback',
        strategySeeded: (seedRes as any).created,
        seedError: undefined,
      },
      [cookie],
    );
  } catch (e: any) {
    return json(500, { ok: false, code: 'internal_error', message: e?.message ?? String(e) });
  }
}
