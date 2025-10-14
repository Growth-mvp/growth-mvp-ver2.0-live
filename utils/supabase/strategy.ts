// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import {
  debugExtractPostgrest,
  isInvalidJsonSyntax,
  isUniqueViolation,
  isConflict,
} from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs'; // 既存のログテーブルに保存

type ReadResult  = { data: StrategyData | null; error: any | null };
type WriteResult = { error: any | null };

/* ===================================================================
 *  アプリ↔DB カラム整合（camelCase / snake_case）
 * =================================================================== */

const STRATEGY_COLS_APP = new Set<string>([
  'id','user_id','company_id','created_at','updated_at',
  'companyName','foundationYear','location','industry','revenue','employees',
  'businessContent','customerSegment',
  'thought','mission','vision','value','strength','weakness','opportunity','threat',
  'story','finalStory','answers2','departments','csvFinanceData',
  'businessPortfolio','financeSummary',
  'strategySummary','editableCascade','editableCascadeResult',
]);

/** 受信時：snake→camel 互換吸収 */
const LEGACY_KEY_MAP: Record<string, string> = {
  company_name: 'companyName',
  foundation_year: 'foundationYear',
  business_content: 'businessContent',
  customer_segment: 'customerSegment',
  csv_finance_data: 'csvFinanceData',
  csv_finance_data_json: 'csvFinanceData',        // 互換
  final_story: 'finalStory',
  strategy_summary: 'strategySummary',
  editable_cascade: 'editableCascade',
  editable_cascade_result: 'editableCascadeResult',
  business_portfolio: 'businessPortfolio',
  business_portfolio_json: 'businessPortfolio',   // 互換
  finance_summary: 'financeSummary',
  finance_summary_json: 'financeSummary',         // 互換
  finalstory: 'finalStory',
};

/** 送信時：camel→snake（固定列のみ） */
const WRITE_KEY_MAP_BASE: Record<string, string> = {
  companyName: 'company_name',
  foundationYear: 'foundation_year',
  businessContent: 'business_content',
  customerSegment: 'customer_segment',
  finalStory: 'final_story',
  strategySummary: 'strategy_summary',
  editableCascade: 'editable_cascade',
  editableCascadeResult: 'editable_cascade_result',
};

/** 保存で使う実在カラム（*_json は送らない） */
const COLS = {
  financeSummary: 'finance_summary',
  businessPortfolio: 'business_portfolio',
  csvFinanceData: 'csv_finance_data',
} as const;

function pickAppCols(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = obj ?? {};
  for (const k of Object.keys(src)) if (STRATEGY_COLS_APP.has(k)) out[k] = (src as any)[k];
  return out;
}

/** 受信正規化：snake→camel、ざっくり整形 */
function normalizeIncomingKeys(obj: Record<string, unknown> | null | undefined) {
  const src = obj ?? {};
  const patched: Record<string, unknown> = { ...src };
  for (const [legacy, modern] of Object.entries(LEGACY_KEY_MAP)) {
    if (legacy in patched && !(modern in patched)) {
      patched[modern] = patched[legacy];
      delete patched[legacy];
    }
  }
  const afterPick = pickAppCols(patched);

  if ('csvFinanceData' in afterPick) {
    (afterPick as any).csvFinanceData = coerceCsvArray((afterPick as any).csvFinanceData);
  }
  if ('businessPortfolio' in afterPick) {
    (afterPick as any).businessPortfolio = ensureObjectOrNullJson((afterPick as any).businessPortfolio);
  }
  if ('financeSummary' in afterPick) {
    const fs = parseJsonIfString((afterPick as any).financeSummary);
    (afterPick as any).financeSummary = Array.isArray(fs)
      ? fs
      : (fs && typeof fs === 'object' && !Array.isArray(fs) && Array.isArray((fs as any).items))
        ? (fs as any).items
        : ensureArrayJson(fs);
  }
  return afterPick;
}

function toDbKeysBasic(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[WRITE_KEY_MAP_BASE[k] ?? k] = v;
  return out;
}

/* ===================================================================
 *  JSON 正規化ユーティリティ
 * =================================================================== */

