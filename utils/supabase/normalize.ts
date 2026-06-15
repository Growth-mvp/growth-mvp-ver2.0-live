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
  CompanyTarget,
  WinPatternCandidate,
  Stage2Answer,
} from '@/types/strategy';
import { ensureDepartmentId, ensureProjectId } from './stableIdGenerator';

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

function normalizeProject(
  p: AnyProject,
  strategyId?: string,
  departmentId?: string,
  laneType?: 'existing' | 'new',
): Project {
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
        // ★ 修正：milestones を保持（リロード後に消える問題を解決）
        milestones: Array.isArray(r?.milestones)
          ? r.milestones.map((m: any) => ({
              id: String(m?.id ?? ''),
              title: String(m?.title ?? ''),
              dueYm: typeof m?.dueYm === 'string' ? m.dueYm : undefined,
              owner: typeof m?.owner === 'string' ? m.owner : undefined,
              status: typeof m?.status === 'string' ? (m.status as any) : undefined,
              dod: typeof m?.dod === 'string' ? m.dod : undefined,
            }))
          : undefined,
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
              // ★ 修正：milestones を保持（リロード後に消える問題を解決）
              milestones: Array.isArray(r?.milestones)
                ? r.milestones.map((m: any) => ({
                    id: String(m?.id ?? ''),
                    title: String(m?.title ?? ''),
                    dueYm: typeof m?.dueYm === 'string' ? m.dueYm : undefined,
                    owner: typeof m?.owner === 'string' ? m.owner : undefined,
                    status: typeof m?.status === 'string' ? (m.status as any) : undefined,
                    dod: typeof m?.dod === 'string' ? m.dod : undefined,
                  }))
                : undefined,
            }))
          : [],
      }))
    : undefined;

  base.title = title;
  base.okrs = okrs;
  if (reason !== undefined) base.reason = reason;
  if (okrsV2 && okrsV2.length) base.okrsV2 = okrsV2;
  if (roles && roles.length) base.roles = roles;

  // ★ NEW: Ensure project has stable id (if strategyId and departmentId provided)
  if (strategyId && departmentId && title) {
    const projWithId = ensureProjectId(strategyId, departmentId, base, laneType || 'existing');
    base.id = projWithId.id;
  }

  return base as Project;
}

