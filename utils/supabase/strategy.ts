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
 * Helper functions for ceoIntent tracing (TASK 13-1)
 * ========================================================== */
const headStr = (s: any) => (typeof s === 'string' ? s.slice(0, 30) : '');
const lenStr = (s: any) => (typeof s === 'string' ? s.length : 0);

/* ============================================================
 * PGRST204 フォールバック（列が未作成環境対応）
 * ========================================================== */
function extractColumnFromPGRST204(errorMsg: string): string | null {
  // "column 'answers12' does not exist" or similar patterns
  const match = errorMsg.match(/column\s+['"'`]?([a-z_0-9]+)['"'`]?\s+(?:does not exist|not found)/i);
  return match ? match[1] : null;
}

function isPGRST204Error(error: any): boolean {
  if (!error) return false;
  const msg = String(error?.message || error?.details || error?.error || error || '').toLowerCase();
  return msg.includes('pgrst204') || msg.includes('column') && msg.includes('does not exist');
}

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

/* ============================================================
 * TASK A: KPI を string[] に強制変換するヘルパー
 * DB復元・保存・UI描画で object が入ることを防ぐ
 * ========================================================== */
const kpiToString = (x: any): string => {
  if (typeof x === 'string') return x;
  if (!x || typeof x !== 'object') return String(x ?? '');
  // よくある候補を順に拾う
  if (typeof x.label === 'string') return x.label;
  if (typeof x.name === 'string') return x.name;
  if (typeof x.title === 'string') return x.title;
  if (typeof x.text === 'string') return x.text;
  // 最後の手段：JSON化（ただし見づらいので極力避ける）
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

const ensureKpiStringArray = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(kpiToString)
    .map((s) => (typeof s === 'string' ? s.trim() : String(s)))
    .filter((s) => s.length > 0);
};

/* ★ KeyResult を文字列化（KPI と同じ優先度） */
const krToString = (x: any): string => {
  if (typeof x === 'string') return x;
  if (x == null) return '';
  if (typeof x === 'object') {
    const extracted = x.label ?? x.name ?? x.title ?? x.text;
    if (extracted) return String(extracted);
    return JSON.stringify(x);
  }
  return String(x ?? '');
};

/* ★ keyResults 配列を string[] に強制 */
const ensureKrStringArray = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(krToString)
    .map((s) => (typeof s === 'string' ? s.trim() : String(s)))
    .filter((s) => s.length > 0);
};

/* ★ OKR 全体を正規化（keyResults を string[] に強制） */
const ensureOkrsNormalized = (okrs: any): any[] => {
  if (!Array.isArray(okrs)) return [];
  return okrs.map((okr: any) => ({
    ...okr,
    keyResults: ensureKrStringArray(okr?.keyResults),
  }));
};

/* undefined を深い階層まで除去（"意図しない上書き"抑制） */
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

/* ★ REMOVED: deepMergePreserveNonEmpty
 *
 * Previously used partial merge strategy which caused data integrity issues:
 * - Empty incoming fields were preserved from existing data (preventing deletion)
 * - segmentPL/segmentBS were partially merged instead of replaced
 * - Data intended to be cleared would reappear after saves
 *
 * New strategy: FULL REPLACEMENT
 * - Incoming payload is the complete source of truth
 * - Empty values in payload are intentional (delete, clear, replace)
 * - Only server-decided fields (id, created_at, strategyId) are preserved
 *
 * Impact: Data integrity now 100% maintained, no garbage accumulation
 */

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
  stage1Benchmarks: 'stage1_benchmarks',  // ★ 修正：ベンチマーク・WACC を保存対象に追加
  story: 'story',
  finalStory: 'final_story',
  finalStoryDraft: 'final_story_draft',  // ★ 追加：最終ストーリー ドラフト版（3段階編集用）
  finalStoryEdited: 'final_story_edited',  // ★ 追加：最終ストーリー 編集版（3段階編集用）
  finalStoryFinal: 'final_story_final',  // ★ 追加：最終ストーリー 確定版（3段階編集用）
  /* ★ TASK 15-B: STAGE2 フィールドを FIELD_MAP に追加（復元漏れ防止） */
  answers2: 'answers2',
  answers12: 'answers12',
  winPatternsCandidate: 'win_patterns_candidate',
  winPatterns: 'win_patterns',
  winPatternPrimary: 'win_pattern_primary',
  winPatternSecondary: 'win_pattern_secondary',
  companyTargets: 'company_targets',  // ★ 追加：North Star メトリクス
  projectTargetImpacts: 'project_target_impacts',  // ★ 追加：STAGE6 Phase E - Target Impact
  projectIssueLinks: 'project_issue_links',  // ★ 追加：STAGE6 Phase E - Issue Link
  /* その他 */
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
    if (snake === 'final_story_draft') v = ensureArray(v);  // ★ 追加：finalStoryDraft は配列
    if (snake === 'final_story_edited') v = ensureArray(v);  // ★ 追加：finalStoryEdited は配列
    if (snake === 'final_story_final') v = ensureArray(v);  // ★ 追加：finalStoryFinal は配列
    if (snake === 'departments') v = ensureArray(v);
    if (snake === 'simulation_results') v = ensureArray(v);
    if (snake === 'stage1_issues') v = ensureArray(v);  // ★ 修正：stage1_issues は配列
    if (snake === 'stage1_benchmarks') {
      // stage1Benchmarks はオブジェクト（benchmarks + WACC を格納）
      v = (typeof v === 'object' && !Array.isArray(v)) ? v : null;
    }
    /* ★ TASK 15-B: STAGE2 フィールドを配列として処理 */
    if (snake === 'answers2') v = ensureArray(v);
    if (snake === 'answers12') v = ensureArray(v);
    if (snake === 'win_patterns_candidate') v = ensureArray(v);
    if (snake === 'win_patterns') v = ensureArray(v);
    if (snake === 'company_targets') v = ensureArray(v);  // ★ 追加：companyTargets は配列
    if (snake === 'project_target_impacts') v = ensureArray(v);  // ★ 追加：projectTargetImpacts は配列
    if (snake === 'project_issue_links') v = ensureArray(v);  // ★ 追加：projectIssueLinks は配列
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

