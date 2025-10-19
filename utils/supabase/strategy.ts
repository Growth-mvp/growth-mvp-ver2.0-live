// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import { debugExtractPostgrest } from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

/* ============================================================
 * テーブル
 * ============================================================ */
const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';

/* ============================================================
 * 型
 * ============================================================ */
type ReadResult = { data: StrategyData | null; error: any | null };
type WriteResult = { data?: StrategyData | null; error: any | null };

/* ============================================================
 * エラー整形
 * ============================================================ */
function safeStringify(x: any) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function extractErrorVerbose(e: any) {
  const info = debugExtractPostgrest?.(e) as any;
  const out = {
    status: e?.status ?? info?.status ?? null,
    code: e?.code ?? info?.code ?? null,
    message: e?.message ?? info?.message ?? (typeof e === 'string' ? e : null),
    details: e?.details ?? info?.details ?? null,
    hint: (e as any)?.hint ?? info?.hint ?? null,
    name: e?.name ?? null,
    raw: e ?? null,
  };
  if (!out.message) {
    const s = safeStringify(e);
    if (s && s !== '[object Object]') out.message = s;
  }
  return out;
}

/* ============================================================
 * companyId 解決
 * ============================================================ */
async function resolveCompanyId(userId: string, override?: string | null): Promise<string> {
  if (override && isValidUUID(override)) {
    try { setCompanyIdCookie(override); } catch {}
    return override;
  }
  try {
    const byCookie = getCompanyIdFromCookie();
    if (isValidUUID(byCookie)) return byCookie!;
  } catch {}
  const membership = await getMembership(userId);
  const cid = membership?.companyId;
  if (isValidUUID(cid)) {
    try { setCompanyIdCookie(cid!); } catch {}
    return cid!;
  }
  throw new Error('companyIdを解決できません。Cookieまたはmembershipを確認してください。');
}

/* ============================================================
 * JSON整形ユーティリティ
 * ============================================================ */
function parseJson(v: any) {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}
function ensureArray<T = any>(v: any): T[] {
  const p = parseJson(v);
  return Array.isArray(p) ? p : [];
}
function ensureObject<T extends object = Record<string, any>>(v: any): T {
  const p = parseJson(v);
  return (p && typeof p === 'object' && !Array.isArray(p)) ? (p as T) : ({} as T);
}

/* ============================================================
 * finance_summary 双方向正規化
 *  - DB: 必ず object（{ rows: FinanceSummaryRow[] }）
 *  - UI(state): 配列 FinanceSummaryRow[]
 *  - DB制約: chk_strategy_finance_is_object (jsonb_typeof(finance_summary)='object')
 * ============================================================ */
function toDbFinanceSummary(uiValue: any): Record<string, any> {
  if (uiValue == null) return {};
  const parsed = parseJson(uiValue);
  if (Array.isArray(parsed)) return { rows: parsed };
  if (typeof parsed === 'object') {
    if (Array.isArray((parsed as any).rows)) return parsed as Record<string, any>;
    return {};
  }
  return {};
}

function toUiFinanceSummary(dbValue: any): any[] {
  if (dbValue == null) return [];
  const parsed = parseJson(dbValue);
  if (Array.isArray(parsed)) return parsed; // 旧データ互換
  if (typeof parsed === 'object' && Array.isArray((parsed as any).rows)) {
    return (parsed as any).rows;
  }
  return [];
}

/* ============================================================
 * business_portfolio 安全化
 *  - DB: object を期待、null/配列/不正は {}
 *  - UI(state): object | undefined（不正は undefined）
 * ============================================================ */
function toDbBusinessPortfolio(uiValue: any): Record<string, any> {
  if (uiValue == null) return {};
  const parsed = parseJson(uiValue);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
  return {};
}

function toUiBusinessPortfolio(dbValue: any): Record<string, any> | undefined {
  const v = parseJson(dbValue);
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, any>;
  return undefined;
}

/* ============================================================
 * JSON 配列フィールド（NOT NULL 用）
 *  - DB: 常に配列（空は []）
 * ============================================================ */
function toDbJsonArray(v: any): any[] {
  if (v == null) return [];
  const p = parseJson(v);
  return Array.isArray(p) ? p : [];
}

/* ============================================================
 * camelCase ⇄ snake_case マッピング
 * ============================================================ */