function parseJsonIfString(v: any) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
function ensureArrayJson(v: any) {
  const p = parseJsonIfString(v);
  return Array.isArray(p) ? p : [];
}
function ensureObjectOrNullJson(v: any) {
  const p = parseJsonIfString(v);
  return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
}
function ensureObjectJson(v: any) {
  const p = parseJsonIfString(v);
  if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  return {};
}
/** string→JSON.parse、配列/オブジェクトは通し、それ以外は {} */
function ensureArrayOrObjectJson(v: any) {
  const p = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object') return p;
  return {};
}
/** DBのCHECK: finance_summary は object 必須 → { items: [...] } へ包む */
function toFinanceObjectShape(src: any) {
  const arr = ensureArrayJson(src);
  return { items: arr };
}
function coerceCsvArray(src: any): any[] {
  const v = parseJsonIfString(src);
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const candKeys = ['rows', 'data', 'records', 'entries', 'table'];
    for (const k of candKeys) {
      const inner = (v as any)[k];
      if (Array.isArray(inner)) return inner;
    }
  }
  if (typeof v === 'string') {
    const text = v.trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const rows = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(',').map((cell) => cell.trim()));
    return rows;
  }
  return [];
}

/** 保存直前の正規化（空上書き防止のため “undefined は送らない” を後段で適用） */
function normalizeJsonColumnsForSave(anyState: any) {
  return {
    ...anyState,
    story: ensureArrayJson(anyState?.story),
    finalStory: ensureArrayJson(anyState?.finalStory),
    answers2: ensureArrayJson(anyState?.answers2),
    departments: ensureArrayJson(anyState?.departments),

    // ← ここは “元データを保持”。送るかどうかは insertOrUpdate で判定
    csvFinanceData: anyState?.csvFinanceData,
    businessPortfolio: anyState?.businessPortfolio,
    financeSummary: anyState?.financeSummary,

    // DB CHECKが array/object の列は最低限整形
    strategySummary: ensureArrayOrObjectJson(anyState?.strategySummary),
    editableCascade: ensureArrayOrObjectJson(anyState?.editableCascade),
    editableCascadeResult: ensureArrayOrObjectJson(anyState?.editableCascadeResult),
  };
}
function safeJson(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (typeof v === 'string') return parseJsonIfString(v);
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

/* ===================================================================
 *  ログ／エラー整形
 * =================================================================== */

function omitId<T extends Record<string, any>>(row: T): T {
  const c = { ...row }; delete (c as any).id; delete (c as any).strategy_id; return c;
}
function safeStringify(obj: any) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj,(k,v)=>{ if(typeof v==='object'&&v!==null){ if(seen.has(v))return'[Circular]'; seen.add(v); } return v;},2);
  } catch { try { return String(obj); } catch { return '[Unserializable]'; } }
}
function previewValue(v: any) {
  const { story, finalStory, answers2, departments, csvFinanceData, businessPortfolio, financeSummary, ...rest } = v || {};
  return {
    ...rest,
    story: Array.isArray(story) ? `array(${story.length})` : typeof story,
    finalStory: Array.isArray(finalStory) ? `array(${finalStory.length})` : typeof finalStory,
    answers2: Array.isArray(answers2) ? `array(${answers2.length})` : typeof answers2,
    departments: Array.isArray(departments) ? `array(${departments.length})` : typeof departments,
    hasCsvFinanceData: Array.isArray(csvFinanceData) ? `array(${csvFinanceData.length})` : !!csvFinanceData,
    businessPortfolio: businessPortfolio && typeof businessPortfolio === 'object' ? 'object' : businessPortfolio,
    financeSummary: Array.isArray(financeSummary) ? `array(${financeSummary.length})` : financeSummary,
  };
}
function group(label: string, color = '#1976d2') {
  try { /* @ts-ignore */ console.groupCollapsed?.(`%c${label}`, `color:${color}`); return () => { /* @ts-ignore */ console.groupEnd?.(); }; }
  catch { return () => {}; }
}
function extractErrorVerbose(e: any) {
  const info = debugExtractPostgrest(e);
  const raw = { status: e?.status, code: e?.code, message: e?.message, details: e?.details, hint: e?.hint };
  const merged = { ...(typeof info === 'object' ? info : {}), __raw: raw };
  if (!merged['code'] && !merged['message'] && !merged['details']) (merged as any).__dump = e;
  return merged;
}

/** 未定義列: 42703 / PGRST204 */
const isUndefinedColumn = (e: any) => {
  const code = e?.code || e?.__raw?.status || e?.__raw?.code;
  const msg  = `${e?.message || ''} ${e?.details || ''}`.toLowerCase();
  return code === '42703' || code === 'PGRST204' || msg.includes('could not find the');
};
const isCheckViolation = (e: any) => (e?.code === '23514');
const constraintIncludes = (e: any, key: string) => {
  const s = `${e?.constraint || ''} ${e?.details || ''} ${e?.message || ''}`;
  return s.toLowerCase().includes(key.toLowerCase());
};

