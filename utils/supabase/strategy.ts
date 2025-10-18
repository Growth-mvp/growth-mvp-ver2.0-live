// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import {
  debugExtractPostgrest,
} from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';          // 互換フォールバック用
const T_SIM = 'simulation_results';          // 互換フォールバック用

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
  // B案：strategy_data 内のスナップショット & 履歴
  'simulationResult',     // 最新1件スナップショット
  'simulationResults',    // 履歴（配列）
]);

/** 受信時：snake→camel 互換吸収 */
const LEGACY_KEY_MAP: Record<string, string> = {
  company_name: 'companyName',
  foundation_year: 'foundationYear',
  business_content: 'businessContent',
  customer_segment: 'customerSegment',
  csv_finance_data: 'csvFinanceData',
  csv_finance_data_json: 'csvFinanceData',
  final_story: 'finalStory',
  strategy_summary: 'strategySummary',
  editable_cascade: 'editableCascade',
  editable_cascade_result: 'editableCascadeResult',
  business_portfolio: 'businessPortfolio',
  business_portfolio_json: 'businessPortfolio',
  finance_summary: 'financeSummary',
  finance_summary_json: 'financeSummary',
  finalstory: 'finalStory',
  // 単数スナップショット
  simulation_result: 'simulationResult',
  // 履歴（配列）
  simulation_results: 'simulationResults',
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
  simulationResult: 'simulation_result',     // スナップショット
  simulationResults: 'simulation_results',   // 履歴（配列）
} as const;

function pickAppCols(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = obj ?? {};
  for (const k of Object.keys(src)) if (STRATEGY_COLS_APP.has(k)) out[k] = (src as any)[k];
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
/** csv_finance_data: 配列 or 簡易CSVを配列へ */
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
  // 単数スナップショットは object 推奨。文字列なら parse して object/undefined に正規化
  if ('simulationResult' in afterPick) {
    const sim = parseJsonIfString((afterPick as any).simulationResult);
    (afterPick as any).simulationResult =
      sim && typeof sim === 'object' && !Array.isArray(sim) ? sim
      : sim === null ? null
      : undefined;
  }
  // 履歴（配列）正規化
  if ('simulationResults' in afterPick) {
    const arr = parseJsonIfString((afterPick as any).simulationResults);
    (afterPick as any).simulationResults = Array.isArray(arr) ? arr : [];
  }
  return afterPick;
}

function toDbKeysBasic(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[WRITE_KEY_MAP_BASE[k] ?? k] = v;
  return out;
}

/* ===================================================================
 *  ログ／エラー整形
 * =================================================================== */

function extractErrorVerbose(e: any) {
  const info = debugExtractPostgrest(e);
  const raw = { status: e?.status, code: e?.code, message: e?.message, details: e?.details, hint: e?.hint };
  const merged = { ...(typeof info === 'object' ? info : {}), __raw: raw };
  if (!merged['code'] && !merged['message'] && !merged['details']) (merged as any).__dump = e;
  return merged;
}

/** 未定義列/テーブル検知 */
const isUndefinedColumn = (e: any) => {
  const code = e?.code || e?.__raw?.status || e?.__raw?.code;
  const msg  = `${e?.message || ''} ${e?.details || ''}`.toLowerCase();
  return code === '42703' || code === 'PGRST204' || msg.includes('could not find the');
};
const isUndefinedTable = (e: any) => {
  const code = e?.code || e?.__raw?.status || e?.__raw?.code;
  const msg  = `${e?.message || ''} ${e?.details || ''}`.toLowerCase();
  return code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'));
};

/* ===================================================================
 *  companyId 解決
 * =================================================================== */

async function resolveCompanyId(userId: string, override?: string | null): Promise<string | null> {
  if (override && isValidUUID(override)) {
    try { setCompanyIdCookie(override); } catch {}
    return override;
  }
  try {
    const fromCookie = getCompanyIdFromCookie();
    if (fromCookie) return fromCookie;
  } catch {}
  const m: any = await getMembership(userId);
  const cid = m?.companyId;
  if (cid && isValidUUID(cid)) {
    try { setCompanyIdCookie(cid); } catch {}
    return cid;
  }
  return null;
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
  try {
    if (!isValidUUID(companyId)) return { data: null, error: new Error('invalid companyId') };
    const res: any = await supabase.from(T_STRATEGY).select('*')
      .eq('company_id', companyId).order('updated_at', { ascending: false })
      .limit(1).maybeSingle();
    if (res?.error) return { data: null, error: res.error };
    const camel = res?.data ? normalizeIncomingKeys(res.data as any) : null;
    return { data: camel ? normalizeStrategyData(camel as any) : null, error: null };
  } catch (e: any) { return { data: null, error: e }; }
}

