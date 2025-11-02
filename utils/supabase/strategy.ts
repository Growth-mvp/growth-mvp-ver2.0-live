// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import { debugExtractPostgrest } from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

/* ============================================================
 * テーブル名
 * ========================================================== */
const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';
const T_STORY_ANSWERS = 'story_answers2';
const T_FINAL_STORIES = 'final_stories';

// レガシー分離テーブル（移行後は原則読み書きしない／掃除対象）
const T_LEGACY = ['simulationresults', 'simulationresult', 'financesummary', 'business_portfolio'] as const;

/* ============================================================
 * 型
 * ========================================================== */
type ReadResult = { data: (StrategyData & { revision?: number }) | null; error: any | null };
type WriteResult = { data?: (StrategyData & { revision?: number }) | null; error: any | null };

/* 進捗ログの入力型（必要に応じて拡張OK） */
export type ProgressLogInput = {
  userId: string;
  okrId: string;
  projectId?: string | null;
  departmentId?: string | null;
  companyIdOverride?: string | null;
  content: string; // 本文
  status?: 'ontrack' | 'atrisk' | 'offtrack' | null;
  score?: number | null; // 0-1 など任意
  createdAt?: string;    // 指定なければサーバ側で now()
};

/* ============================================================
 * エラー整形
 * ========================================================== */
function safeStringify(x: any) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
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
const isRlsPermissionError = (err: any) => {
  const code = err?.code || err?.hint || '';
  const status = err?.status;
  return status === 401 || status === 403 || code === '42501';
};

/* ============================================================
 * companyId / userId 解決
 * ========================================================== */
async function getActiveUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

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
 * ========================================================== */
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

/* undefined を深い階層まで除去（“意図しない上書き”抑制） */
function pruneUndefinedDeep<T = any>(input: T): T {
  if (Array.isArray(input)) {
    // @ts-ignore
    return input.map((v) => pruneUndefinedDeep(v)).filter((v) => v !== undefined) as T;
  }
  if (input && typeof input === 'object') {
    const obj = input as any;
    const entries = Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, pruneUndefinedDeep(v)]);
    // @ts-ignore
    return Object.fromEntries(entries);
  }
  return input;
}

