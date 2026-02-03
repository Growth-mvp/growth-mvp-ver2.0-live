// /utils/supabase/strategy.ts
import {
  supabase,
  isValidUUID,
  getCompanyIdFromCookie,
  setCompanyIdCookie,
} from './client';
import { debugExtractPostgrest } from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/* ============================================================
 * テーブル名
 * ========================================================== */
const T_STRATEGY = 'strategy_data';
const T_PROGRESS = 'progress_logs';
const T_STORY_ANSWERS = 'story_answers2';
const T_FINAL_STORIES = 'final_stories';

// レガシー分離テーブル（移行後は原則読み書きしない／掃除対象）
const T_LEGACY = [
  'simulationresults',
  'simulationresult',
  'financesummary',
  'business_portfolio',
] as const;

/* ============================================================
 * 型
 * ========================================================== */
type ReadResult = {
  data: (StrategyData & { revision?: number }) | null;
  error: any | null;
};
type WriteResult = {
  data?: (StrategyData & { revision?: number }) | null;
  error: any | null;
};

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

async function resolveCompanyId(
  userId: string,
  override?: string | null,
): Promise<string> {
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
  throw new Error(
    'companyIdを解決できません。Cookieまたはmembershipを確認してください。',
  );
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
    return input
      .map((v) => pruneUndefinedDeep(v))
      .filter((v) => v !== undefined) as T;
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

/* Deep Merge（incoming優先。ただし incoming が"空"なら既存を保持） */
function deepMergePreserveNonEmpty(target: any, incoming: any): any {
  // ★ 先に配列を判定：配列は「そのまま上書き」する
  if (Array.isArray(incoming)) return incoming;

  // それ以外だけ「空なら既存を残す」ロジックを適用
  if (isEmptyLike(incoming)) return target;

  if (typeof incoming !== 'object') return incoming;

  const out: any = {
    ...(target && typeof target === 'object' ? target : {}),
  };
  for (const [k, v] of Object.entries(incoming)) {
    const prev = out[k];
    if (Array.isArray(v)) {
      // ★ 子プロパティも配列ならそのまま上書き
      out[k] = v;
    } else if (typeof v === 'object' && v !== null) {
      // ★ 特別扱い：segmentPL / segmentBS は「部分マージ」（複数キーを保持）
      if ((k === 'segmentPL' || k === 'segmentBS') && typeof prev === 'object') {
        out[k] = { ...prev, ...v };
      } else {
        out[k] = deepMergePreserveNonEmpty(prev, v);
      }
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
 * csv_finance_data 多重ネスト修正（恒久化）
 * ========================================================== */
function unwrapCsvFinanceData(value: any): Record<string, any> {
  let current = value;
  let maxIterations = 100; // 無限ループ防止

  while (maxIterations-- > 0) {
    // null/undefined はスキップ
    if (current === null || current === undefined) {
      return {};
    }

    // primitive型はスキップ
    if (typeof current !== 'object') {
      return {};
    }

    // Array の場合、length === 1 なら [0] を取る
    if (Array.isArray(current)) {
      if (current.length === 1) {
        current = current[0];
        continue;
      }
      // length !== 1 なら配列は financeBS として返す
      // （他の配列フィールドの場合）
      return {};
    }

    // オブジェクトの場合、「数値キーのみが1つだけ」か確認
    const keys = Object.keys(current);
    if (keys.length === 1) {
      const key = keys[0];
      // 数値キー（文字列の "0", "1" 等）の場合
      if (/^\d+$/.test(key)) {
        current = current[key];
        continue;
      }
    }

    // unwrap する必要がない場合
    break;
  }

  // 最終的なオブジェクトを返す
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    return current as Record<string, any>;
  }

  return {};
}

/* ============================================================
 * business_portfolio 安全化
 * ========================================================== */
function toDbBusinessPortfolio(uiValue: any): Record<string, any> {
  if (uiValue == null) return {};
  const parsed = parseJson(uiValue);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, any>;
  }
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
  ceoIntent: 'ceo_intent',
  storyDraft: 'story_draft',  // ★ 追加：たたき台ストーリーを保存対象に
  swotSuggestions: 'swot_suggestions',
  mission: 'mission',
  vision: 'vision',
  value: 'value',
  thought: 'thought',
  email: 'email',
  role: 'role',
  departments: 'departments',
  csvFinanceData: 'csv_finance_data',
  financePL: 'finance_pl',
  businessSegments: 'business_segments',
  stage1Issues: 'stage1_issues',  // ★ 修正：stage1Issues をマッピングに追加
  isListed: 'is_listed',  // ★ 修正：上場フラグを追加
  ticker: 'ticker',  // ★ 修正：証券コードを追加
  pbrManual: 'pbr_manual',  // ★ 修正：PBR手入力を追加
  story: 'story',
  finalStory: 'final_story',
  strategySummary: 'strategy_summary',
  editableCascade: 'editable_cascade',
  businessPortfolio: 'business_portfolio',
  financeSummary: 'finance_summary',
  simulationResults: 'simulation_results',
};

/* ============================================================
 * "実質空"判定（空保存ガード）
 * ========================================================== */
function isEffectivelyEmptyForServer(state: Partial<StrategyData>): boolean {
  const arrEmpty = (a: any) => !Array.isArray(a) || a.length === 0;
  const strEmpty = (v: any) => typeof v !== 'string' || v.trim() === '';

  const sim = (state as any)?.simulationResult;
  const simPoints = (sim as any)?.projection?.points;

  // ★ 修正：stage1Issues がある場合は empty でない
  if (!arrEmpty((state as any).stage1Issues)) {
    return false;
  }

  return (
    arrEmpty((state as any).story) &&
    arrEmpty((state as any).departments) &&
    arrEmpty((state as any).csvFinanceData) &&
    arrEmpty((state as any).financeSummary) &&
    (!(state as any).businessPortfolio ||
      arrEmpty(((state as any).businessPortfolio as any)?.units)) &&
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
    if (snake === 'story_draft') v = ensureArray(v);  // ★ 追加：storyDraft は配列
    if (snake === 'final_story') v = ensureArray(v);
    if (snake === 'departments') v = ensureArray(v);
    if (snake === 'simulation_results') v = ensureArray(v);
    if (snake === 'stage1_issues') v = ensureArray(v);  // ★ 修正：stage1_issues は配列
    // ★ 修正：csv_finance_data はオブジェクト（financeBS/segmentPL/segmentBS を格納）
    if (snake === 'csv_finance_data') {
      // オブジェクトのまま保持（配列に変換しない）
      v = (typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }
    if (snake === 'finance_pl') v = toDbJsonArray(v);
    if (snake === 'business_segments') v = toDbJsonArray(v);
    if (snake === 'finance_summary') v = toDbFinanceSummary(v);
    if (snake === 'business_portfolio') v = toDbBusinessPortfolio(v);
    if (snake === 'swot_suggestions') {
      // swotSuggestions は object のまま保持
      v = (typeof v === 'object' && !Array.isArray(v)) ? v : null;
    }
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

  // ★ TASK 9-2: ceoIntent 復元を優先化（snake_case を最優先）
  out.ceoIntent = safeRow?.ceo_intent ?? out.ceoIntent ?? '';

  out.story = ensureArray(out.story);
  out.storyDraft = ensureArray(out.storyDraft);  // ★ 追加：storyDraft を復元
  out.finalStory = ensureArray(out.finalStory);
  out.departments = ensureArray(out.departments);
  out.simulationResults = ensureArray(out.simulationResults);
  out.stage1Issues = ensureArray(out.stage1Issues);  // ★ 修正：stage1Issues を復元
  out.financePL = ensureArray(out.financePL);
  out.businessSegments = ensureArray(out.businessSegments);
  out.financeSummary = toUiFinanceSummary(out.financeSummary);
  out.businessPortfolio = toUiBusinessPortfolio(out.businessPortfolio);

  // swotSuggestions is object - restore as-is if present
  if (out.swotSuggestions && typeof out.swotSuggestions === 'object' && !Array.isArray(out.swotSuggestions)) {
    // Already in the right format
  } else {
    out.swotSuggestions = undefined;
  }

  // ★ 診断ログ：buildStateFromDbRow での stage1Issues 復元状況
  if (DEBUG && (Array.isArray(out.stage1Issues) && out.stage1Issues.length > 0)) {
    console.log('[buildStateFromDbRow] stage1Issues restored from DB:', {
      length: out.stage1Issues.length,
      titles: out.stage1Issues.map((i: any) => i.title),
    });
  }

  // ★ 修正：csv_finance_data から financeBS/segmentPL/segmentBS/hqAdjustmentPL/BS を復元
  // DB には finance_bs/segment_bs/segment_pl 列がないため、csv_finance_data に格納されている
  // ★ 多重ネスト {"0":{"0":{...}}} を展開する
  const csvFinanceData = unwrapCsvFinanceData(out.csvFinanceData || safeRow?.csv_finance_data || {});

  // ★ DEBUG：raw 復元後の確認（プリミティブ値のみ）
  const issueBlocksLen = Array.isArray(out.stage1Issues) ? out.stage1Issues.length : 0;
  const csvFdExists = !!out.csvFinanceData;
  const csvFdFinanceBSLen = Array.isArray(csvFinanceData.financeBS) ? csvFinanceData.financeBS.length : 0;
  const csvFdSegmentPLKeys = Object.keys(csvFinanceData.segmentPL || {}).length;
  const csvFdSegmentBSKeys = Object.keys(csvFinanceData.segmentBS || {}).length;
  const financePLLen = Array.isArray(out.financePL) ? out.financePL.length : 0;
  if (DEBUG) console.log('[buildStateFromDbRow] raw_復元 issueBlocks:' + issueBlocksLen + ' csvFd:' + csvFdExists + ' financeBS:' + csvFdFinanceBSLen + ' segmentPL:' + csvFdSegmentPLKeys + ' segmentBS:' + csvFdSegmentBSKeys + ' financePL:' + financePLLen);

  out.financeBS = ensureArray(csvFinanceData.financeBS);
  out.segmentPL = csvFinanceData.segmentPL; // Record<string, FinancePLRow[]>
  out.segmentBS = csvFinanceData.segmentBS; // Record<string, SegmentBSRow[]>
  out.hqAdjustmentPL = ensureArray(csvFinanceData.hqAdjustmentPL);
  out.hqAdjustmentBS = ensureArray(csvFinanceData.hqAdjustmentBS);

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

  // ★ 修正：raw の csvFinanceData/segmentPL/segmentBS を保持（normalize で落ちるため）
  const rawCsvFinanceData = out.csvFinanceData;
  const rawSegmentPL = out.segmentPL;
  const rawSegmentBS = out.segmentBS;

  // ★ DEBUG：normalize 前（プリミティブ値のみ）
  const outCsvFdExists = !!out.csvFinanceData;
  const outSegmentPLKeys = Object.keys(out.segmentPL || {}).length;
  const outSegmentBSKeys = Object.keys(out.segmentBS || {}).length;
  if (DEBUG) console.log('[buildStateFromDbRow] norm前 csvFd:' + outCsvFdExists + ' segmentPL:' + outSegmentPLKeys + ' segmentBS:' + outSegmentBSKeys);

  const normalized = normalizeStrategyData(out) as StrategyData;

  // ★ DEBUG：normalize 後（プリミティブ値のみ）
  const normCsvFdExists = !!(normalized as any).csvFinanceData;
  const normSegmentPLExists = !!(normalized as any).segmentPL;
  const normSegmentBSExists = !!(normalized as any).segmentBS;
  if (DEBUG) console.log('[buildStateFromDbRow] norm後 csvFd:' + normCsvFdExists + ' segmentPL:' + normSegmentPLExists + ' segmentBS:' + normSegmentBSExists);

  // revision（FIELD_MAPに含めない）
  const revision =
    typeof safeRow?.revision === 'number' ? safeRow.revision : undefined;

  // ★ normalizeStrategyData の過程で消えてしまった okrsV2 を復元する
  //    ※ 現状は配列indexで復元（将来的にはIDベース推奨）
  if (
    Array.isArray(rawDepartmentsWithOkrsV2) &&
    Array.isArray((normalized as any).departments)
  ) {
    const mergedDepartments = (normalized as any).departments.map(
      (dept: any, di: number) => {
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
      },
    );

    (normalized as any).departments = mergedDepartments;

    if (DEBUG) console.log(
      '[StrategyData] 🧩 restored okrsV2 from DB after normalize:',
      Array.isArray((normalized as any).departments)
        ? (normalized as any).departments.length
        : 'no-field',
    );
  }

  // ★ 修正：normalizeStrategyData で消えた csvFinanceData/segmentPL/segmentBS を復元
  // normalize では配列型のみを認識するため、Record型のsegmentPL/segmentBSが失われる
  // プリミティブ値のみでログ出力
  let restoredCsvFd = false;
  let restoredSegmentPL = false;
  let restoredSegmentBS = false;

  if (rawCsvFinanceData && !(normalized as any).csvFinanceData) {
    (normalized as any).csvFinanceData = rawCsvFinanceData;
    restoredCsvFd = true;
  }
  if (rawSegmentPL && !(normalized as any).segmentPL) {
    (normalized as any).segmentPL = rawSegmentPL;
    restoredSegmentPL = true;
  }
  if (rawSegmentBS && !(normalized as any).segmentBS) {
    (normalized as any).segmentBS = rawSegmentBS;
    restoredSegmentBS = true;
  }

  if (restoredCsvFd || restoredSegmentPL || restoredSegmentBS) {
    if (DEBUG) console.log('[buildStateFromDbRow] restored csvFd:' + restoredCsvFd + ' segmentPL:' + restoredSegmentPL + ' segmentBS:' + restoredSegmentBS);
  }

  // ==========================================================
  // ★ 重要：strategyId/companyId/updatedAt を復元（storeの整合性維持）
  // ==========================================================
  const strategyId = typeof safeRow?.id === 'string' ? safeRow.id : undefined;
  const companyId = typeof safeRow?.company_id === 'string' ? safeRow.company_id : undefined;
  const updatedAt = safeRow?.updated_at ?? undefined;

  (normalized as any).strategyId = strategyId;
  (normalized as any).companyId = companyId;
  (normalized as any).updatedAt = updatedAt;

  return { ...(normalized as any), revision };
}

/* ============================================================
 * 共通：既存行を取得
 *  - revision を確実に含めるため select('*') はそのまま（列があれば返る）
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
 * ★ 誤混入の切り分け用：answers2 を「会社ストーリー用 / 部門用」に分離
 * ========================================================== */
function splitAnswers2ByDeptNames(
  answers2: any[],
  deptNames: string[],
): { storyAnswers: any[]; deptAnswers: any[] } {
  const names = new Set(
    deptNames.map((s) => (s ?? '').trim()).filter(Boolean),
  );
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

/* 部門 answers を部門配列へ注入（マージ）
 * ★ 重要：存在しない部門は「生やさない」（削除復活の温床になるため）
 */
function mergeDeptAnswersIntoDepartments(
  baseDepartments: any[],
  deptAnswers: any[],
): any[] {
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

  // ★ orphan（現departmentsに存在しない部門名）は無視（ログのみ）
  for (const [title] of byTitle.entries()) {
    console.warn(
      '[StrategyData] ⚠ orphan deptAnswers ignored (no matching department):',
      title,
    );
  }

  return depts;
}

/* ============================================================
 * 取得：strategy_data=* + 分離テーブル合流（列存在に依存しない）
 * ========================================================== */
export async function getFullStrategyDataByCompany(
  companyId: string,
): Promise<ReadResult> {
  if (DEBUG) console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
  try {
    if (!isValidUUID(companyId)) {
      console.error('[StrategyData] ❌ invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }

    const baseRes = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // ★ C) 包括的なクエリ結果ログ（RLS/権限/0行を区別する）
    if (DEBUG) console.log('[StrategyData] 📊 query result (baseRes)', {
      hasData: !!baseRes.data,
      hasError: !!baseRes.error,
      errorCode: baseRes.error?.code,
      errorStatus: (baseRes.error as any)?.status,
      errorMessage: baseRes.error?.message,
      rowsCount: baseRes.data ? 1 : 0,
      data_id: baseRes.data?.id,
      data_company_id: baseRes.data?.company_id,
      data_revision: baseRes.data?.revision,
    });

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
      ansRes.status === 'fulfilled' && !ansRes.value.error
        ? ansRes.value.data ?? null
        : null;
    const finRow =
      finRes.status === 'fulfilled' && !finRes.value.error
        ? finRes.value.data ?? null
        : null;

    // ★ 修正：csv_finance_data から財務系フィールド確認
    // finance_pl は finance_pl 列、financeBS/segmentPL/segmentBS は csv_finance_data に格納
    const csvData = rowData?.csv_finance_data ?? {};
    const financePl = rowData?.finance_pl;
    // ★ プリミティブ値のみを計算してログ出力
    const rawFinanceBSLen = Array.isArray((csvData as any).financeBS) ? (csvData as any).financeBS.length : 0;
    const rawSegmentBSKeys = Object.keys((csvData as any).segmentBS || {}).length;
    const rawSegmentPLKeys = Object.keys((csvData as any).segmentPL || {}).length;
    const rawFinancePLLen = Array.isArray((financePl as any)) ? (financePl as any).length : 0;
    if (DEBUG) console.log('[LOAD raw financial data] financePL_len:' + rawFinancePLLen + ' financeBS_len:' + rawFinanceBSLen + ' segmentPL_keys:' + rawSegmentPLKeys + ' segmentBS_keys:' + rawSegmentBSKeys);

    const state = buildStateFromDbRow(rowData);

    // ★ TASK 9-4: 復元直後の監査ログ（DEV限定）
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      console.log('[audit][restore:field_check]', {
        ceoIntentLen: typeof (state as any).ceoIntent === 'string' ? (state as any).ceoIntent.length : 0,
        ceoIntentPreview: typeof (state as any).ceoIntent === 'string' ? (state as any).ceoIntent.substring(0, 50) : 'N/A',
        storyDraftLen: Array.isArray((state as any).storyDraft) ? (state as any).storyDraft.length : 0,
        hasDbCeoIntent: typeof rowData?.ceo_intent === 'string' ? rowData.ceo_intent.length : 0,
      });
    }

    // ★念押し：id/company_id/updated_at を state に注入（normalizeで落ちる事故を防ぐ）
    (state as any).strategyId = rowData?.id;
    (state as any).companyId = rowData?.company_id;
    (state as any).updatedAt = rowData?.updated_at;

    const latestAnswersArray = ensureArray(ansRow?.answers2);
    const latestFinal = ensureArray(finRow?.final_story);

    // ★ 会社ストーリー answers2 と 部門 answers2 を分離（誤混入の自動リペア）
    const deptNames = ensureArray(state.departments).map((d: any) =>
      (d?.name ?? '').trim(),
    );
    const { storyAnswers, deptAnswers } = splitAnswers2ByDeptNames(
      latestAnswersArray,
      deptNames,
    );

    // ★ state.answers2（会社ストーリー用）を反映（既に state にあればそれを優先）
    const stateAnswers2 = ensureArray((state as any).answers2);
    (state as any).answers2 = stateAnswers2.length ? stateAnswers2 : storyAnswers;

    // ★ 誤って story_answers2 側に入っていた部門分は、部門へ注入（ローカル状態上）
    //    ※ orphan部門は生やさない（削除復活を防止）
    if (deptAnswers.length > 0) {
      state.departments = mergeDeptAnswersIntoDepartments(
        state.departments ?? [],
        deptAnswers,
      );
    }

    // finalStory 補完（strategy_data.final_story 優先、無ければ分離テーブル）
    state.finalStory = ensureArray(state.finalStory).length ? state.finalStory : latestFinal;

    // ★ デバッグ：buildStateFromDbRow 後の normalized データの財務系フィールド確認
    // プリミティブ値のみを出力
    const normalizedFinanceBSLen = Array.isArray((state as any).financeBS) ? (state as any).financeBS.length : 0;
    const normalizedSegmentBSKeys = Object.keys((state as any).segmentBS || {}).length;
    const normalizedSegmentPLKeys = Object.keys((state as any).segmentPL || {}).length;
    const normalizedFinancePLLen = Array.isArray((state as any).financePL) ? (state as any).financePL.length : 0;
    const normalizedIssueBlocksLen = Array.isArray((state as any).stage1Issues) ? (state as any).stage1Issues.length : 0;
    const normalizedCsvFinanceDataExists = !!(state as any).csvFinanceData;
    if (DEBUG) console.log('[LOAD normalized] financePL_len:' + normalizedFinancePLLen + ' financeBS_len:' + normalizedFinanceBSLen + ' segmentPL_keys:' + normalizedSegmentPLKeys + ' segmentBS_keys:' + normalizedSegmentBSKeys + ' issueBlocks_len:' + normalizedIssueBlocksLen + ' csvFinanceData_exists:' + normalizedCsvFinanceDataExists);

    return { data: state, error: null };
  } catch (e) {
    return { data: null, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * 保存（空保存抑止＋楽観ロック簡略化＋DB現行とのDeepMerge）
 *
 * ★重要：revision について
 * - revision の増分は DB の trg_bump_strategy_data_revision に任せる
 * - saveStrategyData は WHERE 条件 (company_id + revision) で衝突検知する
 * - payload に revision を書き込まない（トリガと二重になるのを防ぐ）
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

  if (DEBUG) console.log(
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

  // ★ デバッグ：payload 作成直後（pruneUndefinedDeep 前）
  if (DEBUG) console.log('[SAVE payload raw]', {
    financeBS_len: Array.isArray((payload as any).financeBS) ? (payload as any).financeBS.length : null,
    segmentBS_keys: Object.keys((payload as any).segmentBS || {}).length,
    segmentPL_keys: Object.keys((payload as any).segmentPL || {}).length,
    financePL_len: Array.isArray((payload as any).financePL) ? (payload as any).financePL.length : null,
    stage1Issues_len: Array.isArray((payload as any).stage1Issues) ? (payload as any).stage1Issues.length : null,
    csvFinanceData_exists: !!((payload as any).csvFinanceData),
    keys: Object.keys(payload || {}).slice(0, 80),
  });

  try {
    if (!userId) {
      return {
        data: null,
        error: { status: 401, message: 'no userId (session not found)' },
      };
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
      const ares = await saveStoryAnswers2(userId, storyAnswersBundle, {
        companyId: cleanCompanyId,
      });
      if (ares.error) {
        console.warn(
          '[StrategyData] ⚠ answers2 save failed but continue:',
          ares.error,
        );
      } else {
        if (DEBUG) console.log('[StrategyData] ✅ story answers2 upsert ok:', {
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

    const existingState: StrategyData & { revision?: number } = existingRow
      ? buildStateFromDbRow(existingRow)
      : ({} as any);

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

    // ★ デバッグ：prunedIncoming 作成後（pruneUndefinedDeep の後）
    if (DEBUG) console.log('[SAVE payload pruned]', {
      financeBS_len: Array.isArray((prunedIncoming as any).financeBS) ? (prunedIncoming as any).financeBS.length : null,
      segmentBS_keys: Object.keys((prunedIncoming as any).segmentBS || {}).length,
      segmentPL_keys: Object.keys((prunedIncoming as any).segmentPL || {}).length,
      financePL_len: Array.isArray((prunedIncoming as any).financePL) ? (prunedIncoming as any).financePL.length : null,
      stage1Issues_len: Array.isArray((prunedIncoming as any).stage1Issues) ? (prunedIncoming as any).stage1Issues.length : null,
      csvFinanceData_exists: !!((prunedIncoming as any).csvFinanceData),
      keys: Object.keys(prunedIncoming || {}).slice(0, 80),
    });

    // まずは汎用 DeepMerge
    let mergedState = deepMergePreserveNonEmpty(
      existingState,
      prunedIncoming,
    ) as StrategyData;

    // ★ デバッグ：deepMerge 後（mergedState の内容確認）
    if (DEBUG) console.log('[SAVE merged]', {
      financeBS_len: Array.isArray((mergedState as any).financeBS) ? (mergedState as any).financeBS.length : null,
      segmentBS_keys: Object.keys((mergedState as any).segmentBS || {}).length,
      segmentPL_keys: Object.keys((mergedState as any).segmentPL || {}).length,
      financePL_len: Array.isArray((mergedState as any).financePL) ? (mergedState as any).financePL.length : null,
      stage1Issues_len: Array.isArray((mergedState as any).stage1Issues) ? (mergedState as any).stage1Issues.length : null,
      segmentPL_detail: Object.entries((mergedState as any).segmentPL || {}).map(([k, v]: any) => ({ key: k, rowCount: Array.isArray(v) ? v.length : 0 })),
    });

    // ★ departments だけは「payload 側を常に真実」として上書きする
    if (Array.isArray((payload as any).departments)) {
      const incomingDeps = ensureArray((payload as any).departments);
      mergedState = {
        ...(mergedState as any),
        departments: incomingDeps,
      } as StrategyData;

      if (DEBUG) console.log(
        '[StrategyData] 💾 saveStrategyData departments override:',
        'incomingLen=',
        incomingDeps.length,
      );
    }

    const baseRow = buildDbRowFromState(mergedState);

    const hasRevision: boolean =
      !!existingRow && Object.prototype.hasOwnProperty.call(existingRow, 'revision');

    const currentRev: number | undefined =
      hasRevision && typeof existingRow?.revision === 'number'
        ? existingRow.revision
        : undefined;

    // ===============================
    // UPDATE（company_id + 楽観ロック：revision）
    // ===============================
    if (existingRow) {
      // ★ 修正：financeBS/segmentPL/segmentBS/hqAdjustment* を csv_finance_data に格納
      // financePL は finance_pl に格納（既存カラム）
      // 既存 csv_finance_data を保持しつつ、新しい値でマージ
      // ★ 多重ネスト防止：unwrapCsvFinanceData で正規化
      const existingCsv = unwrapCsvFinanceData((existingState as any)?.csvFinanceData);
      const nextCsv = unwrapCsvFinanceData({
        ...existingCsv,
        financeBS: (mergedState as any).financeBS,
        segmentPL: (mergedState as any).segmentPL,
        segmentBS: (mergedState as any).segmentBS,
        hqAdjustmentPL: (mergedState as any).hqAdjustmentPL,
        hqAdjustmentBS: (mergedState as any).hqAdjustmentBS,
      });

      const updatePayload: any = {
        ...baseRow,
        finance_pl: (mergedState as any).financePL,
        csv_finance_data: nextCsv,
        user_id: userId,
        company_id: cleanCompanyId,
        updated_at: now,
      };
      delete updatePayload.created_at;

      if (DEBUG) console.log('[SAVE update payload]', {
        finance_pl_len: Array.isArray((updatePayload.finance_pl as any))
          ? (updatePayload.finance_pl as any).length
          : null,
        stage1_issues_len: Array.isArray((updatePayload.stage1_issues as any))
          ? (updatePayload.stage1_issues as any).length
          : null,
        financeBS_in_csv: Array.isArray((updatePayload.csv_finance_data as any)?.financeBS)
          ? (updatePayload.csv_finance_data as any).financeBS.length
          : null,
        segmentBS_keys_in_csv: Object.keys((updatePayload.csv_finance_data as any)?.segmentBS || {}).length,
      });

      // ★ 楽観ロック：revision カラムがある場合
      //   - expectedRev は「引数で渡された revision」優先、無ければ currentRev
      //   - revision の更新（+1）は DBトリガに任せる（payloadに入れない）
      let expectedRev: number | undefined;
      if (hasRevision) {
        expectedRev = typeof revision === 'number' ? revision : currentRev;
      }

      let updateQuery = supabase
        .from(T_STRATEGY)
        .update(updatePayload)
        .eq('company_id', cleanCompanyId);

      if (hasRevision && typeof expectedRev === 'number') {
        updateQuery = updateQuery.eq('revision', expectedRev);
      }

      // ★重要：UPDATEの戻り値は必ず「全列」を返す（部分列だと store を壊す）
      const upd = await updateQuery.select('*').maybeSingle();

      if (upd.error) {
        console.error(
          '[StrategyData] ❌ update failed:',
          extractErrorVerbose(upd.error),
        );
        return { data: null, error: extractErrorVerbose(upd.error) };
      }

      // ★ 修正：Supabase UPDATE 戻り値の csv_finance_data と finance_pl 確認
      if (upd.data) {
        const returnedCsv = (upd.data as any)?.csv_finance_data ?? {};
        const returnedFinancePl = (upd.data as any)?.finance_pl ?? [];
        const returnedStage1Issues = (upd.data as any)?.stage1_issues ?? [];
        if (DEBUG) console.log('[SAVE returned UPDATE financial data]', {
          id: (upd.data as any)?.id,
          revision: (upd.data as any)?.revision,
          csv_finance_data_keys: Object.keys(returnedCsv).slice(0, 40),
          financeBS_len: Array.isArray((returnedCsv as any).financeBS) ? (returnedCsv as any).financeBS.length : null,
          financePL_len: Array.isArray(returnedFinancePl) ? returnedFinancePl.length : null,
          stage1Issues_len: Array.isArray(returnedStage1Issues) ? returnedStage1Issues.length : null,
          segmentBS_keys: Object.keys((returnedCsv as any).segmentBS || {}).length,
          segmentPL_keys: Object.keys((returnedCsv as any).segmentPL || {}).length,
          hqAdjustmentPL_len: Array.isArray((returnedCsv as any).hqAdjustmentPL) ? (returnedCsv as any).hqAdjustmentPL.length : null,
        });
      }

      // ★ 楽観ロック衝突検知：UPDATE結果が0件（data が null）なら衝突
      if (!upd.data) {
        console.warn(
          '[StrategyData] ⚠ REVISION_CONFLICT: expected revision',
          expectedRev,
          'but data was already updated by another session',
        );

        // 現在の revision を再取得して返す
        let currentRevisionOnServer: number | undefined;
        try {
          const refetch = await supabase
            .from(T_STRATEGY)
            .select('revision')
            .eq('company_id', cleanCompanyId)
            .maybeSingle();
          if (refetch.data && typeof (refetch.data as any).revision === 'number') {
            currentRevisionOnServer = (refetch.data as any).revision;
          }
        } catch (e) {
          console.warn('[StrategyData] failed to refetch current revision:', e);
        }

        return {
          data: null,
          error: {
            code: 'REVISION_CONFLICT',
            message:
              'Data was modified by another session. Please refresh and try again.',
            expectedRevision: expectedRev,
            currentRevision: currentRevisionOnServer,
          },
        };
      }

      // ★ strategy_data 保存後、「会社ストーリー answers2」がある時だけ重ねて保存（冪等）
      if (storyAnswersBundle.length > 0) {
        const ares = await saveStoryAnswers2(userId!, storyAnswersBundle, {
          companyId: cleanCompanyId,
        });
        if (ares.error) {
          console.warn(
            '[StrategyData] ⚠ answers2 post-update save failed:',
            ares.error,
          );
        }
      }

      const stateAfter = buildStateFromDbRow(upd.data ?? {});
      if (DEBUG) console.log(
        '[StrategyData] ✅ strategy_data update ok:',
        'strategyId=',
        (stateAfter as any)?.strategyId ?? (upd.data as any)?.id ?? null,
        'revision=',
        (stateAfter as any)?.revision,
        'financeBS=',
        Array.isArray((stateAfter as any).financeBS)
          ? (stateAfter as any).financeBS.length
          : 'no-field',
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
      if (DEBUG) console.log('[StrategyData] updateOnly mode → skip insert (no existing row).');
      return { data: null, error: null };
    }

    // ★ 修正：financeBS/segmentPL/segmentBS/hqAdjustment* を csv_finance_data に格納
    // financePL は finance_pl に格納（既存カラム）
    // ★ 多重ネスト防止：unwrapCsvFinanceData で正規化
    const insertCsv = unwrapCsvFinanceData({
      financeBS: (mergedState as any).financeBS,
      segmentPL: (mergedState as any).segmentPL,
      segmentBS: (mergedState as any).segmentBS,
      hqAdjustmentPL: (mergedState as any).hqAdjustmentPL,
      hqAdjustmentBS: (mergedState as any).hqAdjustmentBS,
    });

    const insertPayload: any = {
      ...baseRow,
      finance_pl: (mergedState as any).financePL,
      csv_finance_data: insertCsv,
      user_id: userId,
      company_id: cleanCompanyId,
      updated_at: now,
      created_at: now,
      // revision は DB default に任せる（0 等）
    };

    if (DEBUG) console.log('[SAVE insert payload]', {
      finance_pl_len: Array.isArray((insertPayload.finance_pl as any))
        ? (insertPayload.finance_pl as any).length
        : null,
      financeBS_in_csv: Array.isArray((insertPayload.csv_finance_data as any)?.financeBS)
        ? (insertPayload.csv_finance_data as any).financeBS.length
        : null,
      segmentBS_keys_in_csv: Object.keys((insertPayload.csv_finance_data as any)?.segmentBS || {}).length,
    });

    // ★重要：INSERTの戻り値は必ず「全列」を返す（部分列だと store を壊す）
    const ins = await supabase
      .from(T_STRATEGY)
      .insert(insertPayload)
      .select('*')
      .single();

    if (ins.error) {
      return { data: null, error: extractErrorVerbose(ins.error) };
    }

    // ★ 修正：Supabase INSERT 戻り値の csv_finance_data と finance_pl 確認
    if (ins.data) {
      const returnedCsv = (ins.data as any)?.csv_finance_data ?? {};
      const returnedFinancePl = (ins.data as any)?.finance_pl ?? [];
      if (DEBUG) console.log('[SAVE returned INSERT financial data]', {
        id: (ins.data as any)?.id,
        revision: (ins.data as any)?.revision,
        csv_finance_data_keys: Object.keys(returnedCsv).slice(0, 40),
        financeBS_len: Array.isArray((returnedCsv as any).financeBS) ? (returnedCsv as any).financeBS.length : null,
        financePL_len: Array.isArray(returnedFinancePl) ? returnedFinancePl.length : null,
        segmentBS_keys: Object.keys((returnedCsv as any).segmentBS || {}).length,
        segmentPL_keys: Object.keys((returnedCsv as any).segmentPL || {}).length,
        hqAdjustmentPL_len: Array.isArray((returnedCsv as any).hqAdjustmentPL) ? (returnedCsv as any).hqAdjustmentPL.length : null,
      });
    }

    // ★ 挿入後にも「会社ストーリー answers2」がある時だけ保存（冪等）
    if (storyAnswersBundle.length > 0) {
      const ares = await saveStoryAnswers2(userId!, storyAnswersBundle, {
        companyId: cleanCompanyId,
      });
      if (ares.error) {
        console.warn(
          '[StrategyData] ⚠ answers2 post-insert save failed:',
          ares.error,
        );
      }
    }

    const stateAfter = buildStateFromDbRow(ins.data ?? {});
    if (DEBUG) console.log(
      '[StrategyData] ✅ strategy_data insert ok:',
      'strategyId=',
      (stateAfter as any)?.strategyId ?? (ins.data as any)?.id ?? null,
      'revision=',
      (stateAfter as any)?.revision,
      'financeBS=',
      Array.isArray((stateAfter as any).financeBS)
        ? (stateAfter as any).financeBS.length
        : 'no-field',
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
  if (DEBUG) console.log(
    '[StrategyData] 🗑 deleteStrategyData called for',
    userId,
    companyIdOverride ?? '(cookie/membership)',
  );
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

    // 子テーブルから先に削除
    const delAns = await supabase
      .from(T_STORY_ANSWERS)
      .delete()
      .eq('company_id', companyId);
    if (delAns.error && delAns.error.code !== 'PGRST116') {
      console.warn(
        '[StrategyData] ⚠ story_answers2 delete warn:',
        extractErrorVerbose(delAns.error),
      );
    }

    const delFinal = await supabase
      .from(T_FINAL_STORIES)
      .delete()
      .eq('company_id', companyId);
    if (delFinal.error && delFinal.error.code !== 'PGRST116') {
      console.warn(
        '[StrategyData] ⚠ final_stories delete warn:',
        extractErrorVerbose(delFinal.error),
      );
    }

    const delProg = await supabase
      .from(T_PROGRESS)
      .delete()
      .eq('company_id', companyId);
    if (delProg.error && delProg.error.code !== 'PGRST116') {
      console.warn(
        '[StrategyData] ⚠ progress_logs delete warn:',
        extractErrorVerbose(delProg.error),
      );
    }

    const del = await supabase.from(T_STRATEGY).delete().eq('company_id', companyId);
    if (del.error) return { error: extractErrorVerbose(del.error) };

    if (DEBUG) console.log('[StrategyData] ✅ delete success for companyId:', companyId);
    return { error: null };
  } catch (error) {
    return { error: extractErrorVerbose(error) };
  }
}

/* ============================================================
 * 全削除（会社スコープの完全掃除：レガシー含む）
 * ========================================================== */
export async function deleteAllCompanyData(
  userId: string,
  companyIdOverride?: string | null,
) {
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
  if (DEBUG) console.log('[deleteAllCompanyData] ✅ wiped for company_id=', companyId);
  return { ok: true };
}

/* ============================================================
 * レガシーテーブル削除
 * ========================================================== */
export async function purgeLegacyTables(
  userId: string,
  companyIdOverride?: string | null,
) {
  const companyId = await resolveCompanyId(userId, companyIdOverride);
  for (const t of T_LEGACY) {
    try {
      const res = await supabase.from(t).delete().eq('company_id', companyId);
      if (res.error && res.error.code !== 'PGRST116') {
        console.warn(`[LegacyPurge] ${t} delete warn:`, extractErrorVerbose(res.error));
      } else {
        if (DEBUG) console.log(`[LegacyPurge] ${t} deleted for company_id=${companyId}`);
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
  if (DEBUG) console.log('[StrategyData] 📊 appendSimulationResultToStrategy called:', { userId, payload });
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
      projectId = null,
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
      // project_id: projectId, // DBにあれば有効化
      department: departmentId,
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
 * 分離テーブルへの保存API（company_id 一意／手動UPSERT固定）
 * ========================================================== */

/** あるカラムが存在しない系のエラーか（updated_atなど） */
function isMissingColumnError(err: any): boolean {
  const code = err?.code ?? err?.raw?.code;
  const msg = (err?.message ?? err?.raw?.message ?? '').toString();
  const details = (err?.details ?? err?.raw?.details ?? '').toString();

  // Postgres: undefined_column = 42703
  if (code === '42703') return true;

  const s = `${msg} ${details}`.toLowerCase();
  if (s.includes('does not exist') && s.includes('column')) return true;
  if (s.includes('unknown field')) return true;

  return false;
}

/** rowから特定keyを除去したコピー */
function omitKeys<T extends Record<string, any>>(row: T, keys: string[]): T {
  const out: any = { ...row };
  for (const k of keys) delete out[k];
  return out as T;
}

/** 手動UPSERT：company_id のみで存在確認 → UPDATE/INSERT */
async function robustUpsertCompanyScoped(
  table: string,
  row: Record<string, any>,
) {
  try {
    const got = await supabase
      .from(table)
      .select('company_id')
      .eq('company_id', row.company_id)
      .limit(1)
      .maybeSingle();

    if (got.error && got.error.code !== 'PGRST116') {
      return { ok: false, error: extractErrorVerbose(got.error) };
    }

    if (got.data) {
      const upd1 = await supabase
        .from(table)
        .update(row)
        .eq('company_id', row.company_id)
        .select('company_id')
        .maybeSingle();

      if (!upd1.error) return { ok: true, error: null };

      const err1 = extractErrorVerbose(upd1.error);
      if (isMissingColumnError(err1)) {
        const row2 = omitKeys(row, ['updated_at', 'created_at']);
        const upd2 = await supabase
          .from(table)
          .update(row2)
          .eq('company_id', row.company_id)
          .select('company_id')
          .maybeSingle();
        if (upd2.error) return { ok: false, error: extractErrorVerbose(upd2.error) };
        return { ok: true, error: null };
      }

      return { ok: false, error: err1 };
    } else {
      const ins1 = await supabase
        .from(table)
        .insert(row)
        .select('company_id')
        .maybeSingle();

      if (!ins1.error) return { ok: true, error: null };

      const err1 = extractErrorVerbose(ins1.error);
      if (isMissingColumnError(err1)) {
        const row2 = omitKeys(row, ['updated_at', 'created_at']);
        const ins2 = await supabase
          .from(table)
          .insert(row2)
          .select('company_id')
          .maybeSingle();
        if (ins2.error) return { ok: false, error: extractErrorVerbose(ins2.error) };
        return { ok: true, error: null };
      }

      return { ok: false, error: err1 };
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
      updated_at: now,
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
      updated_at: now,
    };

    const r = await robustUpsertCompanyScoped(T_STORY_ANSWERS, row);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: extractErrorVerbose(e) };
  }
}

/* ============================================================
 * ★ 多重ネストデータの修復（救済関数）
 * ========================================================== */
export async function repairNestedCsvFinanceData(
  userId: string,
  companyIdOverride?: string | null,
) {
  const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

  const cur = await getFullStrategyDataByCompany(companyId);
  if (cur.error || !cur.data) {
    return { ok: false, error: cur.error ?? 'no data' };
  }

  const state = cur.data;
  const csvFd = (state as any)?.csvFinanceData;

  // 既に unwrap されているか確認（数値キーが複数あれば OK、1つだけなら修復が必要）
  const csvKeys = csvFd && typeof csvFd === 'object' ? Object.keys(csvFd) : [];
  const hasOnlyNumericKey = csvKeys.length === 1 && /^\d+$/.test(csvKeys[0]);

  if (!hasOnlyNumericKey) {
    if (DEBUG) console.log('[repairNestedCsvFinanceData] already normalized or empty, skip');
    return { ok: true, error: null };
  }

  // 多重ネストを解除
  const safeState: StrategyData = {
    ...(state as any),
    csvFinanceData: unwrapCsvFinanceData(csvFd),
  };

  const rev = (state as any)?.revision;
  const saved = await saveStrategyData(
    safeState,
    userId,
    companyId,
    typeof rev === 'number' ? rev : undefined,
  );

  if (saved.error) {
    return { ok: false, error: saved.error };
  }

  if (DEBUG) {
    console.log('[repairNestedCsvFinanceData] ✅ repair successful', {
      companyId,
      strategyId: (saved.data as any)?.strategyId ?? (saved.data as any)?.id,
      revision: (saved.data as any)?.revision,
    });
  }

  return { ok: true, error: null };
}

/* ============================================================
 * ★ワンショット修復用ユーティリティ（任意）
 * ========================================================== */
export async function repairMisfiledAnswers2(
  userId: string,
  companyIdOverride?: string | null,
) {
  const companyId = await resolveCompanyId(userId, companyIdOverride ?? null);

  const cur = await getFullStrategyDataByCompany(companyId);
  if (cur.error || !cur.data) return { ok: false, error: cur.error ?? 'no data' };

  const state = cur.data;
  const storyAnswers = ensureArray((state as any).answers2);

  const deptNames = ensureArray(state.departments).map((d: any) => (d?.name ?? '').trim());
  const split = splitAnswers2ByDeptNames(storyAnswers, deptNames);

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

  const ares = await saveStoryAnswers2(userId, split.storyAnswers, { companyId });
  if (ares.error) return { ok: false, error: ares.error };

  return { ok: true };
}

/* ============================================================
 * 🔰 戦略全体スナップショット I/O
 * ========================================================== */
export async function getFullStrategySnapshot(
  userId: string,
  companyIdOverride: string | null = null,
): Promise<{ snapshot: FullStrategySnapshot | null; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);

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
    const finalStoryRaw = ensureArray(finRes.data?.final_story) as Array<{
      title: string;
      body: string;
    }>;

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

export async function saveFullStrategySnapshot(
  userId: string,
  snapshot: FullStrategySnapshot,
  companyIdOverride: string | null = null,
): Promise<{ ok: boolean; error: any | null }> {
  try {
    const companyId = await resolveCompanyId(userId, companyIdOverride);

    if (snapshot.strategy) {
      const { revision, ...rest } = snapshot.strategy as StrategyData & { revision?: number };
      const rev =
        typeof snapshot.strategy.revision === 'number'
          ? snapshot.strategy.revision
          : undefined;
      const saved = await saveStrategyData(rest as StrategyData, userId, companyId, rev);
      if (saved.error) {
        return { ok: false, error: saved.error };
      }
    }

    if (snapshot.storyAnswers2 && snapshot.storyAnswers2.length > 0) {
      const ares = await saveStoryAnswers2(userId, snapshot.storyAnswers2, { companyId });
      if (!ares.ok) {
        return { ok: false, error: ares.error };
      }
    }

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
