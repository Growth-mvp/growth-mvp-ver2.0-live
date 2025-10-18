// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import { debugExtractPostgrest } from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';
const T_SIM = 'simulation_results';

type ReadResult = { data: StrategyData | null; error: any | null };
type WriteResult = { error: any | null };

/* ============================================================
 * JSON Utility
 * ============================================================ */
function parseJsonIfString(v: any) {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
function ensureArrayJson(v: any) {
  const p = parseJsonIfString(v);
  return Array.isArray(p) ? p : [];
}
function ensureObjectJson(v: any) {
  const p = parseJsonIfString(v);
  if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  return {};
}
function ensureArrayOrObjectJson(v: any) {
  const p = parseJsonIfString(v);
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object') return p;
  return {};
}
function safeJson(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (typeof v === 'string') return parseJsonIfString(v);
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/* ============================================================
 * Key Normalizer
 * ============================================================ */
function normalizeIncomingKeys(obj: Record<string, unknown> | null | undefined) {
  const src = obj ?? {};
  const patched: Record<string, unknown> = { ...src };

  // legacy→modern mapping（snake→camel 互換）
  const LEGACY_KEY_MAP: Record<string, string> = {
    company_name: 'companyName',
    foundation_year: 'foundationYear',
    business_content: 'businessContent',
    customer_segment: 'customerSegment',
    final_story: 'finalStory',
    business_portfolio: 'businessPortfolio',
    finance_summary: 'financeSummary',
    csv_finance_data: 'csvFinanceData',
    strategy_summary: 'strategySummary',
    editable_cascade: 'editableCascade',
    editable_cascade_result: 'editableCascadeResult',
    simulation_result: 'simulationResult',
    simulation_results: 'simulationResults',
  };
  for (const [legacy, modern] of Object.entries(LEGACY_KEY_MAP)) {
    if (legacy in patched && !(modern in patched)) {
      patched[modern] = patched[legacy];
      delete patched[legacy];
    }
  }

  // array/object columns normalize（最低限の型安全）
  patched.departments = ensureArrayJson((patched as any).departments);
  patched.answers2 = ensureArrayJson((patched as any).answers2);
  patched.story = ensureArrayJson((patched as any).story);
  patched.finalStory = ensureArrayJson((patched as any).finalStory);
  patched.financeSummary = ensureArrayJson((patched as any).financeSummary);
  patched.businessPortfolio = ensureObjectJson((patched as any).businessPortfolio);
  // 互換で持ってくる可能性のある列
  if ('csvFinanceData' in patched) {
    const v = (patched as any).csvFinanceData;
    const p = parseJsonIfString(v);
    (patched as any).csvFinanceData = Array.isArray(p) ? p : v;
  }
  // B案：ストラテジー内スナップショット/履歴
  if ('simulationResult' in patched) {
    const sim = parseJsonIfString((patched as any).simulationResult);
    (patched as any).simulationResult =
      sim && typeof sim === 'object' && !Array.isArray(sim) ? sim : undefined;
  }
  if ('simulationResults' in patched) {
    const arr = parseJsonIfString((patched as any).simulationResults);
    (patched as any).simulationResults = Array.isArray(arr) ? arr : [];
  }

  return patched;
}

/* ============================================================
 * Error & Log
 * ============================================================ */
function extractErrorVerbose(e: any) {
  const info = debugExtractPostgrest(e);
  const raw = {
    status: e?.status,
    code: e?.code,
    message: e?.message,
    details: e?.details,
    hint: e?.hint,
  };
  const merged = { ...(typeof info === 'object' ? info : {}), __raw: raw };
  return merged;
}

/* ============================================================
 * companyId Resolver（Cookieにも保存）
 * ============================================================ */
async function resolveCompanyId(userId: string, override?: string | null): Promise<string | null> {
  if (override && isValidUUID(override)) {
    try { setCompanyIdCookie(override); } catch {}
    return override;
  }
  try {
    const cookie = getCompanyIdFromCookie();
    if (cookie) return cookie;
  } catch {}
  try {
    const m: any = await getMembership(userId);
    const cid = m?.companyId ?? null;
    if (cid) {
      try { setCompanyIdCookie(cid); } catch {}
    }
    return cid;
  } catch {
    return null;
  }
}
async function resolveCompanyIdOrThrow(userId: string, override?: string | null): Promise<string> {
  const cid = await resolveCompanyId(userId, override);
  if (!cid) throw new Error('companyIdを解決できません。');
  return cid;
}

/* ============================================================
 * SELECT
 * ============================================================ */
export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  try {
    if (!isValidUUID(companyId))
      return { data: null, error: new Error('invalid companyId') };
    const res: any = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) return { data: null, error: res.error };
    const camel = res?.data ? normalizeIncomingKeys(res.data as any) : null;
    return { data: camel ? normalizeStrategyData(camel as any) : null, error: null };
  } catch (e: any) {
    return { data: null, error: e };
  }
}

