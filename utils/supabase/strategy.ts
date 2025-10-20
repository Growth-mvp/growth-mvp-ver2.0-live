// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import { debugExtractPostgrest } from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

/* ============================================================
 * テーブル名
 * ============================================================ */
const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';
const T_STORY_ANSWERS = 'story_answers2';
const T_FINAL_STORIES = 'final_stories';

/* ============================================================
 * 型
 * ============================================================ */
type ReadResult = { data: (StrategyData & { revision?: number }) | null; error: any | null };
type WriteResult = { data?: (StrategyData & { revision?: number }) | null; error: any | null };

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
 * JSONユーティリティ
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
 *  - DB: { rows: FinanceSummaryRow[] } の object
 *  - UI: FinanceSummaryRow[] の配列
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
  if (Array.isArray(parsed)) return parsed; // 旧互換
  if (typeof parsed === 'object' && Array.isArray((parsed as any).rows)) {
    return (parsed as any).rows;
  }
  return [];
}

/* ============================================================
 * business_portfolio 安全化
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
 * JSON 配列フィールド（NOT NULL想定）
 * ============================================================ */
function toDbJsonArray(v: any): any[] {
  if (v == null) return [];
  const p = parseJson(v);
  return Array.isArray(p) ? p : [];
}

/* ============================================================
 * camelCase ⇄ snake_case マッピング
 *  ※ 分離テーブル化したキーは FIELD_MAP から除外
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
  businessPortfolio: 'business_portfolio',
  financeSummary: 'finance_summary',
  simulationResults: 'simulation_results',
};

/* ============================================================
 * “実質空”判定（空保存ガード）
 * ============================================================ */
function isEffectivelyEmptyForServer(state: Partial<StrategyData>): boolean {
  const arrEmpty = (a: any) => !Array.isArray(a) || a.length === 0;
  const strEmpty = (v: any) => typeof v !== 'string' || v.trim() === '';

  const sim = (state as any)?.simulationResult;
  const simPoints = (sim as any)?.projection?.points;

  return (
    arrEmpty((state as any).story) &&
    arrEmpty((state as any).finalStory) &&   // 読み込みで補完、保存はしない
    arrEmpty((state as any).answers2) &&     // 読み込みで補完、保存はしない
    arrEmpty((state as any).departments) &&
    arrEmpty((state as any).csvFinanceData) &&
    arrEmpty((state as any).financeSummary) &&
    (!(state as any).businessPortfolio || arrEmpty(((state as any).businessPortfolio as any)?.units)) &&
    (!sim || arrEmpty(simPoints)) &&
    ['companyName', 'mission', 'vision', 'value', 'thought']
      .filter((k) => (state as any)[k] !== undefined)
      .every((k) => strEmpty((state as any)[k]))
  );
}

/* ============================================================
 * DB ⇄ State 変換
 * ============================================================ */
function buildDbRowFromState(state: StrategyData) {
  const row: any = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if ((state as any)[camel] === undefined) continue;

    let v = (state as any)[camel];
    v = parseJson(v);

    // 配列保存
    if (snake === 'story') v = ensureArray(v);
    if (snake === 'departments') v = ensureArray(v);
    if (snake === 'simulation_results') v = ensureArray(v);

    // 特殊
    if (snake === 'csv_finance_data') v = toDbJsonArray(v);
    if (snake === 'finance_summary') v = toDbFinanceSummary(v);
    if (snake === 'business_portfolio') v = toDbBusinessPortfolio(v);

    row[snake] = v;
  }
  return row;
}

function buildStateFromDbRow(row: any): StrategyData & { revision?: number } {
  const safeRow = row ?? {};
  const out: any = {};

  // 1) strategy_data の既存列を写す
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(safeRow, snake)) {
      out[camel] = safeRow[snake];
    }
  }

  // 2) 最低限の正規化
  out.story = ensureArray(out.story);
  out.departments = ensureArray(out.departments);
  out.simulationResults = ensureArray(out.simulationResults);
  out.financeSummary = toUiFinanceSummary(out.financeSummary);
  out.businessPortfolio = toUiBusinessPortfolio(out.businessPortfolio);

  // 部門→プロジェクト→OKR 配列保証
  out.departments = out.departments.map((d: any) => ({
    name: d?.name ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
    })),
  }));

  // 3) normalize（互換吸収）
  const normalized = normalizeStrategyData(out) as StrategyData;

  // 4) revision
  const revision = typeof safeRow?.revision === 'number' ? safeRow.revision : undefined;
  return { ...normalized, revision };
}

