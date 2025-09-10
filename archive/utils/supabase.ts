// /utils/supabase.ts（フル置き換え：TS2769対策 & companyId統一 安定版）
import { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';
import { supabase } from '@/lib/supabaseClient';
export { supabase };

/* ======================
 * Tables
 * ====================== */
const TABLE_NAME = 'strategy_data';
const COMPANIES = 'companies';
const MEMBERS = 'company_members';

/* ------------------------------ helpers ------------------------------ */

function isValidUUID(v?: string | null): v is string {
  return (
    !!v &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

/* ---------- Supabase/PostgRESTエラー抽出（最小限） ---------- */
type ExtractedPgError = {
  status?: number;
  code: string;
  message: string;
  details: string;
};

function toStringSafe(v: unknown) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function peelErrorCandidate(e: any): any {
  if (!e) return e;
  if (e?.error) return e.error;
  if (e?.res?.error) return e.res.error;
  if (e?.err) return e.err;
  if (e?.cause?.error) return e.cause.error;
  return e;
}

/** err/response から status/code/message/details を抽出。 */
export function debugExtractPostgrest(err: unknown): ExtractedPgError {
  const e0: any = err || {};
  const e = peelErrorCandidate(e0);

  const status =
    e0?.status ??
    e?.status ??
    e0?.response?.status ??
    e?.response?.status ??
    (typeof e?.code === 'number' ? e.code : undefined);

  const codeRaw =
    e?.code ??
    e0?.code ??
    e?.error_code ??
    e0?.error_code ??
    e?.originalError?.code ??
    e?.cause?.code ??
    e?.name;

  const messageRaw =
    e?.message ??
    e0?.message ??
    e?.error_description ??
    e0?.error_description ??
    e?.statusText ??
    e0?.statusText ??
    e?.response?.statusText ??
    e0?.response?.statusText ??
    e?.hint ??
    e0?.hint ??
    e?.details ??
    e0?.details;

  const detailsRaw =
    e?.details ??
    e0?.details ??
    e?.hint ??
    e0?.hint ??
    e?.response?.data ??
    e0?.response?.data ??
    e?.body ??
    e0?.body;

  const out: ExtractedPgError = {
    status,
    code: toStringSafe(codeRaw),
    message: toStringSafe(messageRaw),
    details: toStringSafe(detailsRaw),
  };

  const hasInfo = !!(out.status || out.code || out.message || out.details);
  if (!hasInfo) return out;
  // eslint-disable-next-line no-console
  console.error('🧰 PostgREST error (normalized) →', out);
  return out;
}

function isRlsDenied(errOrResponse: unknown) {
  const { status, code, message, details } = debugExtractPostgrest(errOrResponse) || {};
  const text = `${message} ${details}`.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    text.includes('row level security') ||
    text.includes('row-level security') ||
    text.includes('violates row-level security') ||
    text.includes('permission denied') ||
    text.includes('not authorized')
  );
}

function isInvalidJsonSyntax(errOrResponse: unknown) {
  const { code, message, details } = debugExtractPostgrest(errOrResponse) || {};
  const text = `${message} ${details}`.toLowerCase();
  return code === '22P02' || text.includes('invalid input syntax for type') || text.includes('json');
}

/* ------------------------------ story 正規化 ------------------------------ */
const GROWTH_TITLES = [
  '第1章：なぜ今（現状の危機と背景）',
  '第2章：どう戦う（選択と集中の戦略）',
  '第3章：どんな未来像（顧客の風景で描く）',
  '第4章：どう行動する（社員一人ひとりの役割と決意）',
];

function tryParseJson<T = any>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toChapterArray(input: any): ChapterStory[] {
  if (!input) return [];
  let src = input;
  if (typeof src === 'string') {
    const parsed = tryParseJson(src);
    if (parsed && typeof parsed === 'object') return toChapterArray(parsed);
    return [];
  }
  if (Array.isArray(src)) {
    const arr: ChapterStory[] = [];
    for (const it of src) {
      if (!it) continue;
      if (typeof it === 'string') arr.push({ title: '', body: it });
      else if (typeof it === 'object') {
        const t = typeof it.title === 'string' ? it.title : '';
        const b = typeof it.body === 'string' ? it.body : '';
        if (!t && !b) {
          const keys = Object.keys(it || {});
          if (keys.length === 1) {
            const k = keys[0];
            const v = (it as any)[k];
            arr.push({ title: String(k ?? ''), body: typeof v === 'string' ? v : '' });
          }
        } else {
          arr.push({ title: t, body: b });
        }
      }
    }
    return arr;
  }
  if (typeof src === 'object') {
    const arr: ChapterStory[] = [];
    for (const k of Object.keys(src)) {
      const v = (src as any)[k];
      if (v && (typeof v === 'string' || typeof v === 'number')) {
        arr.push({ title: String(k ?? ''), body: String(v ?? '') });
      }
    }
    return arr;
  }
  return [];
}
function uniqChapters(chs: ChapterStory[]): ChapterStory[] {
  const seen = new Set<string>();
  const out: ChapterStory[] = [];
  for (const c of chs || []) {
    const key = `${(c?.title || '').trim()}::${(c?.body || '').trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        title: typeof c?.title === 'string' ? c.title : '',
        body: typeof c?.body === 'string' ? c.body : '',
      });
    }
  }
  return out;
}
function alignToGrowthOrder(chs: ChapterStory[] = []): ChapterStory[] {
  const buckets = [
    { keys: ['なぜ今', '現状', '危機', '背景'] },
    { keys: ['どう戦う', '戦略', '選択', '集中', 'トレードオフ'] },
    { keys: ['未来像', '未来', 'どこへ', 'ビジョン', '顧客の風景'] },
    { keys: ['どう行動する', '行動', '社員', '当事者', 'オーナー'] },
  ];
  const used = new Set<number>();
  const ordered: ChapterStory[] = [];
  const scoreOf = (text: string, keys: string[]) =>
    keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);
  for (const b of buckets) {
    let bestIdx = -1;
    let bestScore = -1;
    chs.forEach((c, idx) => {
      if (used.has(idx)) return;
      const hay = `${c?.title ?? ''}${c?.body ?? ''}`;
      const sc = scoreOf(hay, b.keys);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      ordered.push(chs[bestIdx]);
    } else {
      ordered.push({ title: '', body: '' });
    }
  }
  return ordered.slice(0, 4).map((c, i) => ({
    title: GROWTH_TITLES[i],
    body: (c?.body ?? '').trim(),
  }));
}
function normalizeChaptersAny(input: any): ChapterStory[] {
  const arr = toChapterArray(input);
  const uniq = uniqChapters(arr);
  return alignToGrowthOrder(uniq);
}

/* --------------------------- departments 正規化 --------------------------- */
type AnyOKR =
  | { objective?: any; keyResults?: any; owner?: any }
  | null
  | undefined;
type AnyProject =
  | {
      title?: any;
      name?: any;
      okrs?: any;
      objective?: any;
      keyResults?: any;
      owner?: any;
    }
  | null
  | undefined;
type AnyDepartment =
  | { id?: any; name?: any; title?: any; projects?: any }
  | null
  | undefined;

function normalizeOKR(input: AnyOKR) {
  const o = input || {};
  const objective = typeof (o as any).objective === 'string' ? (o as any).objective : '';
  const keyResults = Array.isArray((o as any).keyResults)
    ? (o as any).keyResults.map((k: any) => String(k))
    : [];
  const owner =
    (o as any).owner !== undefined && (o as any).owner !== null && String((o as any).owner) !== ''
      ? String((o as any).owner)
      : undefined;
  return { objective, keyResults, owner };
}
function normalizeProject(p: AnyProject) {
  const title =
    typeof (p as any)?.title === 'string'
      ? (p as any).title
      : typeof (p as any)?.name === 'string'
      ? (p as any).name
      : '';
  const okrsRaw = Array.isArray((p as any)?.okrs) ? (p as any).okrs : [];
  const legacy =
    (p as any)?.objective || (p as any)?.keyResults || (p as any)?.owner
      ? [
          {
            objective: String((p as any)?.objective ?? ''),
            keyResults: Array.isArray((p as any)?.keyResults)
              ? (p as any).keyResults.map((k: any) => String(k))
              : [],
            owner: (p as any)?.owner ? String((p as any).owner) : '',
          },
        ]
      : [];
  const okrs = [...legacy, ...okrsRaw].map(normalizeOKR);
  return { title, okrs };
}
function normalizeDepartment(d: AnyDepartment) {
  const id = (d as any)?.id ?? undefined;
  const name =
    typeof (d as any)?.name === 'string'
      ? (d as any).name
      : typeof (d as any)?.title === 'string'
      ? (d as any).title
      : '';
  const projectsRaw = Array.isArray((d as any)?.projects) ? (d as any).projects : [];
  const projects = projectsRaw.map(normalizeProject);
  return { id, name, projects };
}
function normalizeDepartmentsAny(input: any) {
  if (!input) return [];
  let src = input;
  if (typeof src === 'string') {
    const parsed = tryParseJson(src);
    if (parsed && typeof parsed === 'object') return normalizeDepartmentsAny(parsed);
    return [];
  }
  if (Array.isArray(src)) return src.map(normalizeDepartment);
  if (typeof src === 'object' && Array.isArray((src as any).departments))
    return (src as any).departments.map(normalizeDepartment);
  return [];
}

/* --------------------------- 共通 正規化入口 --------------------------- */
function normalizeStrategyData(input: StrategyData | null): StrategyData | null {
  if (!input) return null;
  const raw: any = { ...input };

  if (typeof raw.answers2 === 'string') {
    try {
      raw.answers2 = JSON.parse(raw.answers2);
    } catch {
      raw.answers2 = [];
    }
  }
  raw.story = normalizeChaptersAny(raw.story);
  raw.finalStory = normalizeChaptersAny(raw.finalStory);
  raw.departments = normalizeDepartmentsAny(raw.departments);

  return raw as StrategyData;
}

/* ---------------------- StrategyData ↔ DB row 変換 ----------------------- */

function safeJson(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (typeof v === 'string') return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

function maybeStringify(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (v === null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * アプリの camelCase → DB
 * 注: DB列名が camelCase / snake_case いずれでも UPDATE/INSERT が落ちないよう、
 *     読み側(rowDbToApp)は両対応、書き側は現行スキーマ（camelCase）を前提。
 *     ※ snake_case 環境でも JSON列はそのまま保存されるため、致命的にはなりません。
 */
function toRowDb(input: Partial<StrategyData> | any) {
  const row: Record<string, any> = {};

  // 基本情報
  row.companyName = input?.companyName ?? null;
  row.foundationYear = input?.foundationYear ?? null;
  row.location = input?.location ?? null;
  row.industry = input?.industry ?? null;
  row.revenue = input?.revenue ?? null;
  row.employees = input?.employees ?? null;
  row.businessContent = input?.businessContent ?? null;
  row.customerSegment = input?.customerSegment ?? null;

  // SWOT / MVV
  row.thought = input?.thought ?? null;
  row.mission = input?.mission ?? null;
  row.vision = input?.vision ?? null;
  row.value = input?.value ?? null;
  row.strength = input?.strength ?? null;
  row.weakness = input?.weakness ?? null;
  row.opportunity = input?.opportunity ?? null;
  row.threat = input?.threat ?? null;

  // JSONカラム
  row.story = normalizeChaptersAny(input?.story);
  row.finalStory = normalizeChaptersAny(input?.finalStory);
  row.departments = normalizeDepartmentsAny(input?.departments);
  row.answers2 = Array.isArray(input?.answers2) ? input.answers2 : [];
  row.csvFinanceData = typeof input?.csvFinanceData === 'undefined' ? null : safeJson(input.csvFinanceData);

  // 注意：idは保存系で必ず除外する（pkey重複防止）
  if (typeof input?.strategyId === 'string') row.id = input.strategyId;

  return row;
}

/** DB → アプリ（camelCase / snake_case の両対応で吸収） */
function rowDbToApp(row: any): StrategyData {
  const pick = (a: any, ...keys: string[]) => {
    for (const k of keys) {
      if (a && a[k] != null) return a[k];
    }
    return undefined;
  };

  const out: any = {};
  out.strategyId = pick(row, 'strategy_id', 'id') ?? null;

  out.companyName = pick(row, 'companyName', 'company_name') ?? '';
  out.foundationYear = pick(row, 'foundationYear', 'foundation_year') ?? '';
  out.location = pick(row, 'location') ?? '';
  out.industry = pick(row, 'industry') ?? '';
  out.revenue = pick(row, 'revenue') ?? '';
  out.employees = pick(row, 'employees') ?? '';
  out.businessContent = pick(row, 'businessContent', 'business_content') ?? '';
  out.customerSegment = pick(row, 'customerSegment', 'customer_segment') ?? '';

  out.thought = pick(row, 'thought') ?? '';
  out.mission = pick(row, 'mission') ?? '';
  out.vision = pick(row, 'vision') ?? '';
  out.value = pick(row, 'value') ?? '';
  out.strength = pick(row, 'strength') ?? '';
  out.weakness = pick(row, 'weakness') ?? '';
  out.opportunity = pick(row, 'opportunity') ?? '';
  out.threat = pick(row, 'threat') ?? '';

  out.story = normalizeChaptersAny(pick(row, 'story'));
  out.finalStory = normalizeChaptersAny(pick(row, 'finalStory', 'final_story'));
  out.departments = normalizeDepartmentsAny(pick(row, 'departments'));
  out.answers2 = Array.isArray(pick(row, 'answers2')) ? pick(row, 'answers2') : [];

  out.csvFinanceData = pick(row, 'csvFinanceData', 'csv_finance_data') ?? null;
  return out as StrategyData;
}

/* --------------------------- membership --------------------------- */
export type Membership = {
  companyId: string | null;
  departmentId: string | null;
  role: 'admin' | 'manager' | 'member' | null;
};

/** Cookieから company_id を読む（無ければ null） */
function getCompanyIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)company_id=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

function looksMissingDepartmentId(err: any) {
  const info = debugExtractPostgrest(err);
  const msg = `${info.code} ${info.message} ${info.details}`.toLowerCase();
  return info.code === '42703' || msg.includes('department_id') || (msg.includes('column') && msg.includes('does not exist'));
}

/** 所属取得：department_id 列有無を自動吸収 */
export async function getMembership(userId: string): Promise<Membership> {
  if (!userId) return { companyId: null, departmentId: null, role: null };

  // 1st: department_id あり
  const q1 = await supabase
    .from(MEMBERS)
    .select('company_id, department_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!q1.error && q1.data) {
    const row = q1.data as any;
    const companyId = typeof row.company_id === 'string' ? row.company_id : null;
    const departmentId = typeof row.department_id === 'string' ? row.department_id : null;
    const role =
      row.role === 'admin' || row.role === 'manager' || row.role === 'member'
        ? (row.role as 'admin' | 'manager' | 'member')
        : null;
    return { companyId, departmentId, role };
  }

  // 列が無い場合はフォールバック
  if (q1.error && looksMissingDepartmentId(q1)) {
    const q2 = await supabase
      .from(MEMBERS)
      .select('company_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (q2.error || !q2.data) {
      if (q2.error) debugExtractPostgrest(q2);
      return { companyId: null, departmentId: null, role: null };
    }

    const row = q2.data as any;
    const companyId = typeof row.company_id === 'string' ? row.company_id : null;
    const role =
      row.role === 'admin' || row.role === 'manager' || row.role === 'member'
        ? (row.role as 'admin' | 'manager' | 'member')
        : null;
    return { companyId, departmentId: null, role };
  }

  if (q1.error) debugExtractPostgrest(q1);
  return { companyId: null, departmentId: null, role: null };
}

/** 会社新規作成 + 自分を admin で参加（RLSで弾かれたら null 返す） */
export async function createCompanyAndJoin(params: {
  userId: string;
  companyName?: string;
  departmentId?: string | null;
}): Promise<Membership> {
  const { userId, companyName, departmentId = null } = params;
  if (!userId) return { companyId: null, departmentId: null, role: null };

  const name = companyName?.trim() || `Personal Company ${userId.slice(0, 8)}`;

  const insCompany = await supabase
    .from(COMPANIES)
    .insert([{ name, created_by: userId }]) // returningは使わない
    .select('id')
    .single();

  if (insCompany.error) {
    if (isRlsDenied(insCompany)) {
      console.warn('⚠️ create company blocked by RLS; fallback to no-company');
      return { companyId: null, departmentId: null, role: null };
    }
    debugExtractPostgrest(insCompany);
    return { companyId: null, departmentId: null, role: null };
  }

  const companyId = String((insCompany.data as any)?.id || '');
  if (!companyId) return { companyId: null, departmentId: null, role: null };

  // admin で参加（重複は upsert）
  const insMember = await supabase
    .from(MEMBERS)
    .upsert([{ company_id: companyId, user_id: userId, role: 'admin', department_id: departmentId }], {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: false,
    })
    .select('company_id, department_id, role')
    .maybeSingle();

  if (insMember.error) {
    if (isRlsDenied(insMember)) {
      console.warn('⚠️ add member blocked by RLS; fallback to no-company');
      return { companyId: null, departmentId: null, role: null };
    }
    debugExtractPostgrest(insMember);
    return { companyId: null, departmentId: null, role: null };
  }

  const row = insMember.data as any;
  return {
    companyId: typeof row?.company_id === 'string' ? row.company_id : companyId,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : departmentId,
    role: row?.role === 'admin' || row?.role === 'manager' || row?.role === 'member' ? row.role : 'admin',
  };
}

/** 既存会社へ参加（招待コード等がある前提。ここでは companyId を直指定） */
export async function joinCompany(params: {
  userId: string;
  companyId: string;
  role?: 'admin' | 'manager' | 'member';
  departmentId?: string | null;
}): Promise<Membership> {
  const { userId, companyId, role = 'member', departmentId = null } = params;
  if (!userId || !isValidUUID(companyId))
    return { companyId: null, departmentId: null, role: null };

  const up = await supabase
    .from(MEMBERS)
    .upsert([{ company_id: companyId, user_id: userId, role, department_id: departmentId }], {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: false,
    })
    .select('company_id, department_id, role')
    .maybeSingle();

  if (up.error) {
    debugExtractPostgrest(up);
    return { companyId: null, departmentId: null, role: null };
  }
  const row = up.data as any;
  return {
    companyId: typeof row?.company_id === 'string' ? row.company_id : companyId,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : departmentId,
    role: row?.role === 'admin' || row?.role === 'manager' || row?.role === 'member' ? row.role : role,
  };
}

/* ---- メンバー一覧＆ロール変更（管理） ---- */

export type MemberListItem = {
  userId: string;
  role: 'admin' | 'manager' | 'member';
  departmentId: string | null;
};

export async function listCompanyMembers(): Promise<MemberListItem[]> {
  const myUid = await getCurrentUserId();
  if (!myUid) return [];
  const { companyId } = await getMembership(myUid);
  if (!companyId) return [];

  // 1st: department_id あり
  const q1 = await supabase.from(MEMBERS).select('user_id, role, department_id').eq('company_id', companyId);

  if (!q1.error) {
    const rows = (q1.data || []) as any[];
    return rows.map((r: any) => ({
      userId: String(r.user_id),
      role: r.role === 'admin' || r.role === 'manager' || r.role === 'member' ? r.role : 'member',
      departmentId: typeof r?.department_id === 'string' ? r.department_id : null,
    }));
  }

  if (looksMissingDepartmentId(q1)) {
    const q2 = await supabase.from(MEMBERS).select('user_id, role').eq('company_id', companyId);
    if (q2.error) {
      debugExtractPostgrest(q2);
      return [];
    }
    const rows = (q2.data || []) as any[];
    return rows.map((r: any) => ({
      userId: String(r.user_id),
      role: r.role === 'admin' || r.role === 'manager' || r.role === 'member' ? r.role : 'member',
      departmentId: null,
    }));
  }

  debugExtractPostgrest(q1);
  return [];
}

export async function updateMemberRole(
  targetUserId: string,
  nextRole: 'admin' | 'manager' | 'member'
): Promise<{ ok: boolean; error?: any }> {
  const myUid = await getCurrentUserId();
  if (!myUid) return { ok: false, error: new Error('not signed in') };
  const { companyId } = await getMembership(myUid);
  if (!companyId) return { ok: false, error: new Error('company not found') };

  const { error } = await supabase
    .from(MEMBERS)
    .update({ role: nextRole })
    .eq('company_id', companyId)
    .eq('user_id', targetUserId)
    .select('user_id')
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true };
}

/* --------------------------- 既存 getMyCompany（互換） --------------------------- */
type MyCompany = { companyId: string | null; role: 'admin' | 'manager' | 'member' | null };
export async function getMyCompany(userId: string, createIfMissing = false): Promise<MyCompany> {
  if (!userId) return { companyId: null, role: null };

  const m = await getMembership(userId);
  if (m.companyId) return { companyId: m.companyId, role: m.role };

  if (!createIfMissing) return { companyId: null, role: null };

  const created = await createCompanyAndJoin({ userId });
  return { companyId: created.companyId, role: created.role };
}

/* --------------------------- main data access --------------------------- */

/** ★ 新：companyId で取得（最推奨） */
export async function getFullStrategyDataByCompany(companyId: string) {
  try {
    if (!isValidUUID(companyId)) return { data: null, error: new Error('invalid companyId') };
    const byCompany = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byCompany.error) return { data: null, error: byCompany.error };
    return {
      data: byCompany.data ? normalizeStrategyData(rowDbToApp(byCompany.data)) : null,
      error: null,
    };
  } catch (error: any) {
    return { data: null, error };
  }
}

/**
 * 互換：従来の userId / strategyId 経由の取得。
 * 内部的には companyId に解決してから取得します。
 */
export async function getFullStrategyData(userId: string, strategyId?: string | null) {
  try {
    if (!userId) return { data: null, error: new Error('userId is required') };

    const sid = strategyId ?? undefined;
    if (isValidUUID(sid)) {
      const byId = await supabase.from(TABLE_NAME).select('*').eq('id', sid).maybeSingle();
      if (!byId.error && byId.data) {
        const row = rowDbToApp(byId.data);
        return { data: normalizeStrategyData(row), error: null };
      }
      console.warn('⚠️ getFullStrategyData: id not found, fallback to company');
    }

    const m = await getMembership(userId);
    if (m.companyId) {
      return await getFullStrategyDataByCompany(m.companyId);
    }

    // 最後の互換フォールバック：company_id が null の個人行
    const byUser = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .is('company_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byUser.error) return { data: null, error: byUser.error };
    return {
      data: byUser.data ? normalizeStrategyData(rowDbToApp(byUser.data)) : null,
      error: null,
    };
  } catch (error: any) {
    return { data: null, error };
  }
}

/** 軽量ヘッダだけ取得（互換：user 起点／ company null 前提） */
export async function loadStrategyHeadByUser(userId: string) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id')
    .eq('user_id', userId)
    .is('company_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ==================== 保存（重複pkey対策／JSON型対策） ==================== */

/** company_id を Cookie → membership の順で解決 */
async function resolveCompanyId(userId: string): Promise<string | null> {
  const fromCookie = getCompanyIdFromCookie();
  if (fromCookie) return fromCookie;
  const m = await getMembership(userId);
  if (m.companyId) {
    try {
      document.cookie = `company_id=${encodeURIComponent(m.companyId)}; Path=/; SameSite=Lax`;
    } catch {}
    return m.companyId;
  }
  return null;
}

function omitId<T extends Record<string, any>>(row: T): T {
  const c = { ...row };
  if ('id' in c) delete (c as any).id;
  if ('strategy_id' in c) delete (c as any).strategy_id;
  return c;
}

/** 戦略データ保存（★ companyId 優先。無ければ user_id + company_id null） */
export async function saveStrategyData(state: StrategyData, userId: string) {
  try {
    const base = toRowDb(state);
    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId);

    // JSON安定化（まずは構造のまま）
    const jsonReady = {
      ...base,
      story: safeJson(base.story),
      finalStory: safeJson(base.finalStory),
      departments: safeJson(base.departments),
      answers2: safeJson(base.answers2),
      csvFinanceData: safeJson(base.csvFinanceData),
    };

    if (companyId) {
      // 会社1行主義：最新1件の id を取得（0件なら null）
      const found = await supabase
        .from(TABLE_NAME)
        .select('id')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (found.error && found.error.code !== 'PGRST116') throw found.error;

      if (found.data?.id) {
        // ★ UPDATE は id で 1 行に限定し、payload から id を除外
        let rU = await supabase
          .from(TABLE_NAME)
          .update(omitId({ ...jsonReady, user_id: userId, updated_at: now }))
          .eq('id', found.data.id) // ここが重要：company_id ではなく id
          .select('id')
          .single();

        if (rU.error && isInvalidJsonSyntax(rU)) {
          const fix = {
            ...jsonReady,
            story: maybeStringify(jsonReady.story),
            finalStory: maybeStringify(jsonReady.finalStory),
            departments: maybeStringify(jsonReady.departments),
            answers2: maybeStringify(jsonReady.answers2),
            csvFinanceData: maybeStringify(jsonReady.csvFinanceData),
          };
          rU = await supabase
            .from(TABLE_NAME)
            .update(omitId({ ...fix, user_id: userId, updated_at: now }))
            .eq('id', found.data.id)
            .select('id')
            .single();
        }
        if (rU.error) throw rU.error;
        return { error: null };
      } else {
        // INSERT（重複pkey根絶：必ず id を除外）
        const payload = omitId({
          ...jsonReady,
          user_id: userId,
          company_id: companyId,
          created_at: now,
          updated_at: now,
        });

        let rI = await supabase
          .from(TABLE_NAME)
          .insert([payload])     // ← 配列で渡す
          .select('id')
          .single();

        if (rI.error && isInvalidJsonSyntax(rI)) {
          const fix = {
            ...payload,
            story: maybeStringify(payload.story),
            finalStory: maybeStringify(payload.finalStory),
            departments: maybeStringify(payload.departments),
            answers2: maybeStringify(payload.answers2),
            csvFinanceData: maybeStringify(payload.csvFinanceData),
          };
          rI = await supabase
            .from(TABLE_NAME)
            .insert([fix])       // ← 配列で渡す
            .select('id')
            .single();
        }
        if (rI.error) throw rI.error;
        return { error: null };
      }
    }

    // 会社未所属：user_id & company_id is null の1行（レガシー互換）
    let u = await supabase
      .from(TABLE_NAME)
      .update(omitId({ ...jsonReady, user_id: userId, company_id: null, updated_at: now }))
      .eq('user_id', userId)
      .is('company_id', null)
      .select('id');

    if (u.error && isInvalidJsonSyntax(u)) {
      const fix = {
        ...jsonReady,
        story: maybeStringify(jsonReady.story),
        finalStory: maybeStringify(jsonReady.finalStory),
        departments: maybeStringify(jsonReady.departments),
        answers2: maybeStringify(jsonReady.answers2),
        csvFinanceData: maybeStringify(jsonReady.csvFinanceData),
      };
      u = await supabase
        .from(TABLE_NAME)
        .update(omitId({ ...fix, user_id: userId, company_id: null, updated_at: now }))
        .eq('user_id', userId)
        .is('company_id', null)
        .select('id');
    }
    if (u.error) throw u.error;

    if (Array.isArray(u.data) && u.data.length > 0) {
      return { error: null };
    }

    // 0件 → INSERT（ここでも id を除外）
    const payload = omitId({
      ...jsonReady,
      user_id: userId,
      company_id: null,
      created_at: now,
      updated_at: now,
    });

    let i = await supabase
      .from(TABLE_NAME)
      .insert([payload])        // ← 配列で渡す（TS2769対策）
      .select('id')
      .single();

    if (i.error && isInvalidJsonSyntax(i)) {
      const fix = {
        ...payload,
        story: maybeStringify(payload.story),
        finalStory: maybeStringify(payload.finalStory),
        departments: maybeStringify(payload.departments),
        answers2: maybeStringify(payload.answers2),
        csvFinanceData: maybeStringify(payload.csvFinanceData),
      };
      i = await supabase
        .from(TABLE_NAME)
        .insert([fix])          // ← 配列で渡す（TS2769対策）
        .select('id')
        .single();
    }
    if (i.error) throw i.error;

    return { error: null };
  } catch (error: any) {
    const info = debugExtractPostgrest(error);
    // eslint-disable-next-line no-console
    console.error('❌ Supabase保存エラー:', `${info.status ?? ''} ${info.code} ${info.message} ${info.details}`);
    return { error };
  }
}

/** 会社基準で削除（互換: 無ければ user_id） */
export async function deleteStrategyData(userId: string) {
  try {
    const m = await getMembership(userId);

    let error;
    if (m.companyId) {
      ({ error } = await supabase.from(TABLE_NAME).delete().eq('company_id', m.companyId));
      if (error && isRlsDenied({ error })) {
        ({ error } = await supabase.from(TABLE_NAME).delete().eq('user_id', userId).is('company_id', null));
      }
    } else {
      ({ error } = await supabase.from(TABLE_NAME).delete().eq('user_id', userId).is('company_id', null));
    }
    if (error) throw error;
    return { error: null };
  } catch (error: any) {
    return { error };
  }
}

/* ----------------------- ancillary ---------------------- */

export async function saveStoryAnswers2(userId: string, answers2: ChapterAnswers[]) {
  try {
    const payload = { user_id: userId, answers2 };
    const { error } = await supabase
      .from('story_answers2')
      .upsert([payload], { onConflict: 'user_id' });
    if (error) throw error;
    return null;
  } catch (error: any) {
    return error;
  }
}

export async function loadStoryAnswers2(userId: string): Promise<ChapterAnswers[] | null> {
  try {
    const { data } = await supabase
      .from('story_answers2')
      .select('answers2')
      .eq('user_id', userId)
      .maybeSingle();
    let result = (data as any)?.answers2;
    if (typeof result === 'string') {
      try {
        result = JSON.parse(result);
      } catch {
        result = [];
      }
    }
    if (!Array.isArray(result)) result = [];
    return result;
  } catch {
    return null;
  }
}

export async function saveProgressLog(
  userId: string,
  okrId: string,
  log: {
    progressText?: string;
    rating?: number;
    ratingComment?: string;
    advice?: string;
    helpRequest?: string;
    department?: string;
  }
) {
  try {
    const { error } = await supabase.from('progress_logs').insert([
      {
        user_id: userId,
        okr_id: okrId,
        progress_text: log.progressText ?? '',
        rating: log.rating ?? null,
        rating_comment: log.ratingComment ?? '',
        advice: log.advice ?? '',
        help_request: log.helpRequest ?? '',
        department: log.department ?? '',
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) throw error;
    return null;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('❌ 進捗ログ保存エラー:', debugExtractPostgrest(error));
    return error;
  }
}

export async function saveFinalStory(userId: string, story: ChapterStory[], summary: string) {
  try {
    const normalized = normalizeChaptersAny(story);
    const { error } = await supabase
      .from('final_stories')
      .upsert([{ user_id: userId, story: normalized, summary }], { onConflict: 'user_id' });
    if (error) throw error;
    return null;
  } catch (error: any) {
    return error;
  }
}

export async function loadFinalStory(userId: string): Promise<ChapterStory[] | null> {
  try {
    const { data, error } = await supabase
      .from('final_stories')
      .select('story')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return normalizeChaptersAny((data as any)?.story || null);
  } catch {
    return null;
  }
}

/** email → userId の簡易探索（存在しない環境はスキップ） */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  try {
    const u = await supabase.from('users').select('id').ilike('email', email).maybeSingle();
    if (!u.error && u.data?.id) return String(u.data.id);
  } catch {}
  try {
    const p = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!p.error && p.data?.id) return String(p.data.id);
  } catch {}
  return null;
}

/** 同一 company のメンバーを削除（admin/RLS 前提） */
export async function removeMember(targetUserId: string): Promise<{ ok: boolean; error?: any }> {
  try {
    const myUid = await getCurrentUserId();
    if (!myUid) return { ok: false, error: new Error('not signed in') };
    const { companyId } = await getMembership(myUid);
    if (!companyId) return { ok: false, error: new Error('company not found') };

    const { error } = await supabase
      .from('company_members')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', targetUserId);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/** 既存ユーザーIDを company に追加（admin/RLS 前提） */
export async function addMemberByUserId(
  targetUserId: string,
  role: 'admin' | 'manager' | 'member' = 'member',
  departmentId: string | null = null
): Promise<{ ok: boolean; error?: any }> {
  try {
    const myUid = await getCurrentUserId();
    if (!myUid) return { ok: false, error: new Error('not signed in') };
    const { companyId } = await getMembership(myUid);
    if (!companyId) return { ok: false, error: new Error('company not found') };

    const { error } = await supabase
      .from('company_members')
      .upsert([{ company_id: companyId, user_id: targetUserId, role, department_id: departmentId }], {
        onConflict: 'company_id,user_id',
        ignoreDuplicates: false,
      });

    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