function normalizeDepartment(d: AnyDepartment, strategyId?: string): Department {
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
  const missionDescription = typeof obj.missionDescription === 'string' ? obj.missionDescription : undefined;
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

  // ★ NEW: Ensure department has stable id (if strategyId provided)
  let deptId = id;
  if (strategyId && name && !deptId) {
    const deptWithId = ensureDepartmentId(strategyId, { ...base, name });
    deptId = deptWithId.id;
  }

  // ★ NEW: Normalize projects with strategyId and departmentId context
  const projects = projectsRaw.map((p: any) => normalizeProject(p, strategyId, deptId, 'existing'));

  // ★ lanes 正規化（existing/new の projects を normalizeProject を通す）
  const lanes =
    obj.lanes && typeof obj.lanes === 'object'
      ? {
          existing:
            obj.lanes.existing && typeof obj.lanes.existing === 'object' && Array.isArray(obj.lanes.existing.projects)
              ? { projects: obj.lanes.existing.projects.map((p: any) => normalizeProject(p, strategyId, deptId, 'existing')) }
              : undefined,
          new:
            obj.lanes.new && typeof obj.lanes.new === 'object' && Array.isArray(obj.lanes.new.projects)
              ? { projects: obj.lanes.new.projects.map((p: any) => normalizeProject(p, strategyId, deptId, 'new')) }
              : undefined,
        }
      : undefined;

  // ★ segmentName 正規化
  const segmentName = typeof obj.segmentName === 'string' ? obj.segmentName : undefined;

  // ★ 事業・部門別戦略の観点（4フィールド）を正規化
  const currentPosition = typeof obj.currentPosition === 'string' && obj.currentPosition.trim() ? obj.currentPosition.trim() : undefined;
  const strategicRole = typeof obj.strategicRole === 'string' && obj.strategicRole.trim() ? obj.strategicRole.trim() : undefined;
  const keyIssues = Array.isArray(obj.keyIssues) && obj.keyIssues.length > 0
    ? obj.keyIssues.filter((v: any) => typeof v === 'string' && v.trim()).map((v: any) => v.trim())
    : undefined;
  const alignmentRiskPoints = Array.isArray(obj.alignmentRiskPoints) && obj.alignmentRiskPoints.length > 0
    ? obj.alignmentRiskPoints.filter((v: any) => typeof v === 'string' && v.trim()).map((v: any) => v.trim())
    : undefined;

  base.id = deptId;
  base.name = name;
  base.mission = mission ?? '';  // ★ FIXED: mission を常に保持
  base.missionDescription = missionDescription ?? '';  // ★ FIXED: missionDescription を常に保持
  base.projects = projects;
  base.finalized = finalized;
  if (strategy !== undefined) base.strategy = strategy;
  if (missionDraft !== undefined) base.missionDraft = missionDraft;
  if (discussionNotes !== undefined) base.discussionNotes = discussionNotes;
  if (questions && questions.length) base.questions = questions;
  if (answers2 && answers2.length) base.answers2 = answers2;
  if (lanes && (lanes.existing || lanes.new)) base.lanes = lanes;
  if (segmentName !== undefined) base.segmentName = segmentName;

  // ★ 事業・部門別戦略の観点4フィールドを保持
  if (currentPosition !== undefined) base.currentPosition = currentPosition;
  if (strategicRole !== undefined) base.strategicRole = strategicRole;
  if (keyIssues !== undefined) base.keyIssues = keyIssues;
  if (alignmentRiskPoints !== undefined) base.alignmentRiskPoints = alignmentRiskPoints;

  // ★ CRITICAL GUARD（根本原因対策）: normalize でも projects 保護
  // 【背景】
  // - API から projects = [] で来ても lanes に projects がある場合がある
  // - projects が empty かつ lanes に projects がある場合は lanes から復元する
  // - これにより「空の projects で保存される」事故を防ぐ
  const lanesProjects = [];
  if (lanes?.existing?.projects && Array.isArray(lanes.existing.projects)) {
    lanesProjects.push(...lanes.existing.projects);
  }
  if (lanes?.new?.projects && Array.isArray(lanes.new.projects)) {
    lanesProjects.push(...lanes.new.projects);
  }

  // projects が空で lanes に projects がある場合のみ復元
  if ((!Array.isArray(base.projects) || base.projects.length === 0) && lanesProjects.length > 0) {
    base.projects = lanesProjects;
  }

  return base as Department;
}