/* ============================================================
 * 共通：既存行を * で取得（revision列の有無を動的判定したい）
 * ============================================================ */
async function fetchExistingRow(companyId: string) {
  const res = await supabase
    .from(T_STRATEGY)
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  // PGRST116 = No rows
  if (res.error && res.error.code !== 'PGRST116') {
    throw res.error;
  }
  return res as { data?: any; error?: any };
}

/* ============================================================
 * 取得：strategy_data=* + 分離テーブル合流
 * ============================================================ */
export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
  try {
    if (!isValidUUID(companyId)) {
      console.error('[StrategyData] ❌ invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }

    // 1) strategy_data は * で取得
    const baseRes = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[StrategyData] 📄 Supabase raw response:', baseRes);

    if (baseRes.error) {
      const err = extractErrorVerbose(baseRes.error);
      console.error('[StrategyData] ❌ DB error:', err);
      return { data: null, error: err };
    }
    if (!baseRes.data) {
      console.warn('[StrategyData] ⚠️ No strategy_data found for company_id:', companyId);
      return { data: null, error: null };
    }

    const rowData = baseRes.data ?? {};
    console.log('[StrategyData] 🧩 DB row data:', rowData);

    // 2) 分離テーブルを並列取得
    const [ansRes, finRes] = await Promise.allSettled([
      supabase.from(T_STORY_ANSWERS)
        .select('*')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false }),
      supabase.from(T_FINAL_STORIES)
        .select('*')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false }),
    ]);

    const answers2Rows =
      ansRes.status === 'fulfilled' ? (ansRes.value.data ?? []) : (console.warn('[StrategyData] ⚠ story_answers2 fetch skipped:', ansRes.reason), []);
    const finalStoryRows =
      finRes.status === 'fulfilled' ? (finRes.value.data ?? []) : (console.warn('[StrategyData] ⚠ final_stories fetch skipped:', finRes.reason), []);

    // 3) strategy_data -> state
    const state = buildStateFromDbRow(rowData);

    // 4) 分離テーブルを state に流し込む（最新優先）
    const latestAnswers = answers2Rows[0]?.answers2 ?? answers2Rows[0]?.steps ?? [];
    const latestFinal = finalStoryRows[0]?.final_story ?? finalStoryRows[0]?.story ?? [];
    state.answers2 = ensureArray(state.answers2).length ? state.answers2 : ensureArray(latestAnswers);
    state.finalStory = ensureArray(state.finalStory).length ? state.finalStory : ensureArray(latestFinal);

    console.log('[StrategyData] ✅ Normalized state:', state);
    return { data: state, error: null };
  } catch (e) {
    const err = extractErrorVerbose(e);
    console.error('[StrategyData] ❌ Fatal error in getFullStrategyDataByCompany:', err);
    return { data: null, error: err };
  }
}

/* ============================================================
 * 保存（空保存抑止＋楽観ロック）
 *  - revision列があれば revision ロック、無ければ updated_at ロックを使う
 *  - 分離テーブル化した列は strategy_data へ書かない
 * ============================================================ */