/** 送信前に __ で始まる一時キーを除去 */
function stripPrivateKeys(row: Record<string, unknown>) {
  const r: Record<string, unknown> = { ...row };
  for (const k of Object.keys(r)) if (k.startsWith('__')) delete r[k];
  return r;
}

/* ===================================================================
 *  companyId 解決
 * =================================================================== */

async function resolveCompanyId(userId: string, override?: string | null): Promise<string | null> {
  const end = group('🧭 resolveCompanyId', '#546e7a');
  try {
    if (override && isValidUUID(override)) {
      try { setCompanyIdCookie(override); } catch {}
      return override;
    }
    try {
      const fromCookie = getCompanyIdFromCookie();
      if (fromCookie) return fromCookie;
    } catch {}
    try {
      const m: any = await getMembership(userId);
      const cid = m?.companyId;
      if (cid && isValidUUID(cid)) {
        try { setCompanyIdCookie(cid); } catch {}
        return cid;
      }
    } catch {}
    return null;
  } finally { end(); }
}

async function resolveCompanyIdOrThrow(userId: string, override?: string | null): Promise<string> {
  const cid = await resolveCompanyId(userId, override);
  if (!cid) throw new Error('companyIdを解決できません。会社メンバーシップやCookieの設定を確認してください。');
  return cid;
}

/* ===================================================================
 *  取得
 * =================================================================== */

export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  const end = group('📥 getFullStrategyDataByCompany');
  try {
    if (!isValidUUID(companyId)) return { data: null, error: new Error('invalid companyId') };
    const res: any = await supabase.from(T_STRATEGY).select('*')
      .eq('company_id', companyId).order('updated_at', { ascending: false })
      .limit(1).maybeSingle();
    if (res?.error) return { data: null, error: res.error };
    const camel = res?.data ? normalizeIncomingKeys(res.data as any) : null;
    return { data: camel ? normalizeStrategyData(camel as any) : null, error: null };
  } catch (e: any) { return { data: null, error: e }; } finally { end(); }
}

export async function getFullStrategyData(userId: string, strategyId?: string | null): Promise<ReadResult> {
  const end = group('📥 getFullStrategyData');
  try {
    if (!userId) return { data: null, error: new Error('userId is required') };

    // id指定があれば優先
    if (isValidUUID(strategyId ?? undefined)) {
      const byId: any = await supabase.from(T_STRATEGY).select('*').eq('id', strategyId).maybeSingle();
      if (!byId?.error && byId?.data) {
        const camel = normalizeIncomingKeys(byId.data as any);
        return { data: normalizeStrategyData(camel as any), error: null };
      }
    }

    // 常に会社で取得
    const companyId = await resolveCompanyIdOrThrow(userId, null);
    return await getFullStrategyDataByCompany(companyId);

  } catch (e: any) { return { data: null, error: e }; } finally { end(); }
}

/* ===================================================================
 *  保存（UPDATE-first、会社必須）
 *   - ❗ 3カラムは“条件付き送信”で空上書きを防止
 *     * src === undefined → 送らない（現状維持）
 *     * src === null      → null を送って明示クリア
 *     * それ以外          → 正規化して送る
 * =================================================================== */

type WhereMode = { kind: 'company'; companyId: string };

function applyOptionalJsonColumns(
  baseRow: Record<string, unknown>,
  opts: {
    financeSummarySrc: any;
    businessPortfolioSrc: any;
    csvFinanceDataSrc: any;
    isInsert: boolean;
  }
) {
  const row: Record<string, unknown> = { ...baseRow };

  // finance_summary（object）
  if (opts.financeSummarySrc !== undefined) {
    row[COLS.financeSummary] =
      opts.financeSummarySrc === null ? null : toFinanceObjectShape(opts.financeSummarySrc);
  } else if (opts.isInsert) {
    // insert時は指定が無ければ触らない
  }

  // business_portfolio（object）
  if (opts.businessPortfolioSrc !== undefined) {
    row[COLS.businessPortfolio] =
      opts.businessPortfolioSrc === null ? null : ensureObjectJson(opts.businessPortfolioSrc);
  } else if (opts.isInsert) {
    // 触らない
  }

  // csv_finance_data（array）
  if (opts.csvFinanceDataSrc !== undefined) {
    row[COLS.csvFinanceData] =
      opts.csvFinanceDataSrc === null ? null : coerceCsvArray(opts.csvFinanceDataSrc);
  } else if (opts.isInsert) {
    // 触らない
  }

  return row;
}