const FIELD_MAP: Record<string, string> = {
  companyName: 'company_name',
  foundationYear: 'foundation_year',
  location: 'location',
  industry: 'industry',
  revenue: 'revenue',
  employees: 'employees',
  businessContent: 'business_content',
  customerSegment: 'customer_segment',
  strength: 'strength',
  weakness: 'weakness',
  opportunity: 'opportunity',
  threat: 'threat',
  mission: 'mission',
  vision: 'vision',
  value: 'value',
  thought: 'thought',
  email: 'email',
  role: 'role',
  departments: 'departments',
  csvFinanceData: 'csv_finance_data',
  story: 'story',
  strategySummary: 'strategy_summary',
  editableCascade: 'editable_cascade',
  answers: 'answers',
  answers2: 'answers2',
  finalStory: 'final_story',
  editableCascadeResult: 'editable_cascade_result',
  businessPortfolio: 'business_portfolio',
  financeSummary: 'finance_summary',
  simulationResult: 'simulation_result',
  simulationResults: 'simulation_results',
};

/* ============================================================
 * DB ⇄ State 変換
 * ============================================================ */
function buildDbRowFromState(state: StrategyData) {
  const row: any = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if ((state as any)[camel] === undefined) continue;

    let v = (state as any)[camel];
    v = parseJson(v);

    // === 配列で保存するフィールド ===
    if (snake === 'story' || snake === 'final_story') v = ensureArray(v);
    if (snake === 'answers2') v = ensureArray(v);
    if (snake === 'departments') v = ensureArray(v);
    if (snake === 'simulation_results') v = ensureArray(v);

    // === 特殊ルール ===
    if (snake === 'csv_finance_data') {
      // ★ NOT NULL 対策：常に配列で保存（空は []）
      v = toDbJsonArray(v);
    }

    if (snake === 'finance_summary') {
      // ★ DBは object 必須（{ rows: [...] }）。空は {}。
      v = toDbFinanceSummary(v);
    }

    if (snake === 'business_portfolio') {
      // DBは object。空や不正は {} として保存
      v = toDbBusinessPortfolio(v);
    }

    row[snake] = v;
  }
  return row;
}

function buildStateFromDbRow(row: any): StrategyData {
  const safeRow = row ?? {};
  const out: any = {};

  // 1) マッピング
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(safeRow, snake)) {
      out[camel] = safeRow[snake];
    }
  }

  // 2) 最低限の正規化（UIが配列前提で待ち続けるのを防止）
  out.story = ensureArray(out.story);
  out.finalStory = ensureArray(out.finalStory);
  out.answers2 = ensureArray(out.answers2);
  out.departments = ensureArray(out.departments);
  out.simulationResults = ensureArray(out.simulationResults);

  // financeSummary: DB(object) -> UI(array)
  out.financeSummary = toUiFinanceSummary(out.financeSummary);

  // businessPortfolio: DB(object) -> UI(object|undefined)
  out.businessPortfolio = toUiBusinessPortfolio(out.businessPortfolio);

  // departments.projects.okrs を配列保証
  out.departments = out.departments.map((d: any) => ({
    name: d?.name ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
    })),
  }));

  // answers2 が空ならデフォルト4章を補完
  if (!Array.isArray(out.answers2) || out.answers2.length === 0) {
    out.answers2 = [
      { chapterIndex: 0, chapterTitle: '第1章：なぜ今（現状）', steps: [] },
      { chapterIndex: 1, chapterTitle: '第2章：どう戦う（戦略）', steps: [] },
      { chapterIndex: 2, chapterTitle: '第3章：どんな未来像（会社の未来像）', steps: [] },
      { chapterIndex: 3, chapterTitle: '第4章：どう行動する（行動）', steps: [] },
    ];
  }

  // 3) 追加の正規化（既存の normalizeStrategyData を活用）
  const normalized = normalizeStrategyData(out) as StrategyData;
  console.log('[StrategyData] ✅ buildStateFromDbRow normalized:', normalized);
  return normalized;
}

/* ============================================================
 * データ取得
 * ============================================================ */
