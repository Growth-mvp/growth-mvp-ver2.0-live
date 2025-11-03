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
  if (isEmptyLike(incoming)) return target;
  if (typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
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
    if (snake === 'story') v = ensureArray(v);
    if (snake === 'departments') v = ensureArray(v);
    if (snake === 'simulation_results') v = ensureArray(v);
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

  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(safeRow, snake)) {
      out[camel] = safeRow[snake];
    }
  }

  out.story = ensureArray(out.story);
  out.departments = ensureArray(out.departments);
  out.simulationResults = ensureArray(out.simulationResults);
  out.financeSummary = toUiFinanceSummary(out.financeSummary);
  out.businessPortfolio = toUiBusinessPortfolio(out.businessPortfolio);

  out.departments = out.departments.map((d: any) => ({
    ...d,
    name: d?.name ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      ...p,
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
    })),
  }));

  const normalized = normalizeStrategyData(out) as StrategyData;
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
  if (res.error && res.error.code !== 'PGRST116') {
    throw res.error;
  }
  return res as { data?: any; error?: any };
}

/* ============================================================
 * answers2 <-> departments マージ用ヘルパ
 * ========================================================== */
function buildAnswers2FromDepartments(state: StrategyData): any[] {
  const out: any[] = [];
  const depts = ensureArray(state?.departments);
  depts.forEach((d: any, idx: number) => {
    const a0 = ensureArray(d?.answers2).find((x: any) => Array.isArray(x?.steps));
    const steps = ensureArray(a0?.steps);
    if (steps.length === 0) return;
    const chapterTitle = (d?.name ?? '').trim();
    out.push({
      chapterIndex: typeof a0?.chapterIndex === 'number' ? a0.chapterIndex : idx,
      chapterTitle,
      steps,
    });
  });
  return out;
}

function mergeAnswers2IntoDepartments(baseDepartments: any[], answers2Array: any[]): any[] {
  const depts = ensureArray(baseDepartments).map((d: any) => ({ ...d }));
  const byTitle = new Map<string, any>();
  ensureArray(answers2Array).forEach((entry: any) => {
    const title = (entry?.chapterTitle ?? '').trim();
    if (!title) return;
    byTitle.set(title, entry);
  });

  // 既存部門に注入
  for (let i = 0; i < depts.length; i++) {
    const name = (depts[i]?.name ?? '').trim();
    if (!name) continue;
    const hit = byTitle.get(name);
    if (!hit) continue;
    const steps = ensureArray(hit.steps);
    if (steps.length === 0) continue;
    depts[i] = {
      ...depts[i],
      answers2: [{ chapterIndex: i, chapterTitle: name, steps }],
    };
    byTitle.delete(name);
  }

  // 部門が存在しないが回答だけある → 新規で生やす
  for (const [title, entry] of byTitle.entries()) {
    const steps = ensureArray(entry?.steps);
    if (steps.length === 0) continue;
    depts.push({
      name: title,
      projects: [],
      answers2: [{ chapterIndex: depts.length, chapterTitle: title, steps }],
      finalized: false,
    });
  }

  return depts;
}

/* ============================================================
 * 取得：strategy_data=* + 分離テーブル合流（列存在に依存しない）
 * ========================================================== */
