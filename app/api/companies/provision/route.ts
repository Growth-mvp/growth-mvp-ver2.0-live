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

/* ============== helpers ============== */
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

// ※ 混線防止のため user_id フォールバック探索は使わない
// async function findStrategyByUser(admin: AdminClient, userId: string) { ... }

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

/* ============== 削除フラグ検知（Cookie / ヘッダー） ============== */
const DELETION_FLAG_KEY = '__deleting_company__';
function readDeletionFlag(req: NextRequest): { deleting: boolean; companyId?: string | null } {
  const h = req.headers.get('x-deleting-company') || req.headers.get('x-growth-deleting-company');
  if (h && h.trim()) return { deleting: true, companyId: h.trim() };
  const c = req.cookies.get(DELETION_FLAG_KEY)?.value;
  if (c && c.trim()) return { deleting: true, companyId: c.trim() };
  return { deleting: false, companyId: undefined };
}

/**
 * strategy_data の初期行を“存在しなければ”作成し、strategyId を返す。
 * 重要ポイント：
 *  - 既存は company_id でのみ探索（user_id フォールバックは使わない）
 *  - 挿入は最小5カラムのみ（company_id, user_id, updated_by, created_at, updated_at）
 *  - FK(23503) は profiles を作って 1 回だけ再試行
 */
async function ensureStrategySeed(
  admin: AdminClient,
  userId: string,
  companyId: string
): Promise<{ ok: true; created: boolean; strategyId: string } | { ok: false; error: any }> {
  // 1) 既存チェック：company_id のみ
  {
    const ex = await findStrategyByCompany(admin, companyId);
    const sid = !ex.error ? pickId(ex.data) : null;
    if (sid) return { ok: true, created: false, strategyId: sid };
  }

  // 2) 無ければ作成（最小フィールドのみ）
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
      // 重複：改めて company_id で取得
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

  const deleting = readDeletionFlag(req);

  // 診断ログ（本番でも残したい最低限）
  console.info('[provision] begin', {
    deleting,
    urlConfigured: !!SUPABASE_URL,
    serviceRoleConfigured: !!SERVICE_ROLE,
    isHttps: (req.nextUrl?.protocol || '').toLowerCase() === 'https:',
  });

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
        console.warn('[provision] no_auth');
        return json(401, { ok: false, code: 'no_auth', message: 'cookie or bearer required' });
      }
      const { data: ures, error: uerr } = await admin.auth.getUser(token);
      if (uerr || !ures?.user?.id) {
        console.warn('[provision] invalid_token', uerr);
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
        const cid = String(ex.company_id);
        const cookie = buildCompanyCookie(cid, isHttps);

        // 削除フラグ中は seed しない
        if (deleting.deleting && (!deleting.companyId || deleting.companyId === cid)) {
          console.info('[provision] already_in_company (skip seed due to deleting)', { userId, companyId: cid });
          return json(200, { ok: true, companyId: cid, strategyId: null, note: 'skip_seed_deleting' }, [cookie]);
        }

        const seeded = await ensureStrategySeed(admin, userId!, cid);
        if (!(seeded as any).ok) {
          console.warn('[provision] seed failed on already_in_company', { userId, companyId: cid, error: (seeded as any).error });
        } else {
          console.info('[provision] seed ok (already_in_company)', { companyId: cid, strategyId: (seeded as any).strategyId });
        }

        return json(
          200,
          {
            ok: true,
            companyId: cid,
            strategyId: (seeded as any).ok ? (seeded as any).strategyId : null,
            note: 'already_in_company',
            seedError: (seeded as any).ok ? undefined : {
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
      const cookie = buildCompanyCookie(cid, isHttps);

      if (deleting.deleting && (!deleting.companyId || deleting.companyId === cid)) {
        console.info('[provision] rpc ok (skip seed due to deleting)', { userId, companyId: cid });
        return json(200, { ok: true, companyId: cid, strategyId: null, via: 'rpc', note: 'skip_seed_deleting' }, [cookie]);
      }

      const seeded = await ensureStrategySeed(admin, userId!, cid);
      if (!(seeded as any).ok) {
        console.warn('[provision] seed failed on rpc', { userId, companyId: cid, error: (seeded as any).error });
      } else {
        console.info('[provision] seed ok (rpc)', { companyId: cid, strategyId: (seeded as any).strategyId });
      }

      return json(
        200,
        {
          ok: true,
          companyId: cid,
          strategyId: (seeded as any).ok ? (seeded as any).strategyId : null,
          via: 'rpc',
          seedError: (seeded as any).ok ? undefined : {
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
      console.error('[provision] create_company_failed', { userId, insErr, rpcErr });
      return json(500, { ok: false, code: 'create_company_failed', details: insErr, rpcError: rpcErr });
    }
    const companyId = String(insCompany.id);
    const cookie = buildCompanyCookie(companyId, isHttps);

    // upsert（department_id カラム有無にフォールバック）
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
      // ★ 重要：ここで「作った会社を delete でロールバック」しない（CASCADE事故防止）
      console.error('[provision] join_admin_failed (no rollback delete for safety)', {
        userId, companyId, details: insMember.error, rpcError: rpcErr
      });
      return json(500, { ok: false, code: 'join_admin_failed', companyId, details: insMember.error, rpcError: rpcErr }, [cookie]);
    }

    // 削除フラグ中は seed しない
    if (deleting.deleting && (!deleting.companyId || deleting.companyId === companyId)) {
      console.info('[provision] fallback ok (skip seed due to deleting)', { userId, companyId });
      return json(200, { ok: true, companyId, strategyId: null, via: 'fallback', note: 'skip_seed_deleting' }, [cookie]);
    }

    const seedRes = await ensureStrategySeed(admin, userId!, companyId);
    if (!(seedRes as any).ok) {
      console.warn('[provision] seed failed on fallback', { userId, companyId, error: (seedRes as any).error });
      return json(500, { ok: false, code: 'strategy_seed_failed', companyId, details: (seedRes as any).error, rpcError: rpcErr }, [cookie]);
    }

    console.info('[provision] success (fallback)', { companyId, strategyId: (seedRes as any).strategyId });
    return json(200, {
      ok: true,
      companyId,
      strategyId: (seedRes as any).strategyId,
      via: 'fallback',
      strategySeeded: (seedRes as any).created,
      seedError: undefined,
    }, [cookie]);

  } catch (e: any) {
    console.error('[provision] internal_error', e);
    return json(500, { ok: false, code: 'internal_error', message: e?.message ?? String(e) });
  }
}