export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
  try {
    if (!isValidUUID(companyId)) {
      console.error('[StrategyData] ❌ invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }

    const selectCols = Object.values(FIELD_MAP).join(',');

    const res = await supabase
      .from(T_STRATEGY)
      .select(selectCols)
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[StrategyData] 📄 Supabase raw response:', res);

    if (res.error) {
      const err = extractErrorVerbose(res.error);
      console.error('[StrategyData] ❌ DB error:', err);
      return { data: null, error: err };
    }

    if (!res.data) {
      console.warn('[StrategyData] ⚠️ No strategy_data found for company_id:', companyId);
      return { data: null, error: null };
    }

    const rowData = res.data ?? {};
    console.log('[StrategyData] 🧩 DB row data:', rowData);

    const state = buildStateFromDbRow(rowData);
    console.log('[StrategyData] ✅ Normalized state:', state);

    return { data: state, error: null };
  } catch (e) {
    const err = extractErrorVerbose(e);
    console.error('[StrategyData] ❌ Fatal error in getFullStrategyDataByCompany:', err);
    return { data: null, error: err };
  }
}

/* ============================================================
 * データ保存
 * ============================================================ */
export async function saveStrategyData(
  state: StrategyData,
  userId: string,
  companyIdOverride?: string | null,
): Promise<WriteResult> {
  console.log('[StrategyData] 💾 saveStrategyData called. userId=', userId);
  try {
    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    const cleanCompanyId = companyId.trim();

    const payload = {
      ...buildDbRowFromState(state),
      user_id: userId,
      company_id: cleanCompanyId,
      updated_at: now,
      created_at: now,
    };

    console.log('[StrategyData] 📨 upsert payload:', payload);

    const selectColsAfter = Object.values(FIELD_MAP).join(',');

    const res = await supabase
      .from(T_STRATEGY)
      .upsert(payload, { onConflict: 'company_id', ignoreDuplicates: false })
      .select(selectColsAfter)
      .single();

    if (res.error) {
      const err = extractErrorVerbose(res.error);
      console.error('[StrategyData] ❌ saveStrategyData error:', err, 'rawRes:', safeStringify(res));
      return { data: null, error: err };
    }

    console.log('[StrategyData] ✅ saveStrategyData success. DB returned:', res.data);

    const rowData = res.data ?? {};
    const stateAfter = buildStateFromDbRow(rowData);
    console.log('[StrategyData] ✅ stateAfter normalization complete:', stateAfter);

    return { data: stateAfter, error: null };
  } catch (error) {
    const err = extractErrorVerbose(error);
    console.error('[StrategyData] ❌ saveStrategyData fatal:', err);
    return { data: null, error: err };
  }
}

/* ============================================================
 * 削除
 * ============================================================ */
export async function deleteStrategyData(userId: string): Promise<WriteResult> {
  console.log('[StrategyData] 🗑 deleteStrategyData called for', userId);
  try {
    const companyId = await resolveCompanyId(userId, null);
    await supabase.from(T_PROGRESS).delete().eq('company_id', companyId);
    const del = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    if (del.error) return { error: extractErrorVerbose(del.error) };
    console.log('[StrategyData] ✅ delete success for companyId:', companyId);
    return { error: null };
  } catch (error) {
    console.error('[StrategyData] ❌ deleteStrategyData fatal:', error);
    return { error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * シミュレーション履歴
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
  opts?: { title?: string; scenarioId?: string; maxKeep?: number },
): Promise<WriteResult> {
  console.log('[StrategyData] 📊 appendSimulationResultToStrategy called:', {
    userId,
    payload,
  });
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    const current = await getFullStrategyDataByCompany(companyId);
    if (current.error) return { error: current.error };

    const existing = current.data ?? {};
    const arr: any[] = Array.isArray((existing as any).simulationResults)
      ? (existing as any).simulationResults
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

    const maxKeep = Math.max(1, Math.min(500, opts?.maxKeep ?? 100));
    const next = [entry, ...arr].slice(0, maxKeep);

    const patch = {
      ...(existing as any),
      simulationResults: next,
      simulationResult: payload,
    };

    console.log('[StrategyData] 🧩 simulation patch:', patch);

    return await saveStrategyData(patch as unknown as StrategyData, userId, companyId);
  } catch (error) {
    console.error('[StrategyData] ❌ appendSimulationResultToStrategy fatal:', error);
    return { error: extractErrorVerbose(error) };
  }
}