export async function getFullStrategyDataByCompany(companyId: string): Promise<ReadResult> {
  console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
  try {
    if (!isValidUUID(companyId)) {
      console.error('[StrategyData] ❌ invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }

    // strategy_data は * で取得
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

    // 分離テーブルの最新値
    const [ansRes, finRes] = await Promise.allSettled([
      supabase
        .from(T_STORY_ANSWERS)
        .select('answers2, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(T_FINAL_STORIES)
        .select('final_story, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const ansRow =
      ansRes.status === 'fulfilled' && !ansRes.value.error ? ansRes.value.data ?? null : null;
    const finRow =
      finRes.status === 'fulfilled' && !finRes.value.error ? finRes.value.data ?? null : null;

    const state = buildStateFromDbRow(rowData);

    const latestAnswersArray = ensureArray(ansRow?.answers2);   // ← answers2 は配列
    const latestFinal = ensureArray(finRow?.final_story);

    // baseに無ければ分離テーブルの最新値で補完
    // （answers2 は state.answers2 にも入れるが、部門にも突き合わせ注入）
    const stateAnswers2 = ensureArray((state as any).answers2);
    const mergedAnswers2 = stateAnswers2.length ? stateAnswers2 : latestAnswersArray;

    // 部門に注入（chapterTitle = 部門名）
    state.departments = mergeAnswers2IntoDepartments(state.departments ?? [], mergedAnswers2);

    // state.answers2 自体も保持（互換）
    (state as any).answers2 = mergedAnswers2;

    // finalStory 補完
    state.finalStory = ensureArray(state.finalStory).length ? state.finalStory : latestFinal;

    return { data: state, error: null };
  } catch (e) {
    return { data: null, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 保存（空保存抑止＋楽観ロック＋DB現行とのDeepMerge）
 * 変更点：
 *  - payload が空で strategy_data をスキップしても、answers2 は保存する
 *  - strategy_data 保存成功後にも answers2 を確実に保存する
 * ========================================================== */
export async function saveStrategyData(
  ...args: any[]
): Promise<WriteResult> {
  const payload: StrategyData = args[0];
  let userId: string | undefined = args[1];
  let companyIdOverride: string | null | undefined = args[2];
  let revision: number | undefined = args[3];
  let opts: { mode?: 'upsert' | 'updateOnly' } | undefined = args[4];

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

    // 抜き出し: departments[].answers2 → まとめ配列
    const answersBundle = buildAnswers2FromDepartments(payload);

    // --- strategy_data を保存すべきかの判定
    const skipStrategyData = isEffectivelyEmptyForServer(payload);

    // answers2 は strategy_data が空でも保存したい
    if (answersBundle.length > 0) {
      const ares = await saveStoryAnswers2(userId, answersBundle, { companyId: cleanCompanyId });
      if (ares.error) {
        console.warn('[StrategyData] ⚠ answers2 save failed but continue:', ares.error);
      } else {
        console.log('[StrategyData] ✅ answers2 upsert ok:', { count: answersBundle.length });
      }
    }

    if (skipStrategyData) {
      console.warn('[StrategyData] ⛔ strategy_data save skipped: effectively empty payload');
      const cur = await getFullStrategyDataByCompany(cleanCompanyId);
      // 直近の answers2 反映まで含めた最新を返す
      return { data: cur.data ?? null, error: null };
    }

    // strategy_data: 既存行を取得
    let existingRow: any | null = null;
    try {
      const existingRes = await fetchExistingRow(cleanCompanyId);
      existingRow = existingRes.data ?? null;
    } catch (e) {
      return { data: null, error: extractErrorVerbose(e) };
    }

    const existingState: StrategyData & { revision?: number } =
      existingRow ? buildStateFromDbRow(existingRow) : ({} as any);

    const prunedIncoming: StrategyData = pruneUndefinedDeep(payload);
    const mergedState = deepMergePreserveNonEmpty(existingState, prunedIncoming) as StrategyData;

    const baseRow = buildDbRowFromState(mergedState);

    const hasRevision: boolean =
      !!existingRow && Object.prototype.hasOwnProperty.call(existingRow, 'revision');

    const currentRev: number | undefined =
      hasRevision && typeof existingRow?.revision === 'number'
        ? existingRow.revision
        : undefined;

    const currentUpdatedAt: string | undefined =
      typeof existingRow?.updated_at === 'string' ? existingRow.updated_at : undefined;

    const selectAfter = '*';

    // UPDATE
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

      if (hasRevision && typeof expectedRev === 'number') {
        updatePayload.revision = expectedRev + 1;
      }

      let q = supabase
        .from(T_STRATEGY)
        .update(updatePayload)
        .eq('company_id', cleanCompanyId);

      if (hasRevision && typeof expectedRev === 'number') {
        q = q.eq('revision', expectedRev);
      } else if (currentUpdatedAt) {
        q = q.eq('updated_at', currentUpdatedAt);
      }

      const upd = await q.select(selectAfter).single();
      if (upd.error) {
        return { data: null, error: extractErrorVerbose(upd.error) };
      }

      // strategy_data 保存後、answers2 があれば（重ねて）保存（冪等）
      if (answersBundle.length > 0) {
        const ares = await saveStoryAnswers2(userId!, answersBundle, { companyId: cleanCompanyId });
        if (ares.error) console.warn('[StrategyData] ⚠ answers2 post-update save failed:', ares.error);
      }

      const stateAfter = buildStateFromDbRow(upd.data ?? {});
      return { data: stateAfter, error: null };
    }

    // INSERT
    if (opts?.mode === 'updateOnly') {
      console.log('[StrategyData] updateOnly mode → skip insert (no existing row).');
      return { data: null, error: null };
    }

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

    // 挿入後にも answers2 を保存（冪等）
    if (answersBundle.length > 0) {
      const ares = await saveStoryAnswers2(userId!, answersBundle, { companyId: cleanCompanyId });
      if (ares.error) console.warn('[StrategyData] ⚠ answers2 post-insert save failed:', ares.error);
    }

    const stateAfter = buildStateFromDbRow(ins.data ?? {});
    return { data: stateAfter, error: null };
  } catch (error) {
    return { data: null, error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 削除
 * ========================================================== */
export async function deleteStrategyData(userId: string, companyIdOverride?: string | null): Promise<WriteResult> {
  console.log('[StrategyData] 🗑 deleteStrategyData called for', userId, companyIdOverride ?? '(cookie/membership)');
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

    // 子テーブルから先に削除
    const delAns = await supabase.from(T_STORY_ANSWERS).delete().eq('company_id', companyId);
    if (delAns.error && delAns.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ story_answers2 delete warn:', extractErrorVerbose(delAns.error));
    }
    const delFinal = await supabase.from(T_FINAL_STORIES).delete().eq('company_id', companyId);
    if (delFinal.error && delFinal.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ final_stories delete warn:', extractErrorVerbose(delFinal.error));
    }

    const delProg = await supabase.from(T_PROGRESS).delete().eq('company_id', companyId);
    if (delProg.error && delProg.error.code !== 'PGRST116') {
      console.warn('[StrategyData] ⚠ progress_logs delete warn:', extractErrorVerbose(delProg.error));
    }

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
 * レガシーテーブル削除
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
      // 旧互換
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
 *  ※ strategy_id/updated_at が無い環境でも常に成功させる
 * ========================================================== */

/** 手動UPSERT：company_id のみで存在確認 → UPDATE/INSERT */
async function robustUpsertCompanyScoped(
  table: string,
  row: Record<string, any>, // 必須: company_id, user_id, 本体列, 任意: updated_at
) {
  try {
    // 1) 既存行の存在確認（列は company_id のみ）
    const got = await supabase
      .from(table)
      .select('company_id')
      .eq('company_id', row.company_id)
      .limit(1)
      .maybeSingle();

    if (got.error && got.error.code !== 'PGRST116') {
      return { ok: false, error: extractErrorVerbose(got.error) };
    }

    // 2) 存在すれば UPDATE、無ければ INSERT（where は company_id のみ）
    if (got.data) {
      const upd = await supabase
        .from(table)
        .update(row)
        .eq('company_id', row.company_id)
        .select('company_id')
        .maybeSingle();
      if (upd.error) return { ok: false, error: extractErrorVerbose(upd.error) };
      return { ok: true, error: null };
    } else {
      const ins = await supabase
        .from(table)
        .insert(row)
        .select('company_id')
        .maybeSingle();
      if (ins.error) return { ok: false, error: extractErrorVerbose(ins.error) };
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
  opts?: { companyId?: string | null }
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, opts?.companyId ?? null);
    const now = new Date().toISOString();
    const row: any = {
      company_id: companyId,
      user_id: userId,
      final_story: ensureArray(finalStory),
      // updated_at が無いスキーマでも無視されるので安全
      ...(typeof (null as any) === 'object' ? { updated_at: now } : {}),
    };
    const r = await robustUpsertCompanyScoped(T_FINAL_STORIES, row);
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
  opts?: { companyId?: string | null }
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, opts?.companyId ?? null);
    const now = new Date().toISOString();
    const row: any = {
      company_id: companyId,
      user_id: userId,
      answers2: ensureArray(answers2),
      ...(typeof (null as any) === 'object' ? { updated_at: now } : {}),
    };
    const r = await robustUpsertCompanyScoped(T_STORY_ANSWERS, row);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}
