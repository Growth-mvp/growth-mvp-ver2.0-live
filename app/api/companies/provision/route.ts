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
  // ★追加：明示的に会社作成を許可したいときだけ true（管理者オンボーディング等）
  allowCreateCompany?: boolean;
  onboardingCode?: string;
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
 * ★追加：会社作成を許可するか（招待制の安全弁）
 * - 通常運用（招待制）では false のまま
 * - 管理者オンボーディングなど “明示的” に create を許可する場合だけ true
 */
function isCreateAllowed(req: NextRequest, body: Body) {
  const mode = (req.headers.get('x-growth-provision-mode') || '').toLowerCase().trim();
  if (mode === 'create') return true;
  if (body.allowCreateCompany === true) return true;
  return false;
}

/**
 * strategy_data の初期行を“存在しなければ”作成し、strategyId を返す。
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
    console.error('[ensureStrategySeed] insert_error', {
      userId,
      companyId,
      error_code: code,
      error_message: (ins as any).error?.message ?? String((ins as any).error),
      error_details: (ins as any).error?.details ?? undefined,
    });
    if (code === '23505' || code === '409') {
      // 重複：改めて company_id で取得
      const reC = await findStrategyByCompany(admin, companyId);
      const sidC = !reC.error ? pickId(reC.data) : null;
      if (sidC) {
        console.info('[ensureStrategySeed] duplicate_recovered_by_id', { companyId, strategyId: sidC });
        return { ok: true, created: false, strategyId: sidC };
      }
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

    const allowCreate = isCreateAllowed(req, body);

    // ★導入コード検証（createモード時のみ、かつコード設定時）
    if (allowCreate) {
      const required = (process.env.GROWTH_ONBOARDING_CODE || '').trim();
      const provided =
        (body?.onboardingCode || '').trim() ||
        (req.headers.get('x-growth-onboarding-code') || '').trim();

      const hasCode = !!provided;
      console.info('[provision] create-mode onboarding', { hasCode, requiredSet: !!required });

      // ★修正：required が設定されている場合のみコード検証を強制
      if (required && provided !== required) {
        return json(403, { ok: false, code: 'create_not_allowed' });
      }
    }

    const companyName = (body.companyName || '').trim() || makeDefaultCompanyName(userEmail);
    const departmentId = body.departmentId ?? null;

    // HTTPS 判定（Set-Cookie Secure判定用）
    const isHttps = (req.nextUrl?.protocol || '').toLowerCase() === 'https:';

    // ★重要：profile の存在確認・作成（FK エラー回避）
    const profileRes = await ensureProfileExists(admin, userId!);
    if (!(profileRes as any).ok) {
      console.warn('[provision] profile check failed', { userId, detail: (profileRes as any).detail });
      // ここで中断せず、以降のロジックで対応（FK エラーで検出される）
    }

    // 3) 既所属チェック（多重作成防止）
    {
      const { data: ex, error: exErr } = await admin
        .from('company_members')
        .select('company_id, role')
        .eq('user_id', userId!)
        .limit(1)
        .maybeSingle();

      if (!exErr && ex?.company_id) {
        const cid = String(ex.company_id);
        const role = String(ex.role ?? 'member');
        const cookie = buildCompanyCookie(cid, isHttps);

        console.info('[provision] already_in_company', { userId, companyId: cid, role });

        // 削除フラグ中は seed しない
        if (deleting.deleting && (!deleting.companyId || deleting.companyId === cid)) {
          console.info('[provision] already_in_company (skip seed due to deleting)', { userId, companyId: cid });
          return json(200, { ok: true, companyId: cid, strategyId: null, role, note: 'skip_seed_deleting' }, [cookie]);
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
            role,
            note: 'already_in_company',
            seedError: (seeded as any).ok ? undefined : {
              code: (seeded as any).error?.code ?? null,
              message: (seeded as any).error?.message ?? String((seeded as any).error ?? ''),
            },
          },
          [cookie],
        );
      }

      // ★重要：未所属ユーザーでの "会社自動作成" を禁止（招待制）
      if (!allowCreate) {
        console.info('[provision] denied: needs_membership', { userId, userEmail });
        return json(403, { ok: false, code: 'needs_membership', message: 'Join a company via invite first.' });
      }
    }

    // 4) RPC（create許可時のみ）
    console.info('[provision] attempting RPC provision_company', { userId, companyName });

    const { data: rpcData, error: rpcErr } = await admin.rpc('provision_company', {
      p_user_id: userId!,
      p_company_name: companyName,
    });

    if (!rpcErr && rpcData) {
      const cid = String(rpcData);
      const cookie = buildCompanyCookie(cid, isHttps);

      console.info('[provision] rpc success', { userId, companyId: cid });

      if (deleting.deleting && (!deleting.companyId || deleting.companyId === cid)) {
        console.info('[provision] rpc ok (skip seed due to deleting)', { userId, companyId: cid });
        return json(200, { ok: true, companyId: cid, strategyId: null, role: 'admin', via: 'rpc', note: 'skip_seed_deleting' }, [cookie]);
      }

      const seeded = await ensureStrategySeed(admin, userId!, cid);
      if (!(seeded as any).ok) {
        console.error('[provision] seed failed on rpc', { userId, companyId: cid, error: (seeded as any).error });
        return json(500, {
          ok: false,
          code: 'strategy_seed_failed',
          companyId: cid,
          details: (seeded as any).error,
        }, [cookie]);
      }

      console.info('[provision] seed ok (rpc)', { companyId: cid, strategyId: (seeded as any).strategyId });

      return json(
        200,
        {
          ok: true,
          companyId: cid,
          strategyId: (seeded as any).strategyId,
          role: 'admin',
          via: 'rpc',
          strategySeeded: (seeded as any).created,
          seedError: undefined,
        },
        [cookie],
      );
    }

    console.warn('[provision] RPC failed, falling back to direct insert', { userId, rpcErr: rpcErr?.message });

    // 5) フォールバック（create許可時のみ）
    console.info('[provision] starting fallback company creation', { userId, companyName });

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

    console.info('[provision] company created successfully', { userId, companyId, created_by: userId });

    // ★重要：company_members への admin 登録（INSERT を試す、失敗したら個別エラーハンドリング）
    let insMember = await admin
      .from('company_members')
      .insert(
        [{ company_id: companyId, user_id: userId!, role: 'admin', ...(departmentId !== null ? { department_id: departmentId } : {}) }]
      )
      .select('*')
      .single();

    if (insMember.error && looksMissingDepartmentId(insMember)) {
      console.info('[provision] retrying company_members insert without department_id', { userId, companyId });
      insMember = await admin
        .from('company_members')
        .insert([{ company_id: companyId, user_id: userId!, role: 'admin' }])
        .select('*')
        .single();
    }

    if (insMember.error) {
      console.error('[provision] company_members_insert_failed', {
        userId,
        companyId,
        error_code: insMember.error?.code,
        error_message: insMember.error?.message,
        error_details: insMember.error?.details,
      });
      // ★重要：会社は作られたが membership 失敗 → 部分的成功だが問題あり
      return json(500, {
        ok: false,
        code: 'company_members_insert_failed',
        companyId,
        details: insMember.error,
        rpcError: rpcErr,
      }, [cookie]);
    }

    console.info('[provision] company_members insert successful', { userId, companyId, role: 'admin' });

    // 削除フラグ中は seed しない
    if (deleting.deleting && (!deleting.companyId || deleting.companyId === companyId)) {
      console.info('[provision] fallback ok (skip seed due to deleting)', { userId, companyId });
      return json(200, {
        ok: true,
        companyId,
        strategyId: null,
        role: 'admin',
        via: 'fallback',
        note: 'skip_seed_deleting',
      }, [cookie]);
    }

    const seedRes = await ensureStrategySeed(admin, userId!, companyId);
    if (!(seedRes as any).ok) {
      console.error('[provision] seed failed on fallback', { userId, companyId, error: (seedRes as any).error });
      // ★重要：会社と membership は作られたが seed 失敗 → 重要なエラーをレポート
      return json(500, {
        ok: false,
        code: 'strategy_seed_failed',
        companyId,
        details: (seedRes as any).error,
        rpcError: rpcErr,
      }, [cookie]);
    }

    console.info('[provision] success (fallback)', { companyId, strategyId: (seedRes as any).strategyId, role: 'admin' });
    return json(200, {
      ok: true,
      companyId,
      strategyId: (seedRes as any).strategyId,
      role: 'admin',
      via: 'fallback',
      strategySeeded: (seedRes as any).created,
      seedError: undefined,
    }, [cookie]);

  } catch (e: any) {
    console.error('[provision] internal_error', {
      message: e?.message ?? String(e),
      stack: e?.stack ?? undefined,
      name: e?.name ?? undefined,
      code: e?.code ?? undefined,
      status: e?.status ?? undefined,
      supabase_code: e?.error?.code ?? undefined,
      supabase_message: e?.error?.message ?? undefined,
    });
    return json(500, {
      ok: false,
      code: 'internal_error',
      message: e?.message ?? String(e),
      details: {
        error_name: e?.name ?? 'unknown',
        error_code: e?.code ?? undefined,
        supabase_code: e?.error?.code ?? undefined,
      }
    });
  }
}