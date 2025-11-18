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
  createdAt?: string; // 指定なければサーバ側で now()
};

/* 🔰 新規追加：戦略全体スナップショット型（今後の「丸ごと保存」用） */
export type FullStrategySnapshot = {
  strategy: (StrategyData & { revision?: number }) | null;
  storyAnswers2: any[];
  finalStory: Array<{ title: string; body: string }> | null;
};

/* ============================================================
 * エラー整形
 * ========================================================== */
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
    try {
      setCompanyIdCookie(override);
    } catch {}
    return override;
  }
  try {
    const byCookie = getCompanyIdFromCookie();
    if (isValidUUID(byCookie)) return byCookie!;
  } catch {}
  const membership = await getMembership(userId);
  const cid = membership?.companyId;
  if (isValidUUID(cid)) {
    try {
      setCompanyIdCookie(cid!);
    } catch {}
    return cid!;
  }
  throw new Error('companyIdを解決できません。Cookieまたはmembershipを確認してください。');
}

/* ============================================================
 * JSONユーティリティ
 * ========================================================== */
function parseJson(v: any) {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
function ensureArray<T = any>(v: any): T[] {
  const p = parseJson(v);
  return Array.isArray(p) ? p : [];
}
function ensureObject<T extends object = Record<string, any>>(v: any): T {
  const p = parseJson(v);
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as T) : ({} as T);
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
  // ★ 先に配列を判定：配列は「そのまま上書き」する
  if (Array.isArray(incoming)) return incoming;

  // それ以外だけ「空なら既存を残す」ロジックを適用
  if (isEmptyLike(incoming)) return target;

  if (typeof incoming !== 'object') return incoming;

  const out: any = { ...(target && typeof target === 'object' ? target : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    const prev = out[k];
    if (Array.isArray(v)) {
      // ★ 子プロパティも配列ならそのまま上書き
      out[k] = v;
    } else if (typeof v === 'object' && v !== null) {
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

function buildStateFromDbRow(row: any): StrategyData & { revision?: number } {
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

  // 部門・プロジェクトを一旦「生」の形で整形（okrsV2 を含む）
  out.departments = out.departments.map((d: any) => ({
    ...d,
    name: d?.name ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      ...p,
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
      // ★ okrsV2 はここでは触らずそのまま保持（...p で保持）
    })),
  }));

  // ★ normalize 前の departments を保持（okrsV2 が入っている生データ）
  const rawDepartmentsWithOkrsV2 = out.departments;

  const normalized = normalizeStrategyData(out) as StrategyData;
  const revision = typeof safeRow?.revision === 'number' ? safeRow.revision : undefined;

  // ★ normalizeStrategyData の過程で消えてしまった okrsV2 を復元する
  if (Array.isArray(rawDepartmentsWithOkrsV2) && Array.isArray((normalized as any).departments)) {
    const mergedDepartments = (normalized as any).departments.map((dept: any, di: number) => {
      const rawDept = rawDepartmentsWithOkrsV2[di] ?? {};
      const rawProjs = ensureArray(rawDept.projects);
      const normProjs = ensureArray(dept.projects);

      const mergedProjs = normProjs.map((proj: any, pi: number) => {
        const rawProj = rawProjs[pi] ?? {};
        const rawOkrsV2 = ensureArray(rawProj.okrsV2);
        if (rawOkrsV2.length === 0) return proj;

        const existingOkrsV2 = ensureArray((proj as any).okrsV2);
        if (existingOkrsV2.length > 0) return proj; // 既にあれば優先

        // ★ ここで DB からの okrsV2 を復元
        return { ...proj, okrsV2: rawOkrsV2 };
      });

      return { ...dept, projects: mergedProjs };
    });

    (normalized as any).departments = mergedDepartments;

    // デバッグ用ログ（必要なければコメントアウト可）
    console.log(
      '[StrategyData] 🧩 restored okrsV2 from DB after normalize:',
      Array.isArray((normalized as any).departments)
        ? (normalized as any).departments.length
        : 'no-field',
    );
  }

  return { ...normalized, revision };
}

/* ============================================================
 * 共通：既存行を * で取得
 * ========================================================== */
async function fetchExistingRow(companyId: string) {
  const res = await supabase.from(T_STRATEGY).select('*').eq('company_id', companyId).maybeSingle();
  if (res.error && res.error.code !== 'PGRST116') {
    throw res.error;
  }
  return res as { data?: any; error?: any };
}

/* ============================================================
 * ★ 誤混入の切り分け用：answers2 を「会社ストーリー用 / 部門用」に分離
 *    分離ルール：chapterTitle が部門名に一致 → 部門用
 * ========================================================== */
function splitAnswers2ByDeptNames(
  answers2: any[],
  deptNames: string[],
): { storyAnswers: any[]; deptAnswers: any[] } {
  const names = new Set(deptNames.map((s) => (s ?? '').trim()).filter(Boolean));
  const storyAnswers: any[] = [];
  const deptAnswers: any[] = [];
  ensureArray(answers2).forEach((entry: any) => {
    const title = (entry?.chapterTitle ?? '').trim();
    const steps = ensureArray(entry?.steps);
    if (steps.length === 0) return;
    if (title && names.has(title)) {
      deptAnswers.push(entry);
    } else {
      storyAnswers.push(entry);
    }
  });
  return { storyAnswers, deptAnswers };
}

/* 部門 answers を部門配列へ注入（マージ） */
function mergeDeptAnswersIntoDepartments(baseDepartments: any[], deptAnswers: any[]): any[] {
  const depts = ensureArray(baseDepartments).map((d: any) => ({ ...d }));
  const byTitle = new Map<string, any>();
  ensureArray(deptAnswers).forEach((entry: any) => {
    const title = (entry?.chapterTitle ?? '').trim();
    if (!title) return;
    byTitle.set(title, entry);
  });

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

  // 存在しない部門名の回答は新規部門として生やす（安全側）
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
 *  ★ 修正点：
 *    - story_answers2 は state.answers2 にのみ反映
 *    - chapterTitle が部門名に一致する分は部門へ分離注入（誤混入のリペア）
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

    const ansRow = ansRes.status === 'fulfilled' && !ansRes.value.error ? ansRes.value.data ?? null : null;
    const finRow = finRes.status === 'fulfilled' && !finRes.value.error ? finRes.value.data ?? null : null;

    const state = buildStateFromDbRow(rowData);

    const latestAnswersArray = ensureArray(ansRow?.answers2); // ← answers2 は配列（会社ストーリー用）
    const latestFinal = ensureArray(finRow?.final_story);

    // ★ 会社ストーリー answers2 と 部門 answers2 を分離（誤混入の自動リペア）
    const deptNames = ensureArray(state.departments).map((d: any) => (d?.name ?? '').trim());
    const { storyAnswers, deptAnswers } = splitAnswers2ByDeptNames(latestAnswersArray, deptNames);

    // ★ state.answers2（会社ストーリー用）を反映（既に state にあればそれを優先）
    const stateAnswers2 = ensureArray((state as any).answers2);
    (state as any).answers2 = stateAnswers2.length ? stateAnswers2 : storyAnswers;

    // ★ 誤って story_answers2 側に入っていた部門分は、部門へ注入（ローカル状態上）
    if (deptAnswers.length > 0) {
      state.departments = mergeDeptAnswersIntoDepartments(state.departments ?? [], deptAnswers);
    }

    // finalStory 補完
    state.finalStory = ensureArray(state.finalStory).length ? state.finalStory : latestFinal;

    return { data: state, error: null };
  } catch (e) {
    return { data: null, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 保存（空保存抑止＋楽観ロック簡略化＋DB現行とのDeepMerge）
 *  ★ 重要修正：
 *    - 部門 answers2 を story_answers2 に保存しない
 *    - company-level の answers2（state.answers2）がある時だけ story_answers2 に保存
 *    - UPDATE は company_id のみ条件にして「必ず1行更新」させる
 *    - ★ departments は payload 側を常に真実として上書き（他の保存トリガーに潰されない）
 *    - ★ 既存行が「ある」場合は、payload が空でも UPDATE 実行（削除反映のため）
 * ========================================================== */
export async function saveStrategyData(...args: any[]): Promise<WriteResult> {
  const payload: StrategyData = args[0];
  let userId: string | undefined = args[1];
  let companyIdOverride: string | null | undefined = args[2];
  let revision: number | undefined = args[3];
  let opts: { mode?: 'upsert' | 'updateOnly' } | undefined = args[4];

  if (args.length === 1) {
    userId = (await getActiveUserId()) ?? undefined;
    opts = { mode: 'upsert' };
  }

  const deptLen = Array.isArray((payload as any).departments)
    ? (payload as any).departments.length
    : 'no-field';

  console.log(
    '[StrategyData] 💾 saveStrategyData called.',
    'userId=',
    userId,
    'rev=',
    revision,
    'opts=',
    opts,
    'departmentsLen=',
    deptLen,
  );

  try {
    if (!userId) {
      return { data: null, error: { status: 401, message: 'no userId (session not found)' } };
    }

    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);
    const cleanCompanyId = companyId.trim();

    // ★ 会社ストーリー用 answers2 のみ抽出
    const storyAnswersBundle = ensureArray((payload as any)?.answers2).filter(
      (x: any) => Array.isArray(x?.steps) && x.steps.length > 0,
    );

    // ★ answers2 は company-level がある時だけ保存（部門用は保存しない）
    if (storyAnswersBundle.length > 0) {
      const ares = await saveStoryAnswers2(userId, storyAnswersBundle, { companyId: cleanCompanyId });
      if (ares.error) {
        console.warn('[StrategyData] ⚠ answers2 save failed but continue:', ares.error);
      } else {
        console.log('[StrategyData] ✅ story answers2 upsert ok:', {
          count: storyAnswersBundle.length,
        });
      }
    }

    // ===== ここで既存行を取得してから「空スキップ」を判定する =====
    let existingRow: any | null = null;
    try {
      const existingRes = await fetchExistingRow(cleanCompanyId);
      existingRow = existingRes.data ?? null;
    } catch (e) {
      return { data: null, error: extractErrorVerbose(e) };
    }

    const existingState: StrategyData & { revision?: number } =
      existingRow ? buildStateFromDbRow(existingRow) : ({} as any);

    // ★ 既存行が無い場合だけ「実質空なら保存スキップ」する
    const skipStrategyData = !existingRow && isEffectivelyEmptyForServer(payload);

    if (skipStrategyData) {
      console.warn(
        '[StrategyData] ⛔ strategy_data save skipped: effectively empty payload (no existing row)',
      );
      const cur = await getFullStrategyDataByCompany(cleanCompanyId);
      return { data: cur.data ?? null, error: null };
    }

    const prunedIncoming: StrategyData = pruneUndefinedDeep(payload);

    // まずは汎用 DeepMerge
    let mergedState = deepMergePreserveNonEmpty(existingState, prunedIncoming) as StrategyData;

    // ★ departments だけは「payload 側を常に真実」として上書きする
    if (Array.isArray((payload as any).departments)) {
      const incomingDeps = ensureArray((payload as any).departments);
      mergedState = {
        ...(mergedState as any),
        departments: incomingDeps,
      } as StrategyData;

      console.log(
        '[StrategyData] 💾 saveStrategyData departments override:',
        'incomingLen=',
        incomingDeps.length,
      );
    }

    const baseRow = buildDbRowFromState(mergedState);

    const hasRevision: boolean =
      !!existingRow && Object.prototype.hasOwnProperty.call(existingRow, 'revision');

    const currentRev: number | undefined =
      hasRevision && typeof existingRow?.revision === 'number' ? existingRow.revision : undefined;

    const selectAfter = '*';

    // ===============================
    // UPDATE（company_id のみで条件付け）
    // ===============================
    if (existingRow) {
      const updatePayload: any = {
        ...baseRow,
        user_id: userId,
        company_id: cleanCompanyId,
        updated_at: now,
      };

      // revision カラムがある場合は単純インクリメント（厳密ロックはしない）
      if (hasRevision) {
        const nextRev = typeof currentRev === 'number' ? currentRev + 1 : 1;
        updatePayload.revision = nextRev;
      }

      const upd = await supabase
        .from(T_STRATEGY)
        .update(updatePayload)
        .eq('company_id', cleanCompanyId)
        .select(selectAfter)
        .single();

      if (upd.error) {
        console.error('[StrategyData] ❌ update failed:', extractErrorVerbose(upd.error));
        return { data: null, error: extractErrorVerbose(upd.error) };
      }

      // ★ strategy_data 保存後、「会社ストーリー answers2」がある時だけ重ねて保存（冪等）
      if (storyAnswersBundle.length > 0) {
        const ares = await saveStoryAnswers2(userId!, storyAnswersBundle, { companyId: cleanCompanyId });
        if (ares.error) console.warn('[StrategyData] ⚠ answers2 post-update save failed:', ares.error);
      }

      const stateAfter = buildStateFromDbRow(upd.data ?? {});
      console.log(
        '[StrategyData] ✅ strategy_data update ok:',
        'departmentsLen=',
        Array.isArray((stateAfter as any).departments)
          ? (stateAfter as any).departments.length
          : 'no-field',
      );
      return { data: stateAfter, error: null };
    }

    // ===============================
    // INSERT（まだ行が無い場合）
    // ===============================
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

    // ★ 挿入後にも「会社ストーリー answers2」がある時だけ保存（冪等）
    if (storyAnswersBundle.length > 0) {
      const ares = await saveStoryAnswers2(userId!, storyAnswersBundle, { companyId: cleanCompanyId });
      if (ares.error) console.warn('[StrategyData] ⚠ answers2 post-insert save failed:', ares.error);
    }

    const stateAfter = buildStateFromDbRow(ins.data ?? {});
    console.log(
      '[StrategyData] ✅ strategy_data insert ok:',
      'departmentsLen=',
      Array.isArray((stateAfter as any).departments)
        ? (stateAfter as any).departments.length
        : 'no-field',
    );
    return { data: stateAfter, error: null };
  } catch (error) {
    return { data: null, error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 削除
 * ========================================================== */
export async function deleteStrategyData(
  userId: string,
  companyIdOverride?: string | null,
): Promise<WriteResult> {
  console.log(
    '[StrategyData] 🗑 deleteStrategyData called for',
    userId,
    companyIdOverride ?? '(cookie/membership)',
  );
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
  const tablesInOrder = [T_PROGRESS, T_STORY_ANSWERS, T_FINAL_STORIES, ...T_LEGACY, T_STRATEGY];

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
      typeof rev === 'number' ? rev : undefined,
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
export async function saveProgressLog(
  input: ProgressLogInput,
): Promise<{ data: any | null; error: any | null }> {
  try {
    const {
      userId,
      okrId,
      projectId = null, // 現在の progress_logs に project_id カラムが無いなら未使用
      departmentId = null,
      companyIdOverride = null,
      content,
      status = null,
      score = null,
      createdAt,
    } = input;

    const companyId = await resolveCompanyId(userId, companyIdOverride);

    const row: Record<string, any> = {
      user_id: userId,
      company_id: companyId,
      okr_id: okrId,
      // ⚠ Supabaseの progress_logs に project_id カラムがある場合のみ有効化
      // project_id: projectId,
      // ✅ DB のカラム名に合わせる（department_id ではなく department）
      department: departmentId,
      content,
      status,
      score,
      ...(createdAt ? { created_at: createdAt } : {}),
    };

    const { data, error } = await supabase.from(T_PROGRESS).insert(row).select('*').single();

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
  opts?: { companyId?: string | null },
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

/** 質問回答（会社ストーリー answers2）を story_answers2 に永続化（company_id一意） */
export async function saveStoryAnswers2(
  userId: string,
  answers2: any[],
  opts?: { companyId?: string | null },
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

/* ============================================================
 * ★ワンショット修復用ユーティリティ（任意）
 *   story_answers2 に誤混入した部門 answers2 を strategy_data.departments に移し、
 *   story_answers2 には会社ストーリー分だけを残す。
 *   ※ 必要なときだけ呼び出してください（UIからは呼ばない運用でOK）
 * ========================================================== */
export async function repairMisfiledAnswers2(userId: string, companyIdOverride?: string | null) {
  const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

  // 1) 現状をロード（内部で自動分離してくれる）
  const cur = await getFullStrategyDataByCompany(companyId);
  if (cur.error || !cur.data) return { ok: false, error: cur.error ?? 'no data' };

  const state = cur.data;
  const storyAnswers = ensureArray((state as any).answers2);

  // 再度厳密に分離
  const deptNames = ensureArray(state.departments).map((d: any) => (d?.name ?? '').trim());
  const split = splitAnswers2ByDeptNames(storyAnswers, deptNames);

  // 2) 部門へ注入した状態を strategy_data に保存
  const mergedDepartments = mergeDeptAnswersIntoDepartments(state.departments, split.deptAnswers);
  const nextState: StrategyData = { ...(state as any), departments: mergedDepartments };
  const rev = (state as any)?.revision;

  const saved = await saveStrategyData(
    nextState,
    userId,
    companyId,
    typeof rev === 'number' ? rev : undefined,
  );
  if (saved.error) return { ok: false, error: saved.error };

  // 3) 会社ストーリーだけを story_answers2 に再保存
  const ares = await saveStoryAnswers2(userId, split.storyAnswers, { companyId });
  if (ares.error) return { ok: false, error: ares.error };

  return { ok: true };
}

/* ============================================================
 * 🔰 新規追加：戦略全体スナップショット I/O（まだどこからも呼ばれていない安全なユーティリティ）
 *   - getFullStrategySnapshot: strategy_data + story_answers2 + final_stories をまとめて取得
 *   - saveFullStrategySnapshot: 既存の save* 系を順に呼ぶだけのラッパー
 * ========================================================== */

/** companyスコープの戦略全体スナップショット取得 */
export async function getFullStrategySnapshot(
  userId: string,
  companyIdOverride: string | null = null,
): Promise<{ snapshot: FullStrategySnapshot | null; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);

    // strategy_data（1行）取得
    let strategy: (StrategyData & { revision?: number }) | null = null;
    try {
      const existing = await fetchExistingRow(companyId);
      if (existing.error && existing.error.code !== 'PGRST116') {
        return { snapshot: null, error: extractErrorVerbose(existing.error) };
      }
      strategy = existing.data ? buildStateFromDbRow(existing.data) : null;
    } catch (e) {
      return { snapshot: null, error: extractErrorVerbose(e) };
    }

    // story_answers2 / final_stories 取得（最新1件）
    const [ansRes, finRes] = await Promise.all([
      supabase
        .from(T_STORY_ANSWERS)
        .select('answers2')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(T_FINAL_STORIES)
        .select('final_story')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (ansRes.error && ansRes.error.code !== 'PGRST116') {
      return { snapshot: null, error: extractErrorVerbose(ansRes.error) };
    }
    if (finRes.error && finRes.error.code !== 'PGRST116') {
      return { snapshot: null, error: extractErrorVerbose(finRes.error) };
    }

    const storyAnswers2 = ensureArray(ansRes.data?.answers2);
    const finalStoryRaw = ensureArray(finRes.data?.final_story) as Array<{ title: string; body: string }>;

    const snapshot: FullStrategySnapshot = {
      strategy,
      storyAnswers2,
      finalStory: finalStoryRaw.length ? finalStoryRaw : null,
    };

    return { snapshot, error: null };
  } catch (e) {
    return { snapshot: null, error: extractErrorVerbose(e) };
  }
}

/** 戦略全体スナップショットの保存ラッパー（挙動は既存APIをそのまま利用） */
export async function saveFullStrategySnapshot(
  userId: string,
  snapshot: FullStrategySnapshot,
  companyIdOverride: string | null = null,
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);

    // 1) strategy_data（本体）を保存（あれば）
    if (snapshot.strategy) {
      const { revision, ...rest } = snapshot.strategy as StrategyData & { revision?: number };
      const rev = typeof snapshot.strategy.revision === 'number' ? snapshot.strategy.revision : undefined;
      const saved = await saveStrategyData(rest as StrategyData, userId, companyId, rev);
      if (saved.error) {
        return { ok: false, error: saved.error };
      }
    }

    // 2) story_answers2 を保存（あれば）
    if (snapshot.storyAnswers2 && snapshot.storyAnswers2.length > 0) {
      const ares = await saveStoryAnswers2(userId, snapshot.storyAnswers2, { companyId });
      if (!ares.ok) {
        return { ok: false, error: ares.error };
      }
    }

    // 3) final_stories を保存（あれば）
    if (snapshot.finalStory && snapshot.finalStory.length > 0) {
      const fres = await saveFinalStory(userId, snapshot.finalStory, { companyId });
      if (!fres.ok) {
        return { ok: false, error: fres.error };
      }
    }

    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}
