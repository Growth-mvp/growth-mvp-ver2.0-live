import { krTargetLabel } from './stage4Projection';

export type ReviewKpi = { krId: string | null; label: string; target: number | null; unit: string | null };

export type ReviewCandidate = {
  id: string;
  strategyId: string;
  projectId: string;
  departmentId: string | null;
  departmentName: string;
  projectTitle: string;
  summary: string;
  kpis: ReviewKpi[];
  legacyKpiLabels: string[];
  href: string;
};

export type ReviewTarget = {
  stage: 4;
  candidateId: string;
  strategyId: string;
  label: string;
  href: string;
  projectTitle: string;
  departmentName: string;
  checkItems: string[];
};

export type ReviewCandidateIndex = {
  candidates: ReviewCandidate[];
  unlinkableProjects: number;
};

const MAX_SUMMARY_CHARS = 80;
const MAX_TARGETS = 3;
const PROMPT_MAX_ITEMS = 12;
const PROMPT_CHAR_BUDGET = 1800;
const MARKER = /^[ \t]*\[見直し候補[:：][ \t]*([^\]\n]+)\][ \t]*$/gm;
const HREF_PREFIX = '/okr?projectId=';

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idOf = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function buildHref(projectId: string, departmentId: string | null): string {
  const dept = departmentId ? `&deptId=${encodeURIComponent(departmentId)}` : '';
  return `${HREF_PREFIX}${encodeURIComponent(projectId)}${dept}`;
}

function kpisOf(project: Rec): { kpis: ReviewKpi[]; legacyKpiLabels: string[] } {
  const kpis: ReviewKpi[] = arr(project.okrsV2).flatMap((kr) => {
    const k = rec(kr);
    const label = textOf(k.label);
    if (!label) return [];
    const target = typeof k.target === 'number' && Number.isFinite(k.target) ? k.target : null;
    const unit = textOf(k.unit) || null;
    return [{ krId: idOf(k.id) || null, label, target, unit }];
  });
  if (kpis.length > 0) return { kpis, legacyKpiLabels: [] };

  const legacy = [
    ...arr(project.kpis).map((k) => textOf(k)),
    ...arr(project.okrs).flatMap((o) => arr(rec(o).keyResults).map((k) => textOf(typeof k === 'string' ? k : rec(k).label))),
  ].filter(Boolean);
  return { kpis: [], legacyKpiLabels: legacy };
}

/**
 * 登録済みのSTAGE4データから、案内できる見直し候補を作る。
 * - プロジェクトIDが無いものは案内しない（架空のリンクを作らない）。
 * - 同じプロジェクトIDが複数の部門にあり、部門IDも無い場合は、どれを指すか特定できないので案内しない。
 * - KPIの実績値（actual）は扱わない。
 */
export function buildStage4ReviewCandidates(departments: unknown, strategyId: string): ReviewCandidateIndex {
  const entries: Array<{ deptId: string | null; deptName: string; project: Rec; projectId: string }> = [];
  let unlinkableProjects = 0;

  for (const d of arr(departments)) {
    const dept = rec(d);
    const deptId = idOf(dept.id) || null;
    const deptName = textOf(dept.name) || textOf(dept.departmentName) || '部門名未設定';
    for (const p of arr(dept.projects)) {
      const project = rec(p);
      const projectId = idOf(project.id);
      if (!projectId) {
        unlinkableProjects += 1;
        continue;
      }
      entries.push({ deptId, deptName, project, projectId });
    }
  }

  const countById = new Map<string, number>();
  for (const e of entries) countById.set(e.projectId, (countById.get(e.projectId) ?? 0) + 1);

  const seen = new Set<string>();
  const candidates: ReviewCandidate[] = [];
  for (const e of entries) {
    const ambiguous = (countById.get(e.projectId) ?? 0) > 1 && !e.deptId;
    const key = `${e.deptId ?? ''}::${e.projectId}`;
    if (ambiguous || seen.has(key)) {
      unlinkableProjects += 1;
      continue;
    }
    seen.add(key);
    const { kpis, legacyKpiLabels } = kpisOf(e.project);
    candidates.push({
      id: `r${candidates.length + 1}`,
      strategyId,
      projectId: e.projectId,
      departmentId: e.deptId,
      departmentName: e.deptName,
      projectTitle: textOf(e.project.title) || textOf(e.project.name) || 'プロジェクト名未設定',
      summary: textOf(e.project.reason).slice(0, MAX_SUMMARY_CHARS),
      kpis,
      legacyKpiLabels,
      href: buildHref(e.projectId, e.deptId),
    });
  }

  return { candidates, unlinkableProjects };
}