export async function saveStrategyData(
  state: StrategyData,
  userId: string,
  companyIdOverride?: string | null,
  revision?: number,
): Promise<WriteResult> {
  console.log('[StrategyData] 💾 saveStrategyData called. userId=', userId, 'rev=', revision);
  try {
    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    const cleanCompanyId = companyId.trim();

    if (isEffectivelyEmptyForServer(state)) {
      console.warn('[StrategyData] ⛔ save skipped: effectively empty payload');
      const cur = await getFullStrategyDataByCompany(cleanCompanyId);
      return { data: cur.data ?? null, error: null };
    }

    const baseRow = buildDbRowFromState(state);

    // 既存行の有無（*で取得して列の有無を確認）
    let existingRow: any | null = null;
    try {
      const existingRes = await fetchExistingRow(cleanCompanyId);
      existingRow = existingRes.data ?? null;
    } catch (e) {
      const err = extractErrorVerbose(e);
      console.error('[StrategyData] ❌ check existing error:', err);
      return { data: null, error: err };
    }

    const hasRevision: boolean =
      !!existingRow && Object.prototype.hasOwnProperty.call(existingRow, 'revision');

    const currentRev: number | undefined =
      hasRevision && typeof existingRow?.revision === 'number'
        ? existingRow.revision
        : undefined;

    const currentUpdatedAt: string | undefined =
      typeof existingRow?.updated_at === 'string' ? existingRow.updated_at : undefined;

    const selectAfter = '*'; // 列増減に強くする

    // === UPDATE ===
    if (existingRow) {
      const expectedRev = typeof revision === 'number'
        ? revision
        : (typeof currentRev === 'number' ? currentRev : undefined);

      const updatePayload: any = {
        ...baseRow,
        user_id: userId,
        company_id: cleanCompanyId,
        updated_at: now,
      };

      // revision列が存在している場合だけ、次世代をセット
      if (hasRevision && typeof expectedRev === 'number') {
        updatePayload.revision = expectedRev + 1;
      }

      let q = supabase
        .from(T_STRATEGY)
        .update(updatePayload)
        .eq('company_id', cleanCompanyId);

      // 楽観ロック条件
      if (hasRevision && typeof expectedRev === 'number') {
        q = q.eq('revision', expectedRev);
      } else if (currentUpdatedAt) {
        // revisionが無い環境では updated_at を軽量ロックとして使用
        q = q.eq('updated_at', currentUpdatedAt);
      }

      const upd = await q.select(selectAfter).single();

      if (upd.error) {
        const err = extractErrorVerbose(upd.error);
        if (err.code === 'PGRST116' || err.status === 406 || err.status === 409) {
          console.error('[StrategyData] ⚠️ save conflict (stale).', { expectedRev, currentRev, currentUpdatedAt });
          return { data: null, error: { ...err, message: 'conflict: stale state' } };
        }
        console.error('[StrategyData] ❌ update error:', err);
        return { data: null, error: err };
      }

      const stateAfter = buildStateFromDbRow(upd.data ?? {});
      return { data: stateAfter, error: null };
    }

    // === INSERT ===
    // revision 列が無い環境でも成功するように、insertPayload には revision を含めない
    const insertPayload: any = {
      ...baseRow,
      user_id: userId,
      company_id: cleanCompanyId,
      updated_at: now,
      created_at: now,
    };

    const ins = await supabase
      .from(T_STRATEGY)
      .insert(insertPayload)
      .select(selectAfter)
      .single();

    if (ins.error) {
      const err = extractErrorVerbose(ins.error);
      console.error('[StrategyData] ❌ insert error:', err, 'rawRes:', safeStringify(ins));
      return { data: null, error: err };
    }

    const stateAfter = buildStateFromDbRow(ins.data ?? {});
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
 * シミュレーション履歴（strategy_data 内の配列を使用）
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
  console.log('[StrategyData] 📊 appendSimulationResultToStrategy called:', { userId, payload });
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
      // 旧互換（state上の参照用。保存先は simulationResults のみ）
      simulationResult: payload,
    };

    console.log('[StrategyData] 🧩 simulation patch:', patch);

    const rev = (existing as any)?.revision;
    return await saveStrategyData(
      patch as unknown as StrategyData,
      userId,
      companyId,
      typeof rev === 'number' ? rev : undefined
    );
  } catch (error) {
    console.error('[StrategyData] ❌ appendSimulationResultToStrategy fatal:', error);
    return { error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 履歴取得API
 * ============================================================ */
export type SimulationResultRow = {
  id: string;
  created_at: string;
  title?: string | null;
  scenario_id?: string | null;
  payload: SimulationSavePayload;
};

export async function getSimulationResults(
  userId: string,
  companyIdOverride: string | null = null,
  opts: { limit?: number } = {},
): Promise<{ rows: SimulationResultRow[]; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    const { data, error } = await supabase
      .from(T_STRATEGY)
      .select('simulation_results')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      const err = extractErrorVerbose(error);
      console.error('[StrategyData] ❌ getSimulationResults DB error:', err);
      return { rows: [], error: err };
    }

    const rowsAll: SimulationResultRow[] = ensureArray<SimulationResultRow>(data?.simulation_results);
    const limit = Math.max(1, opts?.limit ?? 20);
    const rows = [...rowsAll]
      .sort((a, b) => (b?.created_at ?? '').localeCompare(a?.created_at ?? ''))
      .slice(0, limit);

    return { rows, error: null };
  } catch (e) {
    const err = extractErrorVerbose(e);
    console.error('[StrategyData] ❌ getSimulationResults fatal:', err);
    return { rows: [], error: err };
  }
}
