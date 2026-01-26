// /utils/supabase/normalize.ts
import type {
  StrategyData,
  ChapterStory,
  Department,
  Project,
  OKR,
  ChapterAnswers,
  KRStructured,
  ProjectRole,
  FinancePLRow,
  FinanceBSRow,
  SegmentBSRow,
} from '@/types/strategy';

/** GROWTH 固定タイトル（章タイトルはUIで固定表示） */
const GROWTH_TITLES = [
  '第1章：なぜ今（現状の危機と背景）',
  '第2章：どう戦う（選択と集中の戦略）',
  '第3章：どんな未来像（顧客の風景で描く）',
  '第4章：どう行動する（社員一人ひとりの役割と決意）',
] as const;

/* =====================================================================
 * 基本ユーティリティ
 * ===================================================================== */
const toStr = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);

function tryParseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseIfJsonString<T = unknown>(v: unknown): T | unknown {
  if (typeof v === 'string') {
    const p = tryParseJson<T>(v);
    return p ?? v;
  }
  return v;
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** csvFinanceData が「配列で包まれている」旧互換を吸収（[ {..} ] -> {..}） */
function unwrapSingleObjectArray(v: unknown): Record<string, any> | undefined {
  if (Array.isArray(v) && v.length === 1 && isPlainObject(v[0])) return v[0] as any;
  if (isPlainObject(v)) return v as any;
  return undefined;
}

/* =====================================================================
 * story / finalStory 正規化（非破壊・階層維持＝配列のまま）
 * ===================================================================== */

/** 単文文字列も1章として採用。未入力は undefined を返し、保存スキップを誘導 */
function toChapterArraySafe(input: unknown): ChapterStory[] | undefined {
  if (input == null) return undefined;

  if (Array.isArray(input)) {
    const arr: ChapterStory[] = [];
    for (const it of input) {
      if (!it) continue;
      if (typeof it === 'string') {
        const s = it.trim();
        if (s) arr.push({ title: '', body: s });
      } else if (typeof it === 'object') {
        const t = typeof (it as any).title === 'string' ? (it as any).title : '';
        const b = typeof (it as any).body === 'string' ? (it as any).body : '';
        if (t || b) arr.push({ title: t, body: b });
      }
    }
    return arr.length ? arr : undefined;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const parsed = tryParseJson<any>(trimmed);
    if (parsed && typeof parsed === 'object') {
      return toChapterArraySafe(parsed);
    }
    return [{ title: '', body: trimmed }];
  }

  if (typeof input === 'object') {
    // オブジェクトは key-value を章化（既存互換用）
    const arr: ChapterStory[] = [];
    for (const k of Object.keys(input as any)) {
      const v = (input as any)[k];
      if (v == null) continue;
      const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
      if (s) arr.push({ title: String(k ?? ''), body: s });
    }
    return arr.length ? arr : undefined;
  }

  return undefined;
}

function uniqChapters(chs?: ChapterStory[]): ChapterStory[] {
  if (!chs || !chs.length) return [];
  const seen = new Set<string>();
  const out: ChapterStory[] = [];
  for (const c of chs) {
    const title = typeof c?.title === 'string' ? c.title : '';
    const body = typeof c?.body === 'string' ? c.body : '';
    const key = `${title.trim()}::${body.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ title, body });
    }
  }
  return out;
}

/** 可能ならGROWTH順に寄せるが、配列構造のまま返す（空は undefined） */
function alignToGrowthOrderSafe(chs?: ChapterStory[]): ChapterStory[] | undefined {
  const base = uniqChapters(chs);
  if (!base.length) return undefined;

  const buckets = [
    { keys: ['なぜ今', '現状', '危機', '背景'] },
    { keys: ['どう戦う', '戦略', '選択', '集中', 'トレードオフ'] },
    { keys: ['未来像', '未来', 'どこへ', 'ビジョン', '顧客の風景'] },
    { keys: ['どう行動する', '行動', '社員', '当事者', 'オーナー'] },
  ];
  const used = new Set<number>();
  const scoreOf = (text: string, keys: string[]) =>
    keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);

  const ordered: ChapterStory[] = [];
  for (const b of buckets) {
    let bestIdx = -1;
    let bestScore = -1;
    base.forEach((c, idx) => {
      if (used.has(idx)) return;
      const hay = `${c?.title ?? ''}${c?.body ?? ''}`;
      const sc = scoreOf(hay, b.keys);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = idx;
      }
    });
    ordered.push(
      bestIdx >= 0 ? ((used.add(bestIdx), base[bestIdx]) && base[bestIdx]) : { title: '', body: '' },
    );
  }

  const final = ordered.slice(0, 4).map((c, i) => ({
    title: GROWTH_TITLES[i],
    body: (c?.body ?? '').trim(),
  }));

  if (final.every((c) => !c.body)) return undefined;
  return final;
}

export function normalizeChaptersAnyNonDestructive(input: unknown): ChapterStory[] | undefined {
  const arr = toChapterArraySafe(input);
  return alignToGrowthOrderSafe(arr);
}

// 互換のためのエクスポート（ancillary.ts など旧コードが参照）
export function normalizeChaptersAny(input: unknown): ChapterStory[] | null {
  return normalizeChaptersAnyNonDestructive(input) ?? null;
}

/* =====================================================================
 * departments 正規化（非破壊・情報を落とさない）
 * ===================================================================== */

type AnyOKR =
  | { id?: unknown; objective?: unknown; keyResults?: unknown; owner?: unknown }
  | (OKR & Record<string, any>)
  | null
  | undefined;

type AnyProject =
  | (Project & {
      okrs?: unknown;
      okrsV2?: unknown;
      roles?: unknown;
      objective?: unknown;
      keyResults?: unknown;
      owner?: unknown;
    })
  | null
  | undefined;

type AnyDepartment =
  | (Department & {
      title?: unknown;
      projects?: unknown;
      questions?: unknown;
      answers2?: unknown;
    })
  | null
  | undefined;

function normalizeOKR(input: AnyOKR): OKR {
  const raw = (input || {}) as any;
  const base: any = { ...raw };

  const id = raw.id != null ? String(raw.id) : undefined;
  const objective =
    typeof raw.objective === 'string'
      ? raw.objective
      : raw.objective != null
      ? String(raw.objective)
      : '';
  const keyResults = Array.isArray(raw.keyResults)
    ? raw.keyResults.map((k: any) => String(k))
    : [];
  const owner =
    raw.owner !== undefined && raw.owner !== null && String(raw.owner) !== ''
      ? String(raw.owner)
      : undefined;

  base.id = id;
  base.objective = objective;
  base.keyResults = keyResults;
  base.owner = owner;

  return base as OKR;
}

function normalizeProject(p: AnyProject): Project {
  const obj = (p || {}) as any;
  const base: any = { ...obj };

  const title =
    typeof obj.title === 'string'
      ? obj.title
      : typeof obj.name === 'string'
      ? obj.name
      : '';
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined;

  const legacy =
    obj.objective || obj.keyResults || obj.owner
      ? [
          normalizeOKR({
            id: obj.id,
            objective: String(obj.objective ?? ''),
            keyResults: Array.isArray(obj.keyResults)
              ? obj.keyResults.map((k: any) => String(k))
              : [],
            owner: obj.owner ? String(obj.owner) : undefined,
          }),
        ]
      : [];

  const okrsRaw = Array.isArray(obj.okrs) ? obj.okrs.map(normalizeOKR) : [];
  const okrs: OKR[] = [...legacy, ...okrsRaw];

  const okrsV2: KRStructured[] | undefined = Array.isArray(obj.okrsV2)
    ? (obj.okrsV2 as any[]).map((r) => ({
        id: String(r?.id ?? ''),
        kind: r?.kind,
        label: String(r?.label ?? ''),
        target: Number(r?.target ?? 0),
        unit: r?.unit,
        due: typeof r?.due === 'string' ? r.due : undefined,
        owner: typeof r?.owner === 'string' ? r.owner : undefined,
        scope: r?.scope,
        baseKey: r?.baseKey,
        baseOverride: r?.baseOverride != null ? Number(r.baseOverride) : undefined,
        weight: r?.weight != null ? Number(r.weight) : undefined,
        elasticity: r?.elasticity != null ? Number(r.elasticity) : undefined,
        lagMonths: r?.lagMonths != null ? Number(r.lagMonths) : undefined,
        startYm: typeof r?.startYm === 'string' ? r.startYm : undefined,
        notes: typeof r?.notes === 'string' ? r.notes : undefined,
      }))
    : undefined;

  const roles: ProjectRole[] | undefined = Array.isArray(obj.roles)
    ? (obj.roles as any[]).map((rr) => ({
        role: String(rr?.role ?? ''),
        okrs: Array.isArray(rr?.okrs)
          ? (rr.okrs as any[]).map((r) => ({
              id: String(r?.id ?? ''),
              kind: r?.kind,
              label: String(r?.label ?? ''),
              target: Number(r?.target ?? 0),
              unit: r?.unit,
              due: typeof r?.due === 'string' ? r.due : undefined,
              owner: typeof r?.owner === 'string' ? r.owner : undefined,
              scope: r?.scope,
              baseKey: r?.baseKey,
              baseOverride: r?.baseOverride != null ? Number(r.baseOverride) : undefined,
              weight: r?.weight != null ? Number(r.weight) : undefined,
              elasticity: r?.elasticity != null ? Number(r.elasticity) : undefined,
              lagMonths: r?.lagMonths != null ? Number(r.lagMonths) : undefined,
              startYm: typeof r?.startYm === 'string' ? r.startYm : undefined,
              notes: typeof r?.notes === 'string' ? r.notes : undefined,
            }))
          : [],
      }))
    : undefined;

  base.title = title;
  base.okrs = okrs;
  if (reason !== undefined) base.reason = reason;
  if (okrsV2 && okrsV2.length) base.okrsV2 = okrsV2;
  if (roles && roles.length) base.roles = roles;

  return base as Project;
}

function normalizeDepartment(d: AnyDepartment): Department {
  const obj = (d || {}) as any;
  const base: any = { ...obj };

  const id = obj.id != null ? obj.id : undefined;
  const name =
    typeof obj.name === 'string'
      ? obj.name
      : typeof obj.title === 'string'
      ? obj.title
      : '';
  const mission = typeof obj.mission === 'string' ? obj.mission : '';
  const strategy = typeof obj.strategy === 'string' ? obj.strategy : undefined;
  const missionDraft = typeof obj.missionDraft === 'string' ? obj.missionDraft : undefined;
  const discussionNotes = typeof obj.discussionNotes === 'string' ? obj.discussionNotes : undefined;

  const questions = Array.isArray(obj.questions)
    ? (obj.questions as any[]).map((q) => ({
        stepNumber: Number(q?.stepNumber ?? 0),
        question: String(q?.question ?? ''),
        reason: String(q?.reason ?? ''),
        answer: String(q?.answer ?? ''),
      }))
    : undefined;

  const answers2: ChapterAnswers[] | undefined = Array.isArray(obj.answers2)
    ? (obj.answers2 as any[]).map((c, idx) => ({
        chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : idx,
        chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : `Chapter ${idx + 1}`,
        steps: Array.isArray(c?.steps)
          ? [...c.steps]
              .map((s) => ({
                stepNumber: Number(s?.stepNumber ?? 0),
                question: String(s?.question ?? ''),
                reason: String(s?.reason ?? ''),
                answer: String(s?.answer ?? ''),
              }))
              .sort((a, b) => a.stepNumber - b.stepNumber)
          : [],
      }))
    : undefined;

  const finalized = Boolean(obj.finalized);
  const projectsRaw = Array.isArray(obj.projects) ? obj.projects : [];
  const projects = projectsRaw.map(normalizeProject);

  base.id = id;
  base.name = name;
  base.mission = mission;
  base.projects = projects;
  base.finalized = finalized;
  if (strategy !== undefined) base.strategy = strategy;
  if (missionDraft !== undefined) base.missionDraft = missionDraft;
  if (discussionNotes !== undefined) base.discussionNotes = discussionNotes;
  if (questions && questions.length) base.questions = questions;
  if (answers2 && answers2.length) base.answers2 = answers2;

  return base as Department;
}

export function normalizeDepartmentsAny(input: unknown): Department[] | undefined {
  if (!input) return undefined;
  const src = parseIfJsonString<any>(input);

  if (Array.isArray(src)) {
    const arr = (src as unknown[]).map((v) => normalizeDepartment(v as AnyDepartment));
    return arr.length ? arr : undefined;
  }
  if (src && typeof src === 'object' && Array.isArray((src as any).departments)) {
    const arr = ((src as any).departments as unknown[]).map((v) =>
      normalizeDepartment(v as AnyDepartment),
    );
    return arr.length ? arr : undefined;
  }
  return undefined;
}

/* =====================================================================
 * finance / business_portfolio 正規化
 * 重要: 「空」は undefined を返す（＝保存スキップ）
 * ===================================================================== */

/**
 * csvFinanceData 正規化（型互換を優先）
 * - DB csv_finance_data には financeBS/segmentPL/segmentBS/hqAdjustmentPL/BS を格納
 * - 配列の場合は unwrapSingleObjectArray で剥がす（旧互換）
 * - オブジェクトの場合はそのまま返す（financeBS/segmentPL 等を内包）
 * - 返り値: オブジェクト | undefined
 */
function normalizeCsvFinanceDataLoose(input: unknown): Record<string, any> | undefined {
  if (input == null) return undefined;

  const parsed = parseIfJsonString<any>(input);

  // オブジェクトの場合：キーが financeBS/segmentPL/segmentBS など財務系ならそのまま返す
  if (isPlainObject(parsed)) {
    const keys = Object.keys(parsed);
    const hasFinanceKeys = keys.some(
      (k) => k === 'financeBS' || k === 'segmentPL' || k === 'segmentBS' ||
             k === 'finance_bs' || k === 'segment_pl' || k === 'segment_bs' ||
             k === 'hqAdjustmentPL' || k === 'hqAdjustmentBS'
    );
    // 財務系キーがあれば、このオブジェクトが csvFinanceData
    if (hasFinanceKeys) return parsed;
    // それ以外も空でなければ返す（後方互換）
    if (keys.length > 0) return parsed;
    return undefined;
  }

  // 配列の場合：1要素なら剥がす、複数要素ならCSV扱い（旧互換、現在は未使用）
  if (Array.isArray(parsed)) {
    if (parsed.length === 1 && isPlainObject(parsed[0])) {
      const obj = parsed[0] as any;
      if (isPlainObject(obj)) return obj;
    }
    // 複数要素の配列は CSV 扱い（現在は使用されていない）
    return undefined;
  }

  // 素の文字列 CSV（現在は使用されていない）
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return undefined;
    // CSV は未使用なので undefined
    return undefined;
  }

  return undefined;
}

type PortfolioLike = {
  units?: unknown;
  threshold?: { growthBaseline?: unknown; profitBaseline?: unknown };
  currency?: unknown;
  periodLabel?: unknown;
  unitType?: unknown;
};

function normalizeBusinessPortfolio(input: unknown): Record<string, any> | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<Record<string, any>>(input);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;

  const bp = p as PortfolioLike;
  const validUnits = Array.isArray(bp.units) && bp.units.length > 0;
  if (!validUnits) return undefined;

  return p;
}

function normalizeFinanceSummaryObject(input: unknown): any[] | undefined {
  if (input == null) return undefined;
  const p = parseIfJsonString<any>(input);

  if (Array.isArray(p)) return p.length > 0 ? p : undefined;

  if (p && typeof p === 'object' && Array.isArray((p as any).rows)) {
    const arr = (p as any).rows;
    return arr.length > 0 ? arr : undefined;
  }

  if (p && typeof p === 'object' && Array.isArray((p as any).items)) {
    const arr = (p as any).items;
    return arr.length > 0 ? arr : undefined;
  }

  if (p && typeof p === 'object') {
    const entries = Object.entries(p as Record<string, any>);
    if (entries.length > 0 && entries.every(([, v]) => typeof v === 'object')) {
      const arr = entries.map(([year, data]) => ({ year: Number(year), ...data }));
      return arr.length > 0 ? arr : undefined;
    }
  }

  return undefined;
}

/* -----------------------------
 * STAGE1 財務（BS / セグメント）正規化（復元用）
 * ----------------------------- */

function normalizeFinanceBSRows(input: unknown): FinanceBSRow[] | undefined {
  const p = parseIfJsonString<any>(input);
  if (!Array.isArray(p)) return undefined;
  const arr = (p as any[])
    .map((r) => {
      if (!r) return null;
      const year = Number((r as any).year);
      if (!Number.isFinite(year)) return null;
      const row: FinanceBSRow = { ...(r as any), year } as any;
      return row;
    })
    .filter(Boolean) as FinanceBSRow[];
  return arr.length > 0 ? arr : undefined;
}

function normalizeSegmentPLRecord(input: unknown): Record<string, FinancePLRow[]> | undefined {
  const p = parseIfJsonString<any>(input);
  if (!isPlainObject(p)) return undefined;
  const out: Record<string, FinancePLRow[]> = {};
  for (const [k, v] of Object.entries(p)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const rows = Array.isArray(v)
      ? (v as any[])
          .map((r) => {
            if (!r) return null;
            const year = Number((r as any).year);
            if (!Number.isFinite(year)) return null;
            return { ...(r as any), year } as FinancePLRow;
          })
          .filter(Boolean) as FinancePLRow[]
      : [];
    if (rows.length > 0) out[key] = rows;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSegmentBSRecord(input: unknown): Record<string, SegmentBSRow[]> | undefined {
  const p = parseIfJsonString<any>(input);
  if (!isPlainObject(p)) return undefined;
  const out: Record<string, SegmentBSRow[]> = {};
  for (const [k, v] of Object.entries(p)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const rows = Array.isArray(v)
      ? (v as any[])
          .map((r) => {
            if (!r) return null;
            const year = Number((r as any).year);
            if (!Number.isFinite(year)) return null;
            return { ...(r as any), year } as SegmentBSRow;
          })
          .filter(Boolean) as SegmentBSRow[]
      : [];
    if (rows.length > 0) out[key] = rows;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* =====================================================================
 * StrategyData 正規化（全体・非破壊）
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | unknown | null): StrategyData {
  const src: any = { ...(input ?? {}) };

  // story 系は配列のまま
  const storyIn = src.story ?? src.story_draft ?? src.story_final ?? undefined;
  const story =
    normalizeChaptersAnyNonDestructive(storyIn) ??
    (Array.isArray(src.story) ? src.story : []);

  const finalStoryIn = src.finalStory ?? src.final_story ?? undefined;
  const finalStory =
    normalizeChaptersAnyNonDestructive(finalStoryIn) ??
    (Array.isArray(src.finalStory)
      ? src.finalStory
      : Array.isArray(src.final_story)
      ? src.final_story
      : undefined);

  // answers2
  const answers2Top = Array.isArray(src.answers2) ? src.answers2 : undefined;
  const answers2FromStory =
    src.story && typeof src.story === 'object' && Array.isArray((src.story as any).answers2)
      ? (src.story as any).answers2
      : undefined;
  const answers2: ChapterAnswers[] = answers2Top ?? (answers2FromStory ?? []);

  // 部門
  const departmentsNorm = normalizeDepartmentsAny(src.departments);
  const departments =
    departmentsNorm ??
    (Array.isArray(src.departments) ? (src.departments as Department[]) : []);

  // 財務：csvFinanceData はオブジェクトとして保持（financeBS/segmentPL/segmentBS を内包）
  const csvFinanceData = normalizeCsvFinanceDataLoose(
    src.csvFinanceData ?? src.csv_financeData ?? src.csv_finance_data ?? src.csv_financeData,
  );

  // csvObj は csvFinanceData 本体（normalizeCsvFinanceDataLoose で既に正規化済み）
  const csvObj = csvFinanceData ?? (isPlainObject(src.csvFinanceData) ? src.csvFinanceData : undefined);

  const financePL = Array.isArray(src.financePL)
    ? src.financePL.length > 0
      ? src.financePL
      : undefined
    : Array.isArray(src.finance_pl)
    ? src.finance_pl.length > 0
      ? src.finance_pl
      : undefined
    : (csvObj && Array.isArray((csvObj as any).financePL) && (csvObj as any).financePL.length > 0)
    ? (csvObj as any).financePL
    : (csvObj && Array.isArray((csvObj as any).finance_pl) && (csvObj as any).finance_pl.length > 0)
    ? (csvObj as any).finance_pl
    : undefined;

  // ★ 全社BS
  const financeBS =
    normalizeFinanceBSRows(src.financeBS) ??
    normalizeFinanceBSRows(src.finance_bs) ??
    (csvObj ? normalizeFinanceBSRows((csvObj as any).financeBS) : undefined) ??
    (csvObj ? normalizeFinanceBSRows((csvObj as any).finance_bs) : undefined);

  // ★ 事業部別PL/BS
  const segmentPL =
    normalizeSegmentPLRecord(src.segmentPL) ??
    normalizeSegmentPLRecord(src.segment_pl) ??
    (csvObj ? normalizeSegmentPLRecord((csvObj as any).segmentPL) : undefined) ??
    (csvObj ? normalizeSegmentPLRecord((csvObj as any).segment_pl) : undefined);

  const segmentBS =
    normalizeSegmentBSRecord(src.segmentBS) ??
    normalizeSegmentBSRecord(src.segment_bs) ??
    (csvObj ? normalizeSegmentBSRecord((csvObj as any).segmentBS) : undefined) ??
    (csvObj ? normalizeSegmentBSRecord((csvObj as any).segment_bs) : undefined);

  const businessSegments = Array.isArray(src.businessSegments)
    ? src.businessSegments.length > 0
      ? src.businessSegments
      : undefined
    : Array.isArray(src.business_segments)
    ? src.business_segments.length > 0
      ? src.business_segments
      : undefined
    : (csvObj && Array.isArray((csvObj as any).businessSegments) && (csvObj as any).businessSegments.length > 0)
    ? (csvObj as any).businessSegments
    : (csvObj && Array.isArray((csvObj as any).business_segments) && (csvObj as any).business_segments.length > 0)
    ? (csvObj as any).business_segments
    : undefined;

  const businessPortfolio = normalizeBusinessPortfolio(
    src.businessPortfolio ?? src.business_portfolio,
  );
  const financeSummary = normalizeFinanceSummaryObject(
    src.financeSummary ?? src.finance_summary,
  );

  // プロフィール/MVV/SWOT
  const companyName = toStr(src.companyName ?? '');
  const foundationYear = toStr(src.foundationYear ?? '');
  const location = toStr(src.location ?? '');
  const industry = toStr(src.industry ?? '');
  const revenue = toStr(src.revenue ?? '');
  const employees = toStr(src.employees ?? '');
  const businessContent = toStr(src.businessContent ?? '');
  const customerSegment = toStr(src.customerSegment ?? '');

  const thought = toStr(src.thought ?? '');
  const mission = toStr(src.mission ?? '');
  const vision = toStr(src.vision ?? '');
  const value = toStr(src.value ?? '');

  const strength = toStr(src.strength ?? '');
  const weakness = toStr(src.weakness ?? '');
  const opportunity = toStr(src.opportunity ?? '');
  const threat = toStr(src.threat ?? '');

  // ★ 修正：stage1Issues を保持
  const stage1Issues = Array.isArray(src.stage1Issues) ? src.stage1Issues : undefined;

  // ★ 修正：stage1Benchmarks を保持
  const stage1Benchmarks = src.stage1Benchmarks && typeof src.stage1Benchmarks === 'object'
    ? src.stage1Benchmarks
    : undefined;

  // ★ 修正：上場情報（isListed, ticker, pbrManual）を保持
  const isListed = typeof src.isListed === 'boolean' ? src.isListed : undefined;
  const ticker = toStr(src.ticker ?? '');
  const pbrManual = toStr(src.pbrManual ?? '');

  const out: StrategyData = {
    id: src.id,
    user_id: src.user_id,
    company_id: src.company_id,
    created_at: src.created_at,
    updated_at: src.updated_at,
    updated_by: src.updated_by,
    strategyId: src.strategyId ?? src.strategy_id,
    userId: src.userId,
    companyId: src.companyId,
    createdAt: src.createdAt,
    updatedAt: src.updatedAt,

    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,

    story,
    finalStory,

    strategySummary: src.strategySummary,
    questions: Array.isArray(src.questions) ? src.questions : undefined,
    reasons: Array.isArray(src.reasons) ? src.reasons : undefined,
    questions2: Array.isArray(src.questions2) ? src.questions2 : undefined,
    reasons2: Array.isArray(src.reasons2) ? src.reasons2 : undefined,
    answers: Array.isArray(src.answers) ? src.answers : undefined,

    answers2,
    departments,
    stage1Issues,  // ★ 修正：stage1Issues を出力オブジェクトに含める
    stage1Benchmarks,  // ★ 修正：stage1Benchmarks を出力オブジェクトに含める

    editableCascadeResult: Array.isArray(src.editableCascadeResult)
      ? src.editableCascadeResult
      : undefined,
    editableCascade: src.editableCascade,

    // ★ 修正：上場情報フィールドを出力オブジェクトに含める
    ...(isListed !== undefined ? { isListed } : {}),
    ...(ticker ? { ticker } : {}),
    ...(pbrManual ? { pbrManual } : {}),

    ...(csvFinanceData !== undefined ? { csvFinanceData } : {}),
    ...(financePL !== undefined ? { financePL } : {}),
    ...(financeBS !== undefined ? { financeBS } : {}),
    ...(segmentPL !== undefined ? { segmentPL } : {}),
    ...(segmentBS !== undefined ? { segmentBS } : {}),
    ...(businessSegments !== undefined ? { businessSegments } : {}),
    ...(businessPortfolio !== undefined ? { businessPortfolio } : {}),
    ...(financeSummary !== undefined ? { financeSummary } : {}),

    notification: typeof src.notification === 'string' ? src.notification : undefined,
    role: src.role,
  };

  return out;
}