const bigrams = (s: string): Set<string> => {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
};

function relevance(candidate: ReviewCandidate, questionGrams: Set<string>): number {
  const text = [
    candidate.projectTitle,
    candidate.departmentName,
    candidate.summary,
    ...candidate.kpis.map((k) => k.label),
    ...candidate.legacyKpiLabels,
  ].join(' ');
  let hits = 0;
  for (const g of bigrams(text)) if (questionGrams.has(g)) hits += 1;
  return hits;
}

const kpiLine = (k: ReviewKpi): string => {
  return `${k.label}（${krTargetLabel(k.target, k.unit)}）`;
};

const candidateLine = (c: ReviewCandidate): string => {
  const kpis = c.kpis.length > 0
    ? c.kpis.map(kpiLine).join('、')
    : c.legacyKpiLabels.length > 0
      ? `${c.legacyKpiLabels.join('、')}（旧形式）`
      : '一覧に記載なし';
  return `- ${c.id}｜部門: ${c.departmentName}｜プロジェクト: ${c.projectTitle}｜概要: ${c.summary || '記載なし'}｜KPI: ${kpis}`;
};

/**
 * AIへ渡す候補一覧。関連度の高いものを先に並べ、件数上限・文字数上限で切る。
 * 切った場合は件数を明示し、一覧にないものを「存在しない」と断定させない。
 */