async function insertOrUpdateFixed(
  mode: 'insert' | 'update',
  baseRow: Record<string, unknown>,
  where: WhereMode,
  srcs: { financeSummarySrc: any; businessPortfolioSrc: any; csvFinanceDataSrc: any }
) {
  const isInsert = mode === 'insert';

  const row = stripPrivateKeys(
    applyOptionalJsonColumns(
      { ...baseRow },
      {
        ...srcs,
        isInsert,
      },
    ),
  );

  if (isInsert) {
    return await supabase.from(T_STRATEGY).insert([row]).select('id').single();
  }
  return await supabase
    .from(T_STRATEGY)
    .update(row)
    .eq('company_id', where.companyId)
    .select('id')
    .maybeSingle();
}

export async function saveStrategyData(
  state: StrategyData,
  userId: string,
  companyIdOverride?: string | null,
): Promise<WriteResult> {
  const end = group('💾 saveStrategyData', '#2e7d32');
  try {
    const now = new Date().toISOString();
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);

    // 1) 受取正規化（id等除去）
    const baseCamel = normalizeIncomingKeys(omitId(state as any));

    // 2) JSON 正規化（※ 3カラムは“送る/送らない”判定のため raw を保持）
    const jsonFixedCamel = normalizeJsonColumnsForSave({
      ...baseCamel,
      story: safeJson((state as any)?.story),
      finalStory: safeJson((state as any)?.finalStory),
      answers2: safeJson((state as any)?.answers2),
      departments: safeJson((state as any)?.departments),
      csvFinanceData: (state as any)?.csvFinanceData,       // raw維持
      businessPortfolio: (state as any)?.businessPortfolio, // raw維持
      financeSummary: (state as any)?.financeSummary,       // raw維持
      strategySummary: safeJson((state as any)?.strategySummary),
      editableCascade: safeJson((state as any)?.editableCascade),
      editableCascadeResult: safeJson((state as any)?.editableCascadeResult),
    });

    // 3) camel→snake（固定列のみ）
    const payloadDBBase: Record<string, unknown> = toDbKeysBasic(jsonFixedCamel);
    (payloadDBBase as any).story        = ensureArrayJson((payloadDBBase as any).story);
    (payloadDBBase as any).final_story  = ensureArrayJson((payloadDBBase as any).final_story);
    (payloadDBBase as any).answers2     = ensureArrayJson((payloadDBBase as any).answers2);
    (payloadDBBase as any).departments  = ensureArrayJson((payloadDBBase as any).departments);

    // ★3カラムはこの段階では送らない（insertOrUpdateFixed で条件付き付与）
    delete (payloadDBBase as any).csv_finance_data;
    delete (payloadDBBase as any).csvFinanceData;
    delete (payloadDBBase as any).businessPortfolio;
    delete (payloadDBBase as any).financeSummary;

    // 送信用共通本体
    const common = {
      ...payloadDBBase,
      user_id: userId,
      updated_at: now,
      company_id: companyId,
    } as Record<string, unknown>;

    // 会社行の存在チェック → UPDATE or INSERT
    const exists: any = await supabase
      .from(T_STRATEGY)
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();

    const srcs = {
      financeSummarySrc: (jsonFixedCamel as any).financeSummary,     // undefined/null/配列のまま
      businessPortfolioSrc: (jsonFixedCamel as any).businessPortfolio,
      csvFinanceDataSrc: (jsonFixedCamel as any).csvFinanceData,
    };

    if (!exists?.error && exists?.data) {
      const upd = await insertOrUpdateFixed('update', common, { kind: 'company', companyId }, srcs);
      return upd?.error ? { error: extractErrorVerbose(upd.error) } : { error: null };
    } else {
      const ins = await insertOrUpdateFixed('insert', { ...common, created_at: now }, { kind: 'company', companyId }, srcs);
      return ins?.error ? { error: extractErrorVerbose(ins.error) } : { error: null };
    }
  } catch (error: any) {
    const info = extractErrorVerbose(error);
    console.error('❌ saveStrategyData fatal:', info);
    return { error: info };
  } finally { end(); }
}

/* ===================================================================
 *  削除（会社単位）
 * =================================================================== */

export async function deleteStrategyData(userId: string): Promise<WriteResult> {
  const end = group('🗑 deleteStrategyData', '#c62828');
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, null);
    const { error }: any = await supabase.from(T_PROGRESS).delete().eq('company_id', companyId); // ログも消すならこちら
    if (error) {
      // ログ削除に失敗しても本体削除は試みる
      console.warn('⚠ progress_logs delete failed:', extractErrorVerbose(error));
    }
    const delStrategy: any = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    if (delStrategy?.error) return { error: extractErrorVerbose(delStrategy.error) };
    return { error: null };
  } catch (error: any) {
    return { error: extractErrorVerbose(error) };
  } finally { end(); }
}