/* “空扱い”の判定 */
function isEmptyLike(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/* Deep Merge（incoming優先。ただし incoming が“空”なら既存を保持） */
function deepMergePreserveNonEmpty(target: any, incoming: any): any {
  // 空 → 既存を返す
  if (isEmptyLike(incoming)) return target;

  // プリミティブ/配列は incoming を採用（ただし空配列は前段で弾いている）
  if (typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;

  // 両方オブジェクトならキー単位でマージ
  const out: any = { ...(target && typeof target === 'object' ? target : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    const prev = out[k];
    if (typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMergePreserveNonEmpty(prev, v);
    } else {
      out[k] = isEmptyLike(v) ? prev : v;
    }
  }
  return out;
}

/* ============================================================
 * finance_summary 双方向正規化
 * ========================================================== */
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
 * ========================================================== */
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
 * ========================================================== */
function toDbJsonArray(v: any): any[] {
  const p = parseJson(v);
  return Array.isArray(p) ? p : [];
}

/* ============================================================
 * camelCase ⇄ snake_case マッピング
 *  ※ 分離テーブル化したキーは FIELD_MAP から除外
 * ========================================================== */
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
 *  ※ answers2 / finalStory は分離テーブルのため saveStrategyData では保存しない
 * ========================================================== */
function isEffectivelyEmptyForServer(state: Partial<StrategyData>): boolean {
  const arrEmpty = (a: any) => !Array.isArray(a) || a.length === 0;
  const strEmpty = (v: any) => typeof v !== 'string' || v.trim() === '';

  const sim = (state as any)?.simulationResult;
  const simPoints = (sim as any)?.projection?.points;

  return (
    arrEmpty((state as any).story) &&
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
 * ========================================================== */
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

function buildStateFromDbRow(row: any): (StrategyData & { revision?: number }) {
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
    ...d,
    name: d?.name ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      ...p,
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
 * 共通：既存行を * で取得
 * ========================================================== */
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
 * ========================================================== */
export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
  try {
    if (!isValidUUID(companyId)) {
      console.error('[StrategyData] ❌ invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }

    // 1) strategy_data は * で取得（列増減耐性のため *）
    const baseRes = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (baseRes.error) {
      return { data: null, error: extractErrorVerbose(baseRes.error) };
    }
    if (!baseRes.data) {
      return { data: null, error: null };
    }

    const rowData = baseRes.data ?? {};

    // 2) 分離テーブルを並列取得（存在すれば読み込み時のみ合流）
    const [ansRes, finRes] = await Promise.allSettled([
      supabase.from(T_STORY_ANSWERS)
        .select('answers2, steps, updated_at, user_id, strategy_id')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false }),
      supabase.from(T_FINAL_STORIES)
        .select('final_story, story, updated_at, user_id, strategy_id')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false }),
    ]);

    const answers2Rows =
      ansRes.status === 'fulfilled' ? (ansRes.value.data ?? []) : [];
    const finalStoryRows =
      finRes.status === 'fulfilled' ? (finRes.value.data ?? []) : [];

    // 3) strategy_data -> state
    const state = buildStateFromDbRow(rowData);

    // 4) 分離テーブルを state に流し込む（最新優先／既存があれば尊重）
    const latestAnswers = answers2Rows[0]?.answers2 ?? answers2Rows[0]?.steps ?? [];
    const latestFinal = finalStoryRows[0]?.final_story ?? finalStoryRows[0]?.story ?? [];
    state.answers2 = ensureArray(state.answers2).length ? state.answers2 : ensureArray(latestAnswers);
    state.finalStory = ensureArray(state.finalStory).length ? state.finalStory : ensureArray(latestFinal);

    return { data: state, error: null };
  } catch (e) {
    return { data: null, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 保存（空保存抑止＋楽観ロック＋DB現行とのDeepMerge）
 * ========================================================== */
export async function saveStrategyData(
  ...args: any[]
): Promise<WriteResult> {
  // 新API: (payload)
  // 旧API: (payload, userId, companyIdOverride?, revision?, opts?)
  const payload: StrategyData = args[0];
  let userId: string | undefined = args[1];
  let companyIdOverride: string | null | undefined = args[2];
  let revision: number | undefined = args[3];
  let opts: { mode?: 'upsert' | 'updateOnly' } | undefined = args[4];

  // 新API（1引数）であれば userId をセッションから解決
  if (args.length === 1) {
    userId = await getActiveUserId() ?? undefined;
    opts = { mode: 'upsert' };
  }

  console.log('[StrategyData] 💾 saveStrategyData called. userId=', userId, 'rev=', revision, 'opts=', opts);
  try {
    if (!userId) {
      return { data: null, error: { status: 401, message: 'no userId (session not found)' } };
    }

    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    const cleanCompanyId = companyId.trim();

    // 0) 空保存ガード（answers2/finalStoryだけの変更は分離APIで保存する想定）
    if (isEffectivelyEmptyForServer(payload)) {
      console.warn('[StrategyData] ⛔ save skipped: effectively empty payload');
      const cur = await getFullStrategyDataByCompany(cleanCompanyId);
      return { data: cur.data ?? null, error: null };
    }

    // 1) 既存行の取得
    let existingRow: any | null = null;
    try {
      const existingRes = await fetchExistingRow(cleanCompanyId);
      existingRow = existingRes.data ?? null;
    } catch (e) {
      return { data: null, error: extractErrorVerbose(e) };
    }

    // 2) 既存Stateへ変換（マージ元）
    const existingState: StrategyData & { revision?: number } =
      existingRow ? buildStateFromDbRow(existingRow) : ({} as any);

    // 3) 送信前に undefined を除去
    const prunedIncoming: StrategyData = pruneUndefinedDeep(payload);

    // 4) DB現行と “空で上書きしない” ルールで DeepMerge
    const mergedState = deepMergePreserveNonEmpty(existingState, prunedIncoming) as StrategyData;

    // 5) DB用行を構築
    const baseRow = buildDbRowFromState(mergedState);

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
        q = q.eq('updated_at', currentUpdatedAt);
      }

      const upd = await q.select(selectAfter).single();
      if (upd.error) {
        return { data: null, error: extractErrorVerbose(upd.error) };
      }

      const stateAfter = buildStateFromDbRow(upd.data ?? {});
      return { data: stateAfter, error: null };
    }

    // === ここまでで既存行が無い ===
    if (opts?.mode === 'updateOnly') {
      console.log('[StrategyData] updateOnly mode → skip insert (no existing row).');
      return { data: null, error: null };
    }

    // === INSERT ===
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
      return { data: null, error: extractErrorVerbose(ins.error) };
    }

    const stateAfter = buildStateFromDbRow(ins.data ?? {});
    return { data: stateAfter, error: null };
  } catch (error) {
    return { data: null, error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 削除（統一化後の標準：子→親）
 * ========================================================== */
export async function deleteStrategyData(userId: string, companyIdOverride?: string | null): Promise<WriteResult> {
  console.log('[StrategyData] 🗑 deleteStrategyData called for', userId, companyIdOverride ?? '(cookie/membership)');
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

    // 1) 子テーブルから先に削除（冪等）
    const delAns = await supabase.from(T_STORY_ANSWERS).delete().eq('company_id', companyId);
    if (delAns.error && delAns.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ story_answers2 delete warn:', extractErrorVerbose(delAns.error));
    }
    const delFinal = await supabase.from(T_FINAL_STORIES).delete().eq('company_id', companyId);
    if (delFinal.error && delFinal.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ final_stories delete warn:', extractErrorVerbose(delFinal.error));
    }

    // 2) 進捗ログも掃除
    const delProg = await supabase.from(T_PROGRESS).delete().eq('company_id', companyId);
    if (delProg.error && delProg.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ progress_logs delete warn:', extractErrorVerbose(delProg.error));
    }

    // 3) 親テーブル（strategy_data）を削除
    const del = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    if (del.error) return { error: extractErrorVerbose(del.error) };

    console.log('[StrategyData] ✅ delete success for companyId:', companyId);
    return { error: null };
  } catch (error) {
    return { error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 全削除（会社スコープの完全掃除：レガシー含む）
 * ========================================================== */
export async function deleteAllCompanyData(userId: string, companyIdOverride?: string | null) {
  const companyId = await resolveCompanyId(userId, companyIdOverride);
  const tablesInOrder = [
    T_PROGRESS,
    T_STORY_ANSWERS,
    T_FINAL_STORIES,
    ...T_LEGACY,
    T_STRATEGY,
  ];

  const errors: Array<{ table: string; error: any }> = [];
  for (const t of tablesInOrder) {
    try {
      const r = await supabase.from(t).delete().eq('company_id', companyId);
      if (r.error && r.error.code !== 'PGRST116') {
        errors.push({ table: t, error: extractErrorVerbose(r.error) });
      }
    } catch (e) {
      errors.push({ table: t, error: extractErrorVerbose(e) });
    }
  }

  if (errors.length) {
    console.warn('[deleteAllCompanyData] some tables failed to delete', errors);
    return { ok: false, errors };
  }
  console.log('[deleteAllCompanyData] ✅ wiped for company_id=', companyId);
  return { ok: true };
}

/* ============================================================
 * レガシーテーブル削除（任意の掃除用ユーティリティ）
 * ========================================================== */
export async function purgeLegacyTables(userId: string, companyIdOverride?: string | null) {
  const companyId = await resolveCompanyId(userId, companyIdOverride);
  for (const t of T_LEGACY) {
    try {
      const res = await supabase.from(t).delete().eq('company_id', companyId);
      if (res.error && res.error.code !== 'PGRST116') {
        console.warn(`[LegacyPurge] ${t} delete warn:`, extractErrorVerbose(res.error));
      } else {
        console.log(`[LegacyPurge] ${t} deleted for company_id=${companyId}`);
      }
    } catch (e) {
      console.warn(`[LegacyPurge] ${t} fatal:',`, extractErrorVerbose(e));
    }
  }
}

/* ============================================================
 * シミュレーション履歴（strategy_data 内の配列を使用）
 * ========================================================== */
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
        (globalThis as any).crypto?.randomUUID?.() ?? //
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

    const rev = (existing as any)?.revision;
    return await saveStrategyData(
      patch as unknown as StrategyData,
      userId,
      companyId,
      typeof rev === 'number' ? rev : undefined
    );
  } catch (error) {
    return { error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 履歴取得API
 * ========================================================== */
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
      return { rows: [], error: extractErrorVerbose(error) };
    }

    const rowsAll: SimulationResultRow[] = ensureArray<SimulationResultRow>(data?.simulation_results);
    const limit = Math.max(1, opts?.limit ?? 20);
    const rows = [...rowsAll]
      .sort((a, b) => (b?.created_at ?? '').localeCompare(a?.created_at ?? ''))
      .slice(0, limit);

    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 進捗ログ保存（INSERT）
 * ========================================================== */
export async function saveProgressLog(input: ProgressLogInput): Promise<{ data: any | null; error: any | null }> {
  try {
    const {
      userId,
      okrId,
      projectId = null,
      departmentId = null,
      companyIdOverride = null,
      content,
      status = null,
      score = null,
      createdAt,
    } = input;

    const companyId = await resolveCompanyId(userId, companyIdOverride);

    const row = {
      user_id: userId,
      company_id: companyId,
      okr_id: okrId,
      project_id: projectId,
      department_id: departmentId,
      content,
      status,
      score,
      ...(createdAt ? { created_at: createdAt } : {}),
    };

    const { data, error } = await supabase
      .from(T_PROGRESS)
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return { data: null, error: extractErrorVerbose(error) };
    }
    return { data, error: null };
  } catch (e) {
    return { data: null, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 追加：分離テーブルへの保存API（company_id 一意／手動UPSERT固定）
 * ========================================================== */

/** 手動UPSERT：company_id（+任意でstrategy_id）で存在確認 → UPDATE/INSERT */
async function robustUpsert(
  table: string,
  row: Record<string, any>,
  _conflictTargets: string[], // 互換のため未使用
) {
  try {
    // 1) 既存行の存在確認（strategy_id がある場合はスコープを狭める）
    let q = supabase.from(table)
      .select('company_id, user_id, strategy_id, updated_at')
      .eq('company_id', row.company_id)
      .limit(1);
    if ('strategy_id' in row && row.strategy_id) {
      q = q.eq('strategy_id', row.strategy_id);
    }
    const got = await (q as any).maybeSingle();
    if (got.error && got.error.code !== 'PGRST116') {
      return { ok: false, error: extractErrorVerbose(got.error) };
    }

    // 2) 存在すれば UPDATE、無ければ INSERT
    if (got.data) {
      let uq = supabase.from(table)
        .update(row)
        .eq('company_id', row.company_id);
      if ('strategy_id' in row && row.strategy_id) {
        uq = (uq as any).eq('strategy_id', row.strategy_id);
      }
      const upd = await (uq as any).select('*').maybeSingle();
      if (upd.error) {
        const ex = extractErrorVerbose(upd.error);
        if (isRlsPermissionError(ex)) {
          console.warn(`[${table}] RLS update blocked. Consider relaxing policy (same-company members).`, ex);
        }
        return { ok: false, error: ex };
      }
      return { ok: true, error: null };
    } else {
      const ins = await supabase.from(table).insert(row).select('*').maybeSingle();
      if (ins.error) {
        const ex = extractErrorVerbose(ins.error);
        if (isRlsPermissionError(ex)) {
          console.warn(`[${table}] RLS insert blocked. Check auth.uid() / membership.`, ex);
        }
        return { ok: false, error: ex };
      }
      return { ok: true, error: null };
    }
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}

/** 最終ストーリーを final_stories に永続化（company_id一意） */
export async function saveFinalStory(
  userId: string,
  finalStory: Array<{ title: string; body: string }>,
  opts?: { companyId?: string | null; strategyId?: string | null }
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, opts?.companyId ?? null);
    const now = new Date().toISOString();
    const row: any = {
      company_id: companyId,
      user_id: userId,
      final_story: ensureArray(finalStory),
      updated_at: now,
      ...(opts?.strategyId ? { strategy_id: opts.strategyId } : {}),
    };
    const r = await robustUpsert(T_FINAL_STORIES, row, []);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}

/** 質問回答（answers2）を story_answers2 に永続化（company_id一意） */
export async function saveStoryAnswers2(
  userId: string,
  answers2: any[],
  opts?: { companyId?: string | null; strategyId?: string | null }
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, opts?.companyId ?? null);
    const now = new Date().toISOString();
    const row: any = {
      company_id: companyId,
      user_id: userId,
      answers2: ensureArray(answers2),
      updated_at: now,
      ...(opts?.strategyId ? { strategy_id: opts.strategyId } : {}),
    };
    const r = await robustUpsert(T_STORY_ANSWERS, row, []);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}