export async function getFullStrategyData(
  userId: string,
  strategyId?: string | null
): Promise<ReadResult> {
  try {
    if (!userId) return { data: null, error: new Error('userId is required') };

    // by id
    if (isValidUUID(strategyId ?? undefined)) {
      const byId: any = await supabase
        .from(T_STRATEGY)
        .select('*')
        .eq('id', strategyId)
        .maybeSingle();
      if (!byId.error && byId.data) {
        const camel = normalizeIncomingKeys(byId.data as any);
        return { data: normalizeStrategyData(camel as any), error: null };
      }
    }

    // by company
    const companyId = await resolveCompanyIdOrThrow(userId, null);
    return await getFullStrategyDataByCompany(companyId);
  } catch (e: any) {
    return { data: null, error: e };
  }
}

/* ============================================================
 * UPSERT (insert/update)
 * ============================================================ */
export async function saveStrategyData(
  state: StrategyData,
  userId: string,
  companyIdOverride?: string | null
): Promise<WriteResult> {
  try {
    const now = new Date().toISOString();
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);
    const base = normalizeIncomingKeys(state as any);

    // 送信前に最低限の型整形
    const payload = {
      ...base,
      story: ensureArrayJson(base.story),
      finalStory: ensureArrayJson(base.finalStory),
      answers2: ensureArrayJson(base.answers2),
      departments: ensureArrayJson(base.departments),
      businessPortfolio: 'businessPortfolio' in base ? ensureObjectJson(base.businessPortfolio) : undefined,
      financeSummary: 'financeSummary' in base ? ensureArrayJson(base.financeSummary) : undefined,
      csvFinanceData: 'csvFinanceData' in base ? ensureArrayJson(base.csvFinanceData) : undefined,
      simulationResult: 'simulationResult' in base ? ensureObjectJson(base.simulationResult) : undefined,
      simulationResults: 'simulationResults' in base ? ensureArrayJson(base.simulationResults) : undefined,
      // メタ
      updated_at: now,
      user_id: userId,
      company_id: companyId,
    } as Record<string, any>;

    // undefined は空上書きを防ぐため削除
    for (const k of Object.keys(payload)) {
      if (typeof payload[k] === 'undefined') delete payload[k];
    }

    // 既存行チェック
    const exists: any = await supabase
      .from(T_STRATEGY)
      .select('id')
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();

    if (exists?.data) {
      // update
      const { error } = await supabase
        .from(T_STRATEGY)
        .update(payload)
        .eq('company_id', companyId)
        .select('id')
        .single(); // ← 引数なし（v2仕様）
      if (error) return { error: extractErrorVerbose(error) };
      return { error: null };
    } else {
      // insert
      const { error } = await supabase
        .from(T_STRATEGY)
        .insert([{ ...payload, created_at: now }])
        .select('id')
        .single(); // ← 引数なし（v2仕様）
      if (error) return { error: extractErrorVerbose(error) };
      return { error: null };
    }
  } catch (e: any) {
    console.error('❌ saveStrategyData failed', e);
    return { error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * DELETE（会社単位）
 * ============================================================ */
export async function deleteStrategyData(userId: string): Promise<WriteResult> {
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, null);
    const res: any = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    return res.error ? { error: extractErrorVerbose(res.error) } : { error: null };
  } catch (e: any) {
    return { error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * SIMULATION履歴保存（B案：strategy_data 内に配列で保持）
 * ============================================================ */
export type SimulationSavePayload = {
  projection: {
    points: Array<{ year: string; sales: number; op: number; opMargin?: number }>;
  };
  finalProb: number;
  krsSnapshot?: any;
  meta?: { label?: string; note?: string };
};

export async function appendSimulationResultToStrategy(
  userId: string,
  payload: SimulationSavePayload,
  companyIdOverride?: string | null,
  opts?: { title?: string; scenarioId?: string; maxKeep?: number }
): Promise<WriteResult> {
  try {
    const companyId = await resolveCompanyIdOrThrow(userId, companyIdOverride);
    const { data, error } = await getFullStrategyDataByCompany(companyId);
    if (error) return { error };
    const existing = (data as any) ?? {};
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
      payload: safeJson(payload),
    };
    const maxKeep = Math.max(1, Math.min(2000, opts?.maxKeep ?? 200));
    const next = [entry, ...arr].slice(0, maxKeep);
    const patch: any = {
      ...existing,
      simulationResults: next,
      simulationResult: payload,
    };
    return await saveStrategyData(patch, userId, companyId);
  } catch (e: any) {
    return { error: extractErrorVerbose(e) };
  }
}