export function normalizeDepartmentsAny(input: unknown, strategyId?: string): Department[] | undefined {
  if (!input) return undefined;
  const src = parseIfJsonString<any>(input);

  if (Array.isArray(src)) {
    const arr = (src as unknown[]).map((v) => normalizeDepartment(v as AnyDepartment, strategyId));
    return arr.length ? arr : undefined;
  }
  if (src && typeof src === 'object' && Array.isArray((src as any).departments)) {
    const arr = ((src as any).departments as unknown[]).map((v) =>
      normalizeDepartment(v as AnyDepartment, strategyId),
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
 * STAGE2 正規化（CompanyTarget, WinPatternCandidate, Stage2Answer）
 * ===================================================================== */

function normalizeCompanyTarget(input: unknown): CompanyTarget | null {
  if (!input || typeof input !== 'object') return null;
  const t = input as any;

  const id = String(t.id ?? '');
  const label = String(t.label ?? '').trim();
  const unit = String(t.unit ?? '').trim();
  const rationale = String(t.rationale ?? '').trim();
  const linkedIssueIds = Array.isArray(t.linkedIssueIds)
    ? t.linkedIssueIds.map((id: any) => String(id)).filter((id: string) => id)
    : [];

  // base は必須
  const base = typeof t.base === 'number' ? t.base : Number(t.base);
  if (!Number.isFinite(base)) return null;

  // 必須フィールド確認
  if (!id || !label || !unit || !rationale || linkedIssueIds.length === 0) return null;

  return {
    id,
    label,
    unit,
    base,
    low: typeof t.low === 'number' ? t.low : undefined,
    high: typeof t.high === 'number' ? t.high : undefined,
    dueYear: typeof t.dueYear === 'number' ? t.dueYear : undefined,
    priority: typeof t.priority === 'number' ? t.priority : undefined,
    linkedIssueIds,
    rationale,
  };
}

function normalizeCompanyTargetsArray(input: unknown): CompanyTarget[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const arr = (input as unknown[])
    .map((t) => normalizeCompanyTarget(t))
    .filter((t) => t !== null) as CompanyTarget[];
  return arr.length > 0 ? arr : undefined;
}

function normalizeWinPatternCandidate(input: unknown): WinPatternCandidate | null {
  if (!input || typeof input !== 'object') return null;
  const w = input as any;

  const id = String(w.id ?? '');
  const name = String(w.name ?? '').trim();
  const rationale = String(w.rationale ?? '').trim();
  const tradeoffs = String(w.tradeoffs ?? '').trim();
  const valueDrivers = Array.isArray(w.valueDrivers)
    ? w.valueDrivers.map((v: any) => String(v)).filter((v: string) => v)
    : [];

  if (!id || !name || !rationale || valueDrivers.length === 0) return null;

  return {
    id,
    name,
    valueDrivers,
    rationale,
    tradeoffs,
    scope: w.scope === 'segment' ? 'segment' : 'company',
    segmentName: typeof w.segmentName === 'string' ? w.segmentName : undefined,
  };
}

function normalizeWinPatternCandidatesArray(input: unknown): WinPatternCandidate[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const arr = (input as unknown[])
    .map((w) => normalizeWinPatternCandidate(w))
    .filter((w) => w !== null) as WinPatternCandidate[];
  return arr.length > 0 ? arr : undefined;
}

function normalizeStage2Answer(input: unknown): Stage2Answer | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as any;

  const id = String(a.id ?? '');
  const question = String(a.question ?? '').trim();
  const answer = String(a.answer ?? '').trim();

  if (!id || !question) return null;

  return {
    id,
    question,
    answer,
    required: Boolean(a.required),
  };
}

function normalizeStage2AnswersArray(input: unknown): Stage2Answer[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const arr = (input as unknown[])
    .map((a) => normalizeStage2Answer(a))
    .filter((a) => a !== null) as Stage2Answer[];
  return arr.length > 0 ? arr : undefined;
}

/* =====================================================================
 * StrategyData 正規化（全体・非破壊）
 * ===================================================================== */
export function normalizeStrategyData(input: StrategyData | unknown | null): StrategyData {
  const src: any = { ...(input ?? {}) };

  // ★ 修正0: normalize前ログ（stage4Plans/executionPlanBaseline の有無確認）
  if (process.env.NODE_ENV === 'development') {
    console.log('[diag][normalize:in]', {
      hasStage4Plans: Array.isArray(src.stage4Plans) ? src.stage4Plans.length : 'not-array',
      hasExecutionBaseline: src.executionPlanBaseline ? 'exists' : 'undefined',
      revision: src.revision,
    });
  }

  // story 系は配列のまま
  const storyIn = src.story ?? src.story_final ?? undefined;
  const story =
    normalizeChaptersAnyNonDestructive(storyIn) ??
    (Array.isArray(src.story) ? src.story : []);

  // ★ 追加：storyDraft（たたき台）は新形式で処理（下記 706行以降を参照）

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

  // ★ TASK 3: answers12 の保持（normalize で落ちないようにする）
  // NOTE: 新形式の storyDraft/answers12/winPatternsCandidate は下記（706行以降）で処理
  const winPatterns = Array.isArray(src.winPatterns) ? src.winPatterns : undefined;

  // 部門
  // ★ NEW: Pass strategyId to normalizeDepartmentsAny for stable id generation
  const departmentsNorm = normalizeDepartmentsAny(src.departments, src.id);
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
  // ★ TASK 9-3: ceoIntent の上書き防止（値があれば保持、なければ undefined）
  const ceoIntentSrc = src.ceoIntent ?? src.ceo_intent;
  const ceoIntent = typeof ceoIntentSrc === 'string' ? ceoIntentSrc.trim() : undefined;

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

  // ★ STAGE2：会社の数値目標（North Star Metrics）
  const companyTargets = normalizeCompanyTargetsArray(src.companyTargets);

  // ★ STAGE2：ストーリードラフト・勝ち筋候補・12問回答
  const storyDraft = normalizeChaptersAnyNonDestructive(src.storyDraft);
  const winPatternsCandidate = normalizeWinPatternCandidatesArray(src.winPatternsCandidate);
  const answers12 = normalizeStage2AnswersArray(src.answers12);

  // ★ STAGE2：最終ストーリー（3段階）
  const finalStoryDraft = normalizeChaptersAnyNonDestructive(src.finalStoryDraft);
  const finalStoryEdited = normalizeChaptersAnyNonDestructive(src.finalStoryEdited);
  const finalStoryFinal = normalizeChaptersAnyNonDestructive(src.finalStoryFinal);

  // ★ STAGE2：AI生成の機会と脅威候補（swotSuggestions）
  // 形式: { opportunity?: string[], threat?: string[], generatedAt?: string }
  const swotSuggestionsSrc = src.swotSuggestions ?? src.swot_suggestions;
  const swotSuggestions = swotSuggestionsSrc && typeof swotSuggestionsSrc === 'object' && !Array.isArray(swotSuggestionsSrc)
    ? {
        opportunity: Array.isArray((swotSuggestionsSrc as any).opportunity) ? (swotSuggestionsSrc as any).opportunity : undefined,
        threat: Array.isArray((swotSuggestionsSrc as any).threat) ? (swotSuggestionsSrc as any).threat : undefined,
        generatedAt: typeof (swotSuggestionsSrc as any).generatedAt === 'string' ? (swotSuggestionsSrc as any).generatedAt : undefined,
      }
    : undefined;

  // ★ STAGE2：中計設計（midtermStrategy）の展開
  // - 保存時は swot_suggestions（JSONB）内に `midtermStrategy` キーとしてパックされている
  //   （buildDbRowFromState 参照）。localStorage スナップショット等ではトップレベルに存在する
  // - どちらの形でも拾い、トップレベル out.midtermStrategy へ展開する（normalize で落とさない）
  const midtermStrategy = (() => {
    const raw =
      (src as any).midtermStrategy ??
      (swotSuggestionsSrc && typeof swotSuggestionsSrc === 'object' && !Array.isArray(swotSuggestionsSrc)
        ? (swotSuggestionsSrc as any).midtermStrategy
        : undefined);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const str = (v: any) => (typeof v === 'string' && v.trim() ? v : undefined);
    const strArr = (v: any) =>
      Array.isArray(v) && v.filter((x) => typeof x === 'string' && x.trim()).length > 0
        ? v.filter((x: any) => typeof x === 'string' && x.trim())
        : undefined;
    const m = {
      midtermConcept: str(raw.midtermConcept),
      targetVisionForMidterm: str(raw.targetVisionForMidterm),
      priorityStrategicThemes: strArr(raw.priorityStrategicThemes),
      growthStrategy: str(raw.growthStrategy),
      profitImprovementStrategy: str(raw.profitImprovementStrategy),
      portfolioPolicy: str(raw.portfolioPolicy),
      companyWideDecisionCriteria: strArr(raw.companyWideDecisionCriteria),
      deploymentPrinciplesForUnits: strArr(raw.deploymentPrinciplesForUnits),
      managementMeetingIssues: strArr(raw.managementMeetingIssues),
    };
    return Object.values(m).some((v) => v !== undefined) ? m : undefined;
  })();

  // ★ STAGE3：戦略展開ブリッジ（stage3_strategy_bridge）の展開
  // - STAGE2最終ストーリーからAI生成された、部門設計のための前提情報
  // - トップレベルに保存される（swot_suggestionsのようなパック不要）
  const stage3StrategyBridge = (() => {
    const raw = (src as any).stage3_strategy_bridge;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const strArr = (v: any) =>
      Array.isArray(v) && v.filter((x) => typeof x === 'string' && x.trim()).length > 0
        ? v.filter((x: any) => typeof x === 'string' && x.trim())
        : undefined;
    const b = {
      keyThemes: strArr(raw.keyThemes),
      departmentIssues: strArr(raw.departmentIssues),
      kpiCriteria: strArr(raw.kpiCriteria),
      commonBehaviorChanges: strArr(raw.commonBehaviorChanges),
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    };
    return Object.values(b).some((v) => v !== undefined) ? b : undefined;
  })();

  const out: StrategyData = {
    id: src.id,
    user_id: src.user_id,
    company_id: src.company_id,
    created_at: src.created_at,
    updated_at: src.updated_at,
    updated_by: src.updated_by,
    strategyId: src.strategyId ?? src.strategy_id,
    revision: src.revision,
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
    ...(ceoIntent ? { ceoIntent } : {}),  // ★ TASK 9-3: 値がある場合のみ含める（空上書き防止）
    strength,
    weakness,
    opportunity,
    threat,

    story,
    ...(storyDraft && storyDraft.length > 0 ? { storyDraft } : {}),  // ★ TASK 9-3: 値がある場合のみ含める
    finalStory,

    strategySummary: src.strategySummary,
    questions: Array.isArray(src.questions) ? src.questions : undefined,
    reasons: Array.isArray(src.reasons) ? src.reasons : undefined,
    questions2: Array.isArray(src.questions2) ? src.questions2 : undefined,
    reasons2: Array.isArray(src.reasons2) ? src.reasons2 : undefined,
    answers: Array.isArray(src.answers) ? src.answers : undefined,

    answers2,
    ...(answers12 !== undefined ? { answers12 } : {}),  // ★ TASK 3: answers12 を出力に含める
    ...(winPatternsCandidate !== undefined ? { winPatternsCandidate } : {}),
    ...(winPatterns !== undefined ? { winPatterns } : {}),
    departments,
    stage1Issues,  // ★ 修正：stage1Issues を出力オブジェクトに含める
    stage1Benchmarks,  // ★ 修正：stage1Benchmarks を出力オブジェクトに含める

    // ★ 修正2: STAGE4実行計画（空配列も保持：未定義扱いで invalidate 再発防止）
    ...(Array.isArray(src.stage4Plans)
      ? { stage4Plans: src.stage4Plans }
      : {}),

    // ★ 修正0: STAGE4実行計画baseline（restore 時に消えないようにする）
    ...(src.executionPlanBaseline && typeof src.executionPlanBaseline === 'object'
      ? { executionPlanBaseline: src.executionPlanBaseline }
      : {}),

    editableCascadeResult: Array.isArray(src.editableCascadeResult)
      ? src.editableCascadeResult
      : undefined,
    editableCascade: src.editableCascade,

    // ★ 修正：上場情報フィールドを出力オブジェクトに含める
    ...(isListed !== undefined ? { isListed } : {}),
    ...(ticker ? { ticker } : {}),
    ...(pbrManual ? { pbrManual } : {}),

    // ★ STAGE2：会社の数値目標・ストーリードラフト・勝ち筋候補・12問回答・最終ストーリー・SWOT候補
    ...(companyTargets !== undefined ? { companyTargets } : {}),
    ...(storyDraft !== undefined ? { storyDraft } : {}),
    ...(winPatternsCandidate !== undefined ? { winPatternsCandidate } : {}),
    ...(answers12 !== undefined ? { answers12 } : {}),
    ...(finalStoryDraft !== undefined ? { finalStoryDraft } : {}),
    ...(finalStoryEdited !== undefined ? { finalStoryEdited } : {}),
    ...(finalStoryFinal !== undefined ? { finalStoryFinal } : {}),
    ...(swotSuggestions !== undefined ? { swotSuggestions } : {}),  // ★ 修正：swotSuggestions を出力に含める
    ...(midtermStrategy !== undefined ? { midtermStrategy } : {}),  // ★ STAGE2 中計設計（パック格納から展開）
    ...(stage3StrategyBridge !== undefined ? { stage3_strategy_bridge: stage3StrategyBridge } : {}),  // ★ STAGE3 戦略展開ブリッジ

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

  // ★ 修正0: normalize後ログ（stage4Plans/executionPlanBaseline が保持されたか確認）
  if (process.env.NODE_ENV === 'development') {
    console.log('[diag][normalize:out]', {
      hasStage4Plans: out.stage4Plans ? out.stage4Plans.length : 'undefined',
      hasExecutionBaseline: out.executionPlanBaseline ? 'exists' : 'undefined',
      revision: out.revision,
      deptCount: out.departments?.length ?? 0,
    });
  }

  return out;
}