export async function getFullStrategyData(userId: string, strategyId?: string | null): Promise<ReadResult> {
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

  } catch (e: any) { return { data: null, error: e }; }
}

/* ===================================================================
 *  保存（UPDATE-first、会社必須）
 *   - ❗ 5カラムは“条件付き送信”で空上書きを防止
 *     * src === undefined → 送らない（現状維持）
 *     * src === null      → null を送って明示クリア
 *     * それ以外          → 正規化して送る
 * =================================================================== */

type WhereMode = { kind: 'company'; companyId: string };

/** 保存直前の正規化（空上書き防止のため “undefined は送らない” を後段で適用） */
function normalizeJsonColumnsForSave(anyState: any) {
  return {
    ...anyState,
    story: ensureArrayJson(anyState?.story),
    finalStory: ensureArrayJson(anyState?.finalStory),
    answers2: ensureArrayJson(anyState?.answers2),
    departments: ensureArrayJson(anyState?.departments),

    // raw を保持（送る/送らない判定は後段）
    csvFinanceData: anyState?.csvFinanceData,
    businessPortfolio: anyState?.businessPortfolio,
    financeSummary: anyState?.financeSummary,

    // B案：strategy_data 内
    simulationResult: anyState?.simulationResult,     // object|null|undefined
    simulationResults: anyState?.simulationResults,   // array|null|undefined

    // object/array 必須列の最低整形
    strategySummary: ensureArrayOrObjectJson(anyState?.strategySummary),
    editableCascade: ensureArrayOrObjectJson(anyState?.editableCascade),
    editableCascadeResult: ensureArrayOrObjectJson(anyState?.editableCascadeResult),
  };
}

function stripPrivateKeys(row: Record<string, unknown>) {
  const r: Record<string, unknown> = { ...row };
  for (const k of Object.keys(r)) if (k.startsWith('__')) delete r[k];
  return r;
}

function applyOptionalJsonColumns(
  baseRow: Record<string, unknown>,
  opts: {
    financeSummarySrc: any;
    businessPortfolioSrc: any;
    csvFinanceDataSrc: any;
    simulationResultSrc: any;     // object
    simulationResultsSrc?: any;   // array
  }
) {
  const row: Record<string, unknown> = { ...baseRow };

  // finance_summary（object: {items: [...] }）
  if (opts.financeSummarySrc !== undefined) {
    row[COLS.financeSummary] =
      opts.financeSummarySrc === null ? null : toFinanceObjectShape(opts.financeSummarySrc);
  }

  // business_portfolio（object）
  if (opts.businessPortfolioSrc !== undefined) {
    row[COLS.businessPortfolio] =
      opts.businessPortfolioSrc === null ? null : ensureObjectJson(opts.businessPortfolioSrc);
  }

  // csv_finance_data（array）
  if (opts.csvFinanceDataSrc !== undefined) {
    row[COLS.csvFinanceData] =
      opts.csvFinanceDataSrc === null ? null : coerceCsvArray(opts.csvFinanceDataSrc);
  }

  // simulation_result（object）
  if (opts.simulationResultSrc !== undefined) {
    const v = opts.simulationResultSrc;
    row[COLS.simulationResult] = v === null ? null : ensureObjectJson(v);
  }

  // simulation_results（array）
  if (opts.simulationResultsSrc !== undefined) {
    const v = opts.simulationResultsSrc;
    row[COLS.simulationResults] = v === null ? null : ensureArrayJson(v);
  }

  return row;
}