export function buildReviewPromptBlock(
  index: ReviewCandidateIndex,
  question: string,
  options: { maxItems?: number; charBudget?: number } = {}
): { text: string; shown: ReviewCandidate[]; relevantOutsideShown: number } {
  const { candidates } = index;
  if (candidates.length === 0) return { text: '', shown: [], relevantOutsideShown: 0 };

  const questionGrams = bigrams(question ?? '');
  const ranked = candidates
    .map((c, i) => ({ c, i, score: relevance(c, questionGrams) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const maxItems = options.maxItems ?? PROMPT_MAX_ITEMS;
  const budget = options.charBudget ?? PROMPT_CHAR_BUDGET;
  const shown: ReviewCandidate[] = [];
  let used = 0;
  for (const { c } of ranked) {
    if (shown.length >= maxItems) break;
    const line = candidateLine(c);
    if (used + line.length > budget && shown.length > 0) break;
    shown.push(c);
    used += line.length;
  }

  const shownIds = new Set(shown.map((c) => c.id));
  const relevantOutsideShown = ranked.filter(({ c, score }) => score > 0 && !shownIds.has(c.id)).length;
  const omitted = candidates.length - shown.length;
  const lines = [
    '【見直し候補（STAGE4・登録済みの実在データ）】',
    `候補は全${candidates.length}件のうち、質問に関連度の高い${shown.length}件を示しています。`,
    ...(omitted > 0 ? ['一覧にないプロジェクトやKPIを、『存在しない』『未登録』と断定しないでください。'] : []),
    '一覧にあるKPIだけを既存のKPIとして説明してください。登録されていないKPIを既存のものとして扱わないでください。',
    '実績値は示していません。達成・未達を断定せず、目標との関係は確認を促す形で書いてください。',
    '回答で既存プロジェクトのKPIや実行計画の見直しを具体的に勧める場合は、下の一覧から最も関連する候補を1件選び、回答の最後の行に「[見直し候補: r1]」の形式で候補IDを書いてください。',
    '次の場合はマーカーを出力しないでください：関連する候補が一覧にない場合、候補との関連が不明確な場合、数値の確認や一般的な質問だけの場合。',
    '候補IDは下の一覧にあるものだけを使ってください。提示されていないIDを作らず、URL・プロジェクトIDも本文に書かないでください。',
    ...shown.map(candidateLine),
  ];
  return { text: lines.join('\n'), shown, relevantOutsideShown };
}

const toTarget = (c: ReviewCandidate): ReviewTarget => ({
  stage: 4,
  candidateId: c.id,
  strategyId: c.strategyId,
  label: `${c.projectTitle}のKPIを確認`,
  href: c.href,
  projectTitle: c.projectTitle,
  departmentName: c.departmentName,
  checkItems: ['KPI・目標値'],
});

/**
 * AIの回答から見直し候補IDの行を取り除き、提示済みの候補にだけ変換する。
 * AIが書いたURLや未提示のIDは、案内先として使わない。
 */
export type ReviewMarkerDiagnostics = {
  markerLines: number;
  validMarkerLines: number;
  markerIds: number;
  matchedIds: number;
  unmatchedIds: number;
  returned: number;
};

export function extractReviewMarkers(
  content: string,
  shown: ReadonlyMap<string, ReviewCandidate>
): { content: string; reviewTargets: ReviewTarget[]; diagnostics: ReviewMarkerDiagnostics } {
  const markerLines = content.split('\n').filter((l) => l.includes('見直し候補')).length;
  const validMarkerLines = [...content.matchAll(MARKER)].length;

  const ids: string[] = [];
  const stripped = content
    .replace(MARKER, (_m, list: string) => {
      for (const part of list.split(/[,、\s]+/)) if (part) ids.push(part.trim());
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const matchedIds = ids.filter((id) => shown.has(id)).length;
  const reviewTargets: ReviewTarget[] = [];
  const used = new Set<string>();
  for (const id of ids) {
    if (reviewTargets.length >= MAX_TARGETS) break;
    const candidate = shown.get(id);
    if (!candidate || used.has(id)) continue;
    used.add(id);
    reviewTargets.push(toTarget(candidate));
  }
  return {
    content: stripped,
    reviewTargets,
    diagnostics: {
      markerLines,
      validMarkerLines,
      markerIds: ids.length,
      matchedIds,
      unmatchedIds: ids.length - matchedIds,
      returned: reviewTargets.length,
    },
  };
}

export type ReviewReason =
  | 'json_output'
  | 'no_candidates'
  | 'no_linkable_candidates'
  | 'no_marker'
  | 'no_marker_truncated'
  | 'marker_format_invalid'
  | 'marker_id_mismatch'
  | 'returned';

export type ReviewRunReport = ReviewMarkerDiagnostics & {
  reason: ReviewReason;
  stage4Total: number;
  unlinkable: number;
  shownInPrompt: number;
  relevantOutsideShown: number;
  finishReason: string | null;
  possiblyTruncated: boolean;
  contentChars: number;
};

/** 診断ログ用。件数・終了理由・文字数だけを返す（案件名・KPI名・本文は含めない） */
export function classifyReviewRun(input: {
  asJson: boolean;
  stage4Total: number;
  unlinkable: number;
  shownInPrompt: number;
  relevantOutsideShown: number;
  marker: ReviewMarkerDiagnostics | null;
  finishReason: string | null;
  contentChars: number;
}): ReviewRunReport {
  const possiblyTruncated = input.finishReason === 'length';
  const m: ReviewMarkerDiagnostics = input.marker ?? {
    markerLines: 0,
    validMarkerLines: 0,
    markerIds: 0,
    matchedIds: 0,
    unmatchedIds: 0,
    returned: 0,
  };
  let reason: ReviewReason;
  if (input.asJson) reason = 'json_output';
  else if (input.stage4Total === 0) reason = input.unlinkable > 0 ? 'no_linkable_candidates' : 'no_candidates';
  else if (m.returned > 0) reason = 'returned';
  else if (m.markerLines === 0) reason = possiblyTruncated ? 'no_marker_truncated' : 'no_marker';
  else if (m.validMarkerLines === 0) reason = 'marker_format_invalid';
  else reason = 'marker_id_mismatch';

  return {
    reason,
    stage4Total: input.stage4Total,
    unlinkable: input.unlinkable,
    shownInPrompt: input.shownInPrompt,
    relevantOutsideShown: input.relevantOutsideShown,
    finishReason: input.finishReason,
    possiblyTruncated,
    contentChars: input.contentChars,
    ...m,
  };
}

/** 画面に渡す前の検証。サーバーが作った形式（STAGE4・/okr?projectId=…）だけを通す */
export function parseReviewTargets(raw: unknown): ReviewTarget[] {
  return arr(raw).flatMap((v) => {
    const t = rec(v);
    const href = textOf(t.href);
    const strategyId = idOf(t.strategyId);
    const candidateId = idOf(t.candidateId);
    if (t.stage !== 4 || !href.startsWith(HREF_PREFIX) || href.includes('//') || !strategyId || !candidateId) return [];
    const checkItems = arr(t.checkItems).map(textOf).filter(Boolean);
    return [{
      stage: 4 as const,
      candidateId,
      strategyId,
      label: textOf(t.label).slice(0, 80),
      href,
      projectTitle: textOf(t.projectTitle).slice(0, 80),
      departmentName: textOf(t.departmentName).slice(0, 80),
      checkItems: checkItems.length > 0 ? checkItems : ['KPI・目標値'],
    }];
  });
}