/* ===================================================================
 *  追加：シミュレーション保存 / 取得
 *   - progress_logs に category='simulation' として保存（列が無ければ最小構成にフォールバック）
 *   - 既存のOKRログと同居できる柔軟な形にしている
 * =================================================================== */

export type SimulationSavePayload = {
  projection: {
    points: Array<{ year: string; sales: number; op: number; opMargin?: number }>;
  };
  finalProb: number; // 0..1
  krsSnapshot?: any; // その時点のKR構成（ダンプ）
  meta?: { label?: string; note?: string }; // 任意メタ
};

export type SimulationLogRow = {
  id: string;
  created_at: string;
  user_id: string;
  company_id: string;
  category?: string; // 'simulation'
  kind?: string;     // 互換キー
  type?: string;     // 互換キー
  okr_id?: string | null;
  log?: any;
  payload?: any;
  // data?: any;  ← 使いません
};

export async function saveSimulationResult(
  userId: string,
  payload: SimulationSavePayload,
  companyIdOverride?: string | null,
): Promise<WriteResult> {
  const end = group('📈 saveSimulationResult', '#6a1b9a');
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);
    const now = new Date().toISOString();

    // 基本（メタ列あり）
    const baseRow = {
      user_id: userId,
      company_id: companyId,
      created_at: now,
      category: 'simulation',
      kind: 'simulation',
      type: 'simulation',
      okr_id: null,
    } as Record<string, any>;

    // 1st: log 列
    {
      const row = { ...baseRow, log: safeJson(payload) };
      const res: any = await supabase.from(T_PROGRESS).insert([row]).select('id').single();
      if (!res?.error) return { error: null };
      const e = extractErrorVerbose(res.error);
      if (!isUndefinedColumn(e)) return { error: e };
      // 列未定義（categoryやlog等）→ 次の試行へ
    }

    // 2nd: payload 列
    {
      const row = { ...baseRow, payload: safeJson(payload) };
      const res: any = await supabase.from(T_PROGRESS).insert([row]).select('id').single();
      if (!res?.error) return { error: null };
      const e = extractErrorVerbose(res.error);
      if (!isUndefinedColumn(e)) return { error: e };
      // 列未定義 → 最小構成へ
    }

    // 3rd: 最小構成（メタ列を外す／JSON列は log→payload の順で再試行）
    const minimal = { user_id: userId, company_id: companyId, created_at: now } as Record<string, any>;

    // 3-1: log
    {
      const row = { ...minimal, log: safeJson(payload) };
      const res: any = await supabase.from(T_PROGRESS).insert([row]).select('id').single();
      if (!res?.error) return { error: null };
      const e = extractErrorVerbose(res.error);
      if (!isUndefinedColumn(e)) return { error: e };
    }

    // 3-2: payload
    {
      const row = { ...minimal, payload: safeJson(payload) };
      const res: any = await supabase.from(T_PROGRESS).insert([row]).select('id').single();
      if (!res?.error) return { error: null };
      return { error: extractErrorVerbose(res.error) };
    }

  } catch (error: any) {
    return { error: extractErrorVerbose(error) };
  } finally { end(); }
}

export async function getSimulationResults(
  userId: string,
  companyIdOverride?: string | null,
  opts?: { limit?: number }
): Promise<{ rows: SimulationLogRow[]; error: any | null }> {
  const end = group('📊 getSimulationResults', '#00838f');
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));

    // 1st: category 列がある前提でフィルタ
    {
      const q = supabase
        .from(T_PROGRESS)
        .select('*')
        .eq('company_id', companyId)
        .eq('category', 'simulation')
        .order('created_at', { ascending: false })
        .limit(limit);

      const res: any = await q;
      if (!res?.error) {
        const rows: SimulationLogRow[] = Array.isArray(res?.data) ? res.data : [];
        return { rows, error: null };
      }
      const e = extractErrorVerbose(res.error);
      if (!isUndefinedColumn(e)) return { rows: [], error: e };
      // 列未定義 → フォールバック
    }

    // 2nd: category 無し全件（同社）から新しい順で取得
    {
      const q = supabase
        .from(T_PROGRESS)
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const res: any = await q;
      if (res?.error) return { rows: [], error: extractErrorVerbose(res.error) };

      const rows: SimulationLogRow[] = Array.isArray(res?.data) ? res.data : [];
      return { rows, error: null };
    }

  } catch (error: any) {
    return { rows: [], error: extractErrorVerbose(error) };
  } finally { end(); }
}