async function insertOrUpdateFixed(
  mode: 'insert' | 'update',
  baseRow: Record<string, unknown>,
  where: WhereMode,
  srcs: {
    financeSummarySrc: any;
    businessPortfolioSrc: any;
    csvFinanceDataSrc: any;
    simulationResultSrc: any;
    simulationResultsSrc?: any;
  }
) {
  const row = stripPrivateKeys(
    applyOptionalJsonColumns(
      { ...baseRow },
      srcs,
    ),
  );

  if (mode === 'insert') {
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
  try {
    const now = new Date().toISOString();
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);

    // 1) 受取正規化（id等除去）
    const baseCamel = normalizeIncomingKeys(state as any);

    // 2) JSON 正規化（※ 可変JSON列は“送る/送らない”判定のため raw を保持）
    const jsonFixedCamel = normalizeJsonColumnsForSave({
      ...baseCamel,
    });

    // 3) camel→snake（固定列のみ）
    const payloadDBBase: Record<string, unknown> = toDbKeysBasic(jsonFixedCamel);
    (payloadDBBase as any).story        = ensureArrayJson((payloadDBBase as any).story);
    (payloadDBBase as any).final_story  = ensureArrayJson((payloadDBBase as any).final_story);
    (payloadDBBase as any).answers2     = ensureArrayJson((payloadDBBase as any).answers2);
    (payloadDBBase as any).departments  = ensureArrayJson((payloadDBBase as any).departments);

    // ★ 可変JSON列はこの段階では送らない（insertOrUpdateFixed で条件付き付与）
    delete (payloadDBBase as any).csv_finance_data;
    delete (payloadDBBase as any).csvFinanceData;
    delete (payloadDBBase as any).businessPortfolio;
    delete (payloadDBBase as any).financeSummary;
    delete (payloadDBBase as any).simulationResult;
    delete (payloadDBBase as any).simulation_result;
    delete (payloadDBBase as any).simulationResults;
    delete (payloadDBBase as any).simulation_results;

    // 送信用本体
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
      financeSummarySrc: (jsonFixedCamel as any).financeSummary,
      businessPortfolioSrc: (jsonFixedCamel as any).businessPortfolio,
      csvFinanceDataSrc: (jsonFixedCamel as any).csvFinanceData,
      simulationResultSrc: (jsonFixedCamel as any).simulationResult,
      simulationResultsSrc: (jsonFixedCamel as any).simulationResults,
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
  }
}

/* ===================================================================
 *  削除（会社単位）
 * =================================================================== */

export async function deleteStrategyData(userId: string): Promise<WriteResult> {
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, null);
    // ログ削除（存在しない列/テーブルでも本体削除は続行）
    try {
      const { error }: any = await supabase.from(T_PROGRESS).delete().eq('company_id', companyId);
      if (error) console.warn('⚠ progress_logs delete failed:', extractErrorVerbose(error));
    } catch (e) {
      console.warn('⚠ progress_logs delete skipped:', extractErrorVerbose(e));
    }
    const delStrategy: any = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    if (delStrategy?.error) return { error: extractErrorVerbose(delStrategy.error) };
    return { error: null };
  } catch (error: any) {
    return { error: extractErrorVerbose(error) };
  }
}

/* ===================================================================
 *  履歴（B案）：strategy_data 内に保持
 * =================================================================== */

export type SimulationSavePayload = {
  projection: {
    points: Array<{ year: string; sales: number; op: number; opMargin?: number }>;
  };
  finalProb: number; // 0..1
  krsSnapshot?: any; // その時点のKR構成（ダンプ）
  meta?: { label?: string; note?: string }; // 任意メタ
};

export async function appendSimulationResultToStrategy(
  userId: string,
  payload: SimulationSavePayload,
  companyIdOverride?: string | null,
  opts?: { title?: string; scenarioId?: string; maxKeep?: number } // maxKeep: 履歴上限
): Promise<WriteResult> {
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);

    // 既存の strategy_data を取得
    const current = await getFullStrategyDataByCompany(companyId);
    if (current.error) return { error: current.error };

    const existing = (current.data as any) ?? {};
    const arr: any[] = Array.isArray(existing.simulationResults)
      ? existing.simulationResults
      : [];

    const entry = {
      id:
        (globalThis as any).crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      title: opts?.title ?? null,
      scenario_id: opts?.scenarioId ?? null,
      payload: JSON.parse(JSON.stringify(payload)),
    };

    const maxKeep = Math.max(1, Math.min(2000, opts?.maxKeep ?? 200));
    const next = [entry, ...arr].slice(0, maxKeep);

    // スナップショットも同時更新
    const patch: any = {
      ...existing,
      simulationResults: next,
      simulationResult: payload,
    };

    return await saveStrategyData(patch, userId, companyId);
  } catch (error: any) {
    return { error: extractErrorVerbose(error) };
  }
}