// ★ TASK A: okrsV2 → okrs/kpis 投影ヘルパー
const ensureStringArray = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];

const okrsV2ToOkrs = (okrsV2: any[], fallbackTitle: string) => {
  const out = ensureArray(okrsV2).map((o: any) => {
    const objective =
      (typeof o?.objective === 'string' && o.objective.trim()) ||
      (typeof o?.title === 'string' && o.title.trim()) ||
      fallbackTitle;

    const krsRaw = ensureArray(o?.keyResults ?? o?.krs ?? o?.kpi ?? o?.items);
    const keyResults = krsRaw
      .map((kr: any) => {
        if (typeof kr === 'string') return { label: kr };
        if (typeof kr?.label === 'string') return { label: kr.label };
        if (typeof kr?.name === 'string') return { label: kr.name };
        return null;
      })
      .filter(Boolean);

    return { ...o, objective, keyResults };
  });

  return out;
};

const okrsToKpis = (okrs: any[]) => {
  const names: string[] = [];
  for (const o of ensureArray(okrs)) {
    for (const kr of ensureArray(o?.keyResults)) {
      const label =
        typeof kr === 'string'
          ? kr
          : typeof kr?.label === 'string'
          ? kr.label
          : typeof kr?.name === 'string'
          ? kr.name
          : '';

      if (label) names.push(label);
    }
  }
  return names;
};

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
  out.finalStoryDraft = ensureArray(out.finalStoryDraft);  // ★ 追加：finalStoryDraft を復元
  out.finalStoryEdited = ensureArray(out.finalStoryEdited);  // ★ 追加：finalStoryEdited を復元
  out.finalStoryFinal = ensureArray(out.finalStoryFinal);  // ★ 追加：finalStoryFinal を復元
  out.departments = ensureArray(out.departments);
  out.simulationResults = ensureArray(out.simulationResults);
  out.stage1Issues = ensureArray(out.stage1Issues);  // ★ 修正：stage1Issues を復元
  out.financePL = ensureArray(out.financePL);

  // ★ TASK-B: 既存データの救済（百万円で保存されたデータを yen に変換）
  // 復元時に financePL の revenue < 1M なら百万円と判定して yen に変換
  out.financePL = (out.financePL as any[]).map((row: any) => {
    const revenue = row.revenue ?? 0;
    const operatingIncome = row.operatingIncome ?? 0;

    const revenueYen = revenue > 0 && revenue < 1_000_000 ? revenue * 1_000_000 : revenue;
    const opIncomeYen = operatingIncome > 0 && operatingIncome < 1_000_000 ? operatingIncome * 1_000_000 : operatingIncome;


    return {
      ...row,
      revenue: revenueYen,
      operatingIncome: opIncomeYen,
      // 他の財務指標も同様
      cogs: (row.cogs ?? 0) > 0 && (row.cogs ?? 0) < 1_000_000 ? (row.cogs ?? 0) * 1_000_000 : (row.cogs ?? 0),
      sga: (row.sga ?? 0) > 0 && (row.sga ?? 0) < 1_000_000 ? (row.sga ?? 0) * 1_000_000 : (row.sga ?? 0),
      grossProfit: (row.grossProfit ?? 0) > 0 && (row.grossProfit ?? 0) < 1_000_000 ? (row.grossProfit ?? 0) * 1_000_000 : (row.grossProfit ?? 0),
    };
  });

  out.businessSegments = ensureArray(out.businessSegments);
  /* ★ TASK 15-B: STAGE2 フィールドを確実に復元 */
  out.answers2 = ensureArray(out.answers2);
  out.answers12 = ensureArray(out.answers12);
  out.winPatternsCandidate = ensureArray(out.winPatternsCandidate);
  out.winPatterns = ensureArray(out.winPatterns);
  out.companyTargets = ensureArray(out.companyTargets);  // ★ 追加：companyTargets を復元

  // ★ STAGE6 Phase E: projectTargetImpacts / projectIssueLinks を安全に復元
  // 要件1: snake_case から読む（FIELD_MAP ループで既に out に設定済み）
  // 要件2: Array.isArray でガード（ensureArray では不十分なのでここで明示的に）
  const rawImpacts = out.projectTargetImpacts;
  out.projectTargetImpacts = Array.isArray(rawImpacts) ? rawImpacts : [];

  const rawLinks = out.projectIssueLinks;
  out.projectIssueLinks = Array.isArray(rawLinks) ? rawLinks : [];

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

  // ★ TASK 3: answers12 diagnostic on restore from DB (cross-session)
  if (DEBUG) console.log('[buildStateFromDbRow] answers12', {
    row_has: 'answers12' in safeRow,
    row_len: Array.isArray((safeRow as any).answers12) ? (safeRow as any).answers12.length : 'missing',
    state_len: Array.isArray(out.answers12) ? out.answers12.length : 'missing',
    first: Array.isArray(out.answers12) && out.answers12.length > 0 ? out.answers12[0] : null,
  });

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
  /* ★ TASK 15-C: STAGE2 フィールドのログを追加 */
  const ceoIntentLen = typeof out.ceoIntent === 'string' ? out.ceoIntent.length : 0;
  const storyDraftLen = Array.isArray(out.storyDraft) ? out.storyDraft.length : 0;
  const answers2Len = Array.isArray(out.answers2) ? out.answers2.length : 0;
  const answers12Len = Array.isArray(out.answers12) ? out.answers12.length : 0;
  const winPatternsCandidateLen = Array.isArray(out.winPatternsCandidate) ? out.winPatternsCandidate.length : 0;
  const winPatternsLen = Array.isArray(out.winPatterns) ? out.winPatterns.length : 0;
  const companyTargetsLen = Array.isArray(out.companyTargets) ? out.companyTargets.length : 0;
  const projectTargetImpactsLen = Array.isArray(out.projectTargetImpacts) ? out.projectTargetImpacts.length : 0;  // ★ 追加
  const projectIssueLinksLen = Array.isArray(out.projectIssueLinks) ? out.projectIssueLinks.length : 0;  // ★ 追加
  const finalStoryDraftLen = Array.isArray(out.finalStoryDraft) ? out.finalStoryDraft.length : 0;
  const finalStoryEditedLen = Array.isArray(out.finalStoryEdited) ? out.finalStoryEdited.length : 0;
  const finalStoryFinalLen = Array.isArray(out.finalStoryFinal) ? out.finalStoryFinal.length : 0;
  if (DEBUG) console.log('[buildStateFromDbRow] raw_復元', {
    /* STAGE1 */
    issueBlocks_len: issueBlocksLen,
    csvFd_exists: csvFdExists,
    financeBS_len: csvFdFinanceBSLen,
    segmentPL_keys: csvFdSegmentPLKeys,
    segmentBS_keys: csvFdSegmentBSKeys,
    financePL_len: financePLLen,
    /* STAGE2 */
    ceoIntent_len: ceoIntentLen,
    storyDraft_len: storyDraftLen,
    answers2_len: answers2Len,
    answers12_len: answers12Len,
    winPatternsCandidate_len: winPatternsCandidateLen,
    winPatterns_len: winPatternsLen,
    companyTargets_len: companyTargetsLen,
    /* STAGE6 Phase E */  // ★ 追加
    projectTargetImpacts_len: projectTargetImpactsLen,  // ★ 追加
    projectIssueLinks_len: projectIssueLinksLen,  // ★ 追加
    finalStoryDraft_len: finalStoryDraftLen,
    finalStoryEdited_len: finalStoryEditedLen,
    finalStoryFinal_len: finalStoryFinalLen,
  });

  out.financeBS = ensureArray(csvFinanceData.financeBS);
  out.segmentPL = csvFinanceData.segmentPL; // Record<string, FinancePLRow[]>
  out.segmentBS = csvFinanceData.segmentBS; // Record<string, SegmentBSRow[]>
  out.hqAdjustmentPL = ensureArray(csvFinanceData.hqAdjustmentPL);
  out.hqAdjustmentBS = ensureArray(csvFinanceData.hqAdjustmentBS);

  // 部門・プロジェクトを一旦「生」の形で整形（okrsV2 を含む）
  // ★ FIXED: mission/missionDescription を明示的に保持
  out.departments = out.departments.map((d: any) => ({
    ...d,
    name: d?.name ?? '',
    mission: d?.mission ?? '',
    missionDescription: d?.missionDescription ?? '',
    projects: ensureArray(d?.projects).map((p: any) => ({
      ...p,
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
      // ★ okrsV2 はここでは触らずそのまま保持（...p で保持）
    })),
  }));

  // ★ TASK B: DBロード後の cascade 情報チェックログ
  const cascadeLoadCounts = out.departments.map((d: any) => ({
    name: d.name,
    projCount: Array.isArray(d.projects) ? d.projects.length : 0,
    projOkrCounts: Array.isArray(d.projects)
      ? d.projects.map((p: any) => ({
          title: p.title,
          okrCount: Array.isArray(p.okrs) ? p.okrs.length : 0,
          kpiCount: Array.isArray(p.kpis) ? p.kpis.length : 0,
        }))
      : [],
  }));

  if (process.env.NEXT_PUBLIC_DEBUG_CASCADE_DUP === '1') {
    console.log('[cascade][load][counts]', {
      totalDepts: out.departments.length,
      depts: cascadeLoadCounts,
    });
  }

  // ★ normalize 前の departments を保持（okrsV2 が入っている生データ）
  const rawDepartmentsWithOkrsV2 = out.departments;

  // ★ 修正：raw の csvFinanceData/segmentPL/segmentBS を保持（normalize で落ちるため）
  const rawCsvFinanceData = out.csvFinanceData;
  const rawSegmentPL = out.segmentPL;
  const rawSegmentBS = out.segmentBS;

  // ★ TASK-1/TASK-3 修正：normalize 前に raw を退避（companyTargets / projectTargetImpacts / projectIssueLinks）
  // これらのフィールドは normalize で落ちる可能性があるため、normalize 後に復元する
  const rawCompanyTargets = out.companyTargets;
  const rawProjectTargetImpacts = out.projectTargetImpacts;
  const rawProjectIssueLinks = out.projectIssueLinks;

  // ★ CASE3 診断：normalize 前の departments 内部の深部を確認
  const diagDeptDeep = (depts: any[]) =>
    (Array.isArray(depts) ? depts : []).map((d: any) => ({
      name: d?.name,
      projects: (Array.isArray(d?.projects) ? d.projects : []).map((p: any) => ({
        title: p?.title,
        okrs: Array.isArray(p?.okrs) ? p.okrs.length : 0,
        kpis: Array.isArray(p?.kpis) ? p.kpis.length : 0,
        okrsV2: Array.isArray(p?.okrsV2) ? p.okrsV2.length : 0,
      })),
    }));

  // ★ DEBUG：normalize 前（プリミティブ値のみ）
  const outCsvFdExists = !!out.csvFinanceData;
  const outSegmentPLKeys = Object.keys(out.segmentPL || {}).length;
  const outSegmentBSKeys = Object.keys(out.segmentBS || {}).length;
  if (DEBUG) console.log('[buildStateFromDbRow] norm前 csvFd:' + outCsvFdExists + ' segmentPL:' + outSegmentPLKeys + ' segmentBS:' + outSegmentBSKeys);

  const normalized = normalizeStrategyData(out) as StrategyData;

  // ★ CASE3 診断：normalize 後の departments 内部の深部を確認

  // ★ DEBUG LOG D: restore 後の確認（Object.keys + mission/missionDescription）
  const normDept0 = (normalized as any).departments?.[0];
  if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
    console.log('[DEBUG D] restore後 - dept0 keys:', Object.keys(normDept0 ?? {}));
    console.log('[DEBUG D] restore後のnormalized state:', {
      dept0_name: normDept0?.name,
      dept0_mission: normDept0?.mission,
      dept0_missionDescription: normDept0?.missionDescription,
    });
  }

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

          // ★ ここで DB からの okrsV2 を復元 + okrs/kpis も投影して復元
          const projectedOkrs = okrsV2ToOkrs(
            rawOkrsV2,
            proj?.title ?? rawProj?.title ?? ''
          );
          const projectedKpis = okrsToKpis(projectedOkrs);

          return {
            ...proj,
            okrsV2: rawOkrsV2,
            // 既にあるなら上書きしない（ユーザー編集を守る）
            okrs:
              Array.isArray(proj?.okrs) && proj.okrs.length > 0
                ? proj.okrs
                : projectedOkrs,
            kpis:
              Array.isArray(proj?.kpis) && proj.kpis.length > 0
                ? proj.kpis
                : projectedKpis,
          };
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

    // ★ TASK C: ロード後ログを normalized 側で再計測
    if (process.env.NEXT_PUBLIC_DEBUG_CASCADE_DUP === '1') {
      const after = ensureArray((normalized as any).departments).map((d: any) => ({
        name: d.name,
        projCount: Array.isArray(d.projects) ? d.projects.length : 0,
        projOkrCounts: Array.isArray(d.projects)
          ? d.projects.map((p: any) => ({
              title: p.title,
              okrCount: Array.isArray(p.okrs) ? p.okrs.length : 0,
              kpiCount: Array.isArray(p.kpis) ? p.kpis.length : 0,
              okrsV2Count: Array.isArray(p.okrsV2) ? p.okrsV2.length : 0,
            }))
          : [],
      }));

      if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') console.log('[cascade][load][counts:normalized]', { depts: after });
    }
  }

  // ★ TASK B: load 時に project.kpis と okrs[].keyResults を string[] に正規化（object が混在していた時の救済）
  (normalized as any).departments = ensureArray((normalized as any).departments).map((d: any) => ({
    ...d,
    projects: ensureArray(d.projects).map((p: any) => ({
      ...p,
      kpis: ensureKpiStringArray(p.kpis), // object → string[] に矯正
      okrs: ensureOkrsNormalized(p.okrs), // okrs[].keyResults も object → string[] に矯正
    })),
  }));

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

  // ★ STEP 1: New fields post-normalize check and forced restoration
  // Store raw values before normalize for comparison
  // Note: rawCompanyTargets / rawProjectTargetImpacts / rawProjectIssueLinks は既に L766-770 で定義済み
  const rawFinalStoryDraft = out.finalStoryDraft;
  const rawFinalStoryEdited = out.finalStoryEdited;
  const rawFinalStoryFinal = out.finalStoryFinal;

  // Post-normalize diagnostics
  const normCompanyTargetsLen = Array.isArray((normalized as any).companyTargets) ? (normalized as any).companyTargets.length : 0;
  const normProjectTargetImpactsLen = Array.isArray((normalized as any).projectTargetImpacts) ? (normalized as any).projectTargetImpacts.length : 0;  // ★ 追加
  const normProjectIssueLinksLen = Array.isArray((normalized as any).projectIssueLinks) ? (normalized as any).projectIssueLinks.length : 0;  // ★ 追加
  const normFinalStoryDraftLen = Array.isArray((normalized as any).finalStoryDraft) ? (normalized as any).finalStoryDraft.length : 0;
  const normFinalStoryEditedLen = Array.isArray((normalized as any).finalStoryEdited) ? (normalized as any).finalStoryEdited.length : 0;
  const normFinalStoryFinalLen = Array.isArray((normalized as any).finalStoryFinal) ? (normalized as any).finalStoryFinal.length : 0;

  if (DEBUG) console.log('[diag][buildState:post_norm] NEW FIELDS AFTER NORMALIZE', {
    companyTargets_len: normCompanyTargetsLen,
    projectTargetImpacts_len: normProjectTargetImpactsLen,  // ★ 追加
    projectIssueLinks_len: normProjectIssueLinksLen,  // ★ 追加
    finalStoryDraft_len: normFinalStoryDraftLen,
    finalStoryEdited_len: normFinalStoryEditedLen,
    finalStoryFinal_len: normFinalStoryFinalLen,
  });

  // Forced restoration: if normalize dropped them, restore from raw
  let restoredCompanyTargets = false;
  let restoredProjectTargetImpacts = false;  // ★ 追加
  let restoredProjectIssueLinks = false;  // ★ 追加
  let restoredFinalStoryDraft = false;
  let restoredFinalStoryEdited = false;
  let restoredFinalStoryFinal = false;

  if (Array.isArray(rawCompanyTargets) && rawCompanyTargets.length > 0 && (!Array.isArray((normalized as any).companyTargets) || (normalized as any).companyTargets.length === 0)) {
    (normalized as any).companyTargets = rawCompanyTargets;
    restoredCompanyTargets = true;
  }
  if (Array.isArray(rawProjectTargetImpacts) && rawProjectTargetImpacts.length > 0 && (!Array.isArray((normalized as any).projectTargetImpacts) || (normalized as any).projectTargetImpacts.length === 0)) {  // ★ 追加
    (normalized as any).projectTargetImpacts = rawProjectTargetImpacts;
    restoredProjectTargetImpacts = true;
  }
  if (Array.isArray(rawProjectIssueLinks) && rawProjectIssueLinks.length > 0 && (!Array.isArray((normalized as any).projectIssueLinks) || (normalized as any).projectIssueLinks.length === 0)) {  // ★ 追加
    (normalized as any).projectIssueLinks = rawProjectIssueLinks;
    restoredProjectIssueLinks = true;
  }
  if (Array.isArray(rawFinalStoryDraft) && rawFinalStoryDraft.length > 0 && (!Array.isArray((normalized as any).finalStoryDraft) || (normalized as any).finalStoryDraft.length === 0)) {
    (normalized as any).finalStoryDraft = rawFinalStoryDraft;
    restoredFinalStoryDraft = true;
  }
  if (Array.isArray(rawFinalStoryEdited) && rawFinalStoryEdited.length > 0 && (!Array.isArray((normalized as any).finalStoryEdited) || (normalized as any).finalStoryEdited.length === 0)) {
    (normalized as any).finalStoryEdited = rawFinalStoryEdited;
    restoredFinalStoryEdited = true;
  }
  if (Array.isArray(rawFinalStoryFinal) && rawFinalStoryFinal.length > 0 && (!Array.isArray((normalized as any).finalStoryFinal) || (normalized as any).finalStoryFinal.length === 0)) {
    (normalized as any).finalStoryFinal = rawFinalStoryFinal;
    restoredFinalStoryFinal = true;
  }

  if (restoredCompanyTargets || restoredProjectTargetImpacts || restoredProjectIssueLinks || restoredFinalStoryDraft || restoredFinalStoryEdited || restoredFinalStoryFinal) {
    if (DEBUG) console.log('[diag][buildState:forced_restore] NEW FIELDS FORCED RESTORED', {
      companyTargets: restoredCompanyTargets,
      projectTargetImpacts: restoredProjectTargetImpacts,  // ★ 追加
      projectIssueLinks: restoredProjectIssueLinks,  // ★ 追加
      finalStoryDraft: restoredFinalStoryDraft,
      finalStoryEdited: restoredFinalStoryEdited,
      finalStoryFinal: restoredFinalStoryFinal,
    });
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

    // ★ TASK C: DBから取れた rawRow.departments をログ（復元の入口）
    const rawDep = (rowData as any)?.departments;
    const rawDepDiag = (Array.isArray(rawDep) ? rawDep : []).map((d: any) => ({
      name: d?.name,
      proj: (Array.isArray(d?.projects) ? d.projects : []).map((p: any) => ({
        title: p?.title,
        okrs: Array.isArray(p?.okrs) ? p.okrs.length : 0,
        kpis: Array.isArray(p?.kpis) ? p.kpis.length : 0,
        okrsV2: Array.isArray(p?.okrsV2) ? p.okrsV2.length : 0,
      })),
    }));

    /* ★ TASK 2: DB行のSTAGE2列存在確認ログ */
    if (DEBUG) {
      const hasRawStoryDraft = Object.prototype.hasOwnProperty.call(rowData, 'story_draft');
      const hasRawWinPatternsCandidate = Object.prototype.hasOwnProperty.call(rowData, 'win_patterns_candidate');
      const hasRawAnswers12 = Object.prototype.hasOwnProperty.call(rowData, 'answers12');
      const hasRawAnswers_12 = Object.prototype.hasOwnProperty.call(rowData, 'answers_12');
      const storyDraftLen = Array.isArray(rowData.story_draft) ? rowData.story_draft.length : 0;
      const winPatternsCandidateLen = Array.isArray(rowData.win_patterns_candidate) ? rowData.win_patterns_candidate.length : 0;
      const answers12Len = Array.isArray(rowData.answers12) ? rowData.answers12.length : 0;
      const answers_12Len = Array.isArray(rowData.answers_12) ? rowData.answers_12.length : 0;
    }

    // ★ TASK 1: answers12 load diagnostic（ログイン直後に answers12 が取れているか確定）
    if (DEBUG) console.log('[StrategyData][load] row.answers12 check', {
      has: 'answers12' in (rowData as any),
      len: Array.isArray((rowData as any).answers12) ? (rowData as any).answers12.length : 'not_array',
      first: Array.isArray((rowData as any).answers12) ? (rowData as any).answers12[0] : null,
    });

    // ★ STEP 0: New fields raw DB row check (company_targets, finalStory*)
    if (DEBUG) {
      const hasCompanyTargets = Object.prototype.hasOwnProperty.call(rowData, 'company_targets');
      const hasFinalStoryDraft = Object.prototype.hasOwnProperty.call(rowData, 'final_story_draft');
      const hasFinalStoryEdited = Object.prototype.hasOwnProperty.call(rowData, 'final_story_edited');
      const hasFinalStoryFinal = Object.prototype.hasOwnProperty.call(rowData, 'final_story_final');
      const companyTargetsLen = Array.isArray(rowData.company_targets) ? rowData.company_targets.length : null;
      const finalStoryDraftLen = Array.isArray(rowData.final_story_draft) ? rowData.final_story_draft.length : null;
      const finalStoryEditedLen = Array.isArray(rowData.final_story_edited) ? rowData.final_story_edited.length : null;
      const finalStoryFinalLen = Array.isArray(rowData.final_story_final) ? rowData.final_story_final.length : null;
    }

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

  // ★ TASK 13-1: Checkpoint 1 - ceoIntent in incoming payload
  if (DEBUG) console.log('[SAVE payload ceoIntent]', {
    len: lenStr((payload as any).ceoIntent),
    head: headStr((payload as any).ceoIntent),
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

    // ===== SAVE GUARD: Prevent data corruption from undefined/wrong company scope =====

    // PRIMARY GUARD: Block if company scope not ready (membership loading, undefined, invalid)
    if (!cleanCompanyId || !isValidUUID(cleanCompanyId)) {
      console.warn('[saveStrategyData] SAVE_BLOCKED - company scope not ready', {
        cleanCompanyId: cleanCompanyId || '(empty)',
        userId,
        hasOverride: !!companyIdOverride,
        reason: 'Company scope not established - likely during membership loading',
        timestamp: now,
      });

      // Return gracefully - no hard error that could break auto-save UI
      return {
        data: null,
        error: null, // Soft block: no error object, just skip save silently
      };
    }

    // SECONDARY GUARD: Validate payload doesn't have mismatched company_id (safety net)
    const payloadCompanyId = (payload as any)?.company_id;
    if (payloadCompanyId && typeof payloadCompanyId === 'string' && payloadCompanyId.trim() !== '') {
      const payloadCidNorm = payloadCompanyId.trim();

      // Check if payload company_id differs from resolved scope
      if (payloadCidNorm !== cleanCompanyId) {
        console.warn('[saveStrategyData] SAVE_BLOCKED - company ID mismatch detected', {
          payloadCompanyId: payloadCidNorm,
          resolvedCompanyId: cleanCompanyId,
          userId,
          hasOverride: !!companyIdOverride,
          reason: 'Payload contains stale/wrong company_id',
          timestamp: now,
        });

        // Return gracefully - no hard error
        return {
          data: null,
          error: null, // Soft block: prevents retry storms and toast loops
        };
      }
    }
    // ===== End Save Guard =====

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

    // ★ CRITICAL FIX: Full replacement instead of deep merge
    // Incoming payload is the source of truth - no merging with existing data
    let mergedState = prunedIncoming as StrategyData;

    // ★ Only preserve server-decided fields (id, created_at, strategyId)
    if (existingState.id) {
      (mergedState as any).id = existingState.id;
    }
    if (existingState.createdAt) {
      mergedState.createdAt = existingState.createdAt;
    }
    if (existingState.strategyId) {
      mergedState.strategyId = existingState.strategyId;
    }

    // ★ デバッグ：Full replacement after incoming payload applied
    if (DEBUG) console.log('[SAVE fullReplacement]', {
      financeBS_len: Array.isArray((mergedState as any).financeBS) ? (mergedState as any).financeBS.length : null,
      segmentBS_keys: Object.keys((mergedState as any).segmentBS || {}).length,
      segmentPL_keys: Object.keys((mergedState as any).segmentPL || {}).length,
      financePL_len: Array.isArray((mergedState as any).financePL) ? (mergedState as any).financePL.length : null,
      stage1Issues_len: Array.isArray((mergedState as any).stage1Issues) ? (mergedState as any).stage1Issues.length : null,
      departments_len: Array.isArray((mergedState as any).departments) ? (mergedState as any).departments.length : 0,
      replacementMode: 'FULL (no merge)',
    });

    // ★ TASK 13-1: Checkpoint 2 - ceoIntent after full replacement
    if (DEBUG) console.log('[SAVE replacement ceoIntent]', {
      len: lenStr((mergedState as any).ceoIntent),
      head: headStr((mergedState as any).ceoIntent),
    });

    const baseRow = buildDbRowFromState(mergedState);

    // ★ TASK 13-1: Checkpoint 3 - ceo_intent in baseRow after buildDbRowFromState
    if (DEBUG) console.log('[SAVE baseRow ceo_intent]', {
      len: lenStr((baseRow as any).ceo_intent),
      head: headStr((baseRow as any).ceo_intent),
    });

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

      // ★ TASK C: save時に kpis と okrs[].keyResults を string[] に正規化（DBに object が入らないようにする）
      const normalizedDepartmentsForSave = ensureArray((mergedState as any).departments).map((d: any) => ({
        ...d,
        projects: ensureArray(d.projects).map((p: any) => ({
          ...p,
          kpis: ensureKpiStringArray(p.kpis), // object → string[] に矯正
          okrs: ensureOkrsNormalized(p.okrs), // okrs[].keyResults も object → string[] に矯正
        })),
      }));

      // ★ CRITICAL: Calculate next revision BEFORE creating payload
      // This ensures revision is always incremented on successful update
      const nextRevision = typeof currentRev === 'number' ? currentRev + 1 : undefined;

      const updatePayload: any = {
        ...baseRow,
        departments: normalizedDepartmentsForSave, // ★ 正規化済みの departments
        finance_pl: (mergedState as any).financePL,
        csv_finance_data: nextCsv,
        user_id: userId,
        company_id: cleanCompanyId,
        updated_at: now,
        /* ★ TASK 6: Track editor metadata for dual-browser detection */
        updated_by: userId, // Add editor user ID to track who made the change
        /* ★ CRITICAL FIX: Application-layer revision increment (not DB trigger dependent) */
        revision: nextRevision, // Increment revision on successful update
      };
      delete updatePayload.created_at;

      // ★ TASK B: Cascade duplicate対策 - departments/projects/okrs/kpis が保存されているか確認
    const cascadeDeptsCounts = Array.isArray((prunedIncoming as any).departments)
      ? (prunedIncoming as any).departments.map((d: any) => ({
          name: d.name,
          projCount: Array.isArray(d.projects) ? d.projects.length : 0,
          projOkrCounts: Array.isArray(d.projects)
            ? d.projects.map((p: any) => ({
                title: p.title,
                okrCount: Array.isArray(p.okrs) ? p.okrs.length : 0,
                kpiCount: Array.isArray(p.kpis) ? p.kpis.length : 0,
              }))
            : [],
        }))
      : [];

    if (process.env.NEXT_PUBLIC_DEBUG_CASCADE_DUP === '1' && cascadeDeptsCounts.length > 0) {
    }

    // ★ TASK 1: Remove win_patterns fields to prevent PGRST204 error
      // These fields don't exist in the DB table strategy_data
      // Removing them proactively prevents UPDATE failure that blocks answers12 save
      delete (updatePayload as any).win_patterns;
      delete (updatePayload as any).win_patterns_candidate;
      delete (updatePayload as any).winPatterns;
      delete (updatePayload as any).winPatternsCandidate;

      // ★ TASK B: Supabase updatePayload に departments が そのまま入っているか確認
      const dep = (updatePayload as any).departments;
      // ★ DEBUG LOG C: DB updatePayload での確認（Object.keys + mission/missionDescription）
      const dept0 = Array.isArray(dep) ? dep[0] : null;

      const depDiag = (Array.isArray(dep) ? dep : []).map((d: any) => ({
        name: d?.name,
        proj: (Array.isArray(d?.projects) ? d.projects : []).map((p: any) => ({
          title: p?.title,
          okrs: Array.isArray(p?.okrs) ? p.okrs.length : 0,
          kpis: Array.isArray(p?.kpis) ? p.kpis.length : 0,
          okrsV2: Array.isArray(p?.okrsV2) ? p.okrsV2.length : 0,
        })),
      }));

      // ★ TASK 13-1: Checkpoint 4 - ceo_intent in updatePayload (most critical)
      if (DEBUG) console.log('[SAVE updatePayload ceo_intent]', {
        len: lenStr((updatePayload as any).ceo_intent),
        head: headStr((updatePayload as any).ceo_intent),
      });

      // ★ TASK 1: answers12 diagnostic in updatePayload (cross-session restore)
      if (DEBUG) console.log('[SAVE updatePayload answers12]', {
        has: 'answers12' in updatePayload,
        len: Array.isArray((updatePayload as any).answers12) ? (updatePayload as any).answers12.length : 'not_array',
        first: Array.isArray((updatePayload as any).answers12) ? (updatePayload as any).answers12[0] : null,
      });

      // ★ TASK 3: Confirmation log that win_patterns are excluded (PGRST204 prevention verified)
      if (DEBUG) console.log('[SAVE updatePayload exclude] win_patterns removed', {
        has_win_patterns: 'win_patterns' in updatePayload,
        has_win_patterns_candidate: 'win_patterns_candidate' in updatePayload,
        has_winPatterns: 'winPatterns' in updatePayload,
        has_winPatternsCandidate: 'winPatternsCandidate' in updatePayload,
      });

      // ★ 診断：companyTargets / finalStory* が updatePayload に入ってるか
      if (DEBUG) console.log('[diag][db:updatePayload]', {
        has_company_targets: Object.prototype.hasOwnProperty.call(updatePayload, 'company_targets'),
        company_targets_type: typeof (updatePayload as any).company_targets,
        company_targets_len: Array.isArray((updatePayload as any).company_targets) ? (updatePayload as any).company_targets.length : null,
        has_final_story_draft: Object.prototype.hasOwnProperty.call(updatePayload, 'final_story_draft'),
        final_story_draft_len: Array.isArray((updatePayload as any).final_story_draft) ? (updatePayload as any).final_story_draft.length : null,
        has_final_story_edited: Object.prototype.hasOwnProperty.call(updatePayload, 'final_story_edited'),
        final_story_edited_len: Array.isArray((updatePayload as any).final_story_edited) ? (updatePayload as any).final_story_edited.length : null,
        has_final_story_final: Object.prototype.hasOwnProperty.call(updatePayload, 'final_story_final'),
        final_story_final_len: Array.isArray((updatePayload as any).final_story_final) ? (updatePayload as any).final_story_final.length : null,
      });

      // ★ 楽観ロック：revision カラムがある場合
      //   - expectedRev は「引数で渡された revision」優先、無ければ currentRev
      //   - UPDATE では expectedRev で衝突検知を行う（.eq('revision', expectedRev)）
      //   - revision の更新（+1）はアプリ層で実施（nextRevision として updatePayload に含める）
      //   - これにより DB trigger 依存が排除され、確実にインクリメントが保証される
      let expectedRev: number | undefined;
      if (hasRevision) {
        expectedRev = typeof revision === 'number' ? revision : currentRev;
      }

      let updateQuery = supabase
        .from(T_STRATEGY)
        .update(updatePayload)
        .eq('company_id', cleanCompanyId);

      // ★ CRITICAL: Optimistic locking maintained
      // The .eq('revision', expectedRev) ensures conflict detection
      // If another session changed the revision, UPDATE affects 0 rows
      // This triggers REVISION_CONFLICT error (see lines 1825+)
      if (hasRevision && typeof expectedRev === 'number') {
        updateQuery = updateQuery.eq('revision', expectedRev);
      }

      // ★重要：UPDATEの戻り値は必ず「全列」を返す（部分列だと store を壊す）
      const upd = await updateQuery.select('*').maybeSingle();

      // ★ CRITICAL TEST: Verify revision increment succeeded
      if (upd.data) {
        const returnedRevision = (upd.data as any)?.revision;
        if (returnedRevision !== nextRevision) {
          console.error('[SAVE] ⚠️ REVISION MISMATCH:', {
            sent: nextRevision,
            received: returnedRevision,
            message: 'Application revision increment may have failed',
          });
        }
      }

      if (upd.error) {
        // ★ PGRST204 フォールバック：列が未作成の場合は除外して再試行（保険）
        if (isPGRST204Error(upd.error)) {
          const missingCol = extractColumnFromPGRST204(String(upd.error?.message || upd.error?.details || ''));
          if (missingCol) {
            console.warn(
              `[StrategyData] ⚠ PGRST204: Column "${missingCol}" not found. Retrying without it.`,
            );

            // 問題のある列を payload から除外
            const retryPayload = { ...updatePayload };
            delete (retryPayload as any)[missingCol];

            // 1回だけ再試行
            let retryQuery = supabase
              .from(T_STRATEGY)
              .update(retryPayload)
              .eq('company_id', cleanCompanyId);

            if (hasRevision && typeof expectedRev === 'number') {
              retryQuery = retryQuery.eq('revision', expectedRev);
            }

            const retryUpd = await retryQuery.select('*').maybeSingle();

            if (retryUpd.error) {
              console.error(
                '[StrategyData] ❌ update retry failed (after removing',
                missingCol,
                '):',
                extractErrorVerbose(retryUpd.error),
              );
              return { data: null, error: extractErrorVerbose(retryUpd.error) };
            }

            if (retryUpd.data) {
              console.warn(
                `[StrategyData] ✅ Save succeeded without column: ${missingCol}. DB may not have this column yet.`,
              );
              // retryUpd.data で続行（upd を retryUpd に置き換える）
              Object.assign(upd, retryUpd);
            } else {
              return {
                data: null,
                error: {
                  code: 'REVISION_CONFLICT',
                  message: 'Data was modified by another session. Please refresh and try again.',
                },
              };
            }
          } else {
            console.error(
              '[StrategyData] ❌ update failed (PGRST204 but could not extract column):',
              extractErrorVerbose(upd.error),
            );
            return { data: null, error: extractErrorVerbose(upd.error) };
          }
        } else {
          console.error(
            '[StrategyData] ❌ update failed:',
            extractErrorVerbose(upd.error),
          );
          return { data: null, error: extractErrorVerbose(upd.error) };
        }
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

        // ★ TASK 13-1: Checkpoint 5 - ceo_intent in returned data from UPDATE
        if (DEBUG) console.log('[SAVE returned ceo_intent]', {
          len: lenStr((upd.data as any).ceo_intent),
          head: headStr((upd.data as any).ceo_intent),
        });

        // ★ TASK 1: answers12 diagnostic in returned UPDATE data
        if (DEBUG) console.log('[SAVE returned answers12]', {
          has: 'answers12' in (upd.data as any),
          len: Array.isArray((upd.data as any)?.answers12) ? (upd.data as any).answers12.length : 'not_array',
          first: Array.isArray((upd.data as any)?.answers12) ? (upd.data as any).answers12[0] : null,
        });

        // ★ 診断：返却row に companyTargets / finalStory* が乗ってるか
        if (DEBUG) console.log('[diag][db:return_row]', {
          company_targets_len: Array.isArray((upd.data as any)?.company_targets) ? (upd.data as any).company_targets.length : null,
          final_story_draft_len: Array.isArray((upd.data as any)?.final_story_draft) ? (upd.data as any).final_story_draft.length : null,
          final_story_edited_len: Array.isArray((upd.data as any)?.final_story_edited) ? (upd.data as any).final_story_edited.length : null,
          final_story_final_len: Array.isArray((upd.data as any)?.final_story_final) ? (upd.data as any).final_story_final.length : null,
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

    // ★ TASK STAGE6: DB保存直後の診断ログ（companyTargets / projectTargetImpacts/Links の確認 - INSERT版）
    if (DEBUG) {
      if (ins.data) {
        console.log('[SAVE INSERT response] company_targets/project_target_impacts/links in data', {
          has_company_targets: 'company_targets' in (ins.data as any),  // ★ 追加
          company_targets_len: Array.isArray((ins.data as any)?.company_targets) ? (ins.data as any).company_targets.length : null,  // ★ 追加
          has_project_target_impacts: 'project_target_impacts' in (ins.data as any),
          is_array_impacts: Array.isArray((ins.data as any)?.project_target_impacts),
          impacts_len: Array.isArray((ins.data as any)?.project_target_impacts) ? (ins.data as any).project_target_impacts.length : null,
          has_project_issue_links: 'project_issue_links' in (ins.data as any),
          is_array_links: Array.isArray((ins.data as any)?.project_issue_links),
          links_len: Array.isArray((ins.data as any)?.project_issue_links) ? (ins.data as any).project_issue_links.length : null,
        });
      }
    }

    if (ins.error) {
      // ★ PGRST204 フォールバック：列が未作成の場合は除外して再試行（保険）
      if (isPGRST204Error(ins.error)) {
        const missingCol = extractColumnFromPGRST204(String(ins.error?.message || ins.error?.details || ''));
        if (missingCol) {
          console.warn(
            `[StrategyData] ⚠ PGRST204: Column "${missingCol}" not found. Retrying INSERT without it.`,
          );

          // 問題のある列を payload から除外
          const retryPayload = { ...insertPayload };
          delete (retryPayload as any)[missingCol];

          // 1回だけ再試行
          const retryIns = await supabase
            .from(T_STRATEGY)
            .insert(retryPayload)
            .select('*')
            .single();

          if (retryIns.error) {
            console.error(
              '[StrategyData] ❌ insert retry failed (after removing',
              missingCol,
              '):',
              extractErrorVerbose(retryIns.error),
            );
            return { data: null, error: extractErrorVerbose(retryIns.error) };
          }

          if (retryIns.data) {
            console.warn(
              `[StrategyData] ✅ Insert succeeded without column: ${missingCol}. DB may not have this column yet.`,
            );
            // retryIns.data で続行（ins を retryIns に置き換える）
            Object.assign(ins, retryIns);
          } else {
            return { data: null, error: { message: 'INSERT failed: no data returned' } };
          }
        } else {
          console.error(
            '[StrategyData] ❌ insert failed (PGRST204 but could not extract column):',
            extractErrorVerbose(ins.error),
          );
          return { data: null, error: extractErrorVerbose(ins.error) };
        }
      } else {
        return { data: null, error: extractErrorVerbose(ins.error) };
      }
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

/**
 * Load progress logs for company scope
 * Used by STAGE6 for execution weight calculation
 */
export async function loadProgressLogs(
  companyId: string,
  options?: {
    limit?: number;
    fromDate?: string;
  }
): Promise<{ data: any[] | null; error: any | null }> {
  try {
    let query = supabase
      .from(T_PROGRESS)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.fromDate) {
      query = query.gte('created_at', options.fromDate);
    }

    const { data, error } = await query;

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
