import { buildDocModel, type DocModel, type Edits } from '@/lib/stage4/planView/documentModel';
import { isProjectStopped } from '@/lib/cascade/projectLifecycle';

/* STAGE4の実行計画書（stage4_plan_documents）を、AI経営コンサルタントが参照する文脈にする。
 * 表示の組み立ては画面と同じ buildDocModel を使い、保存された利用者の編集をAI原案より優先する。 */

export type AdminLike = { from: (table: string) => any };

export type Stage4PlanRow = {
  project_id: unknown;
  ai_draft: unknown;
  user_edits: unknown;
  started: unknown;
  adopted: unknown;
};

export const STAGE4_PLAN_BUDGET = 1800;
const MAX_PROJECTS = 8;
const MAX_KPI = 4;
const MAX_ACTIONS = 3;
const TEXT_MAX = 160;
const HEADER = '# 実行計画（STAGE4・保存済みの計画書）';
const NOTES = [
  '- 保存済みの内容だけを参照する。画面上の未保存の編集は含まない。',
  '- 利用者が保存した編集を優先し、編集のない項目はAI原案のまま。「AI提案」「AIの仮置き」と付いた目標は、STAGE3で確定した目標ではない。',
  '- 部門・プロジェクト名はSTAGE3の確定版。STAGE3の作業版（未確定の変更）は含まない。',
];

type AnyRecord = Record<string, any>;
type Hit = { deptName: string; title: string; project: AnyRecord };

const short = (v: unknown, max = TEXT_MAX): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const cost = (lines: string[]): number => lines.reduce((n, l) => n + l.length + 1, 0);

/** プロジェクトIDが一意に1件だけ見つかるものだけを使う（同じIDが複数あれば参照しない） */
function indexProjects(departments: unknown): Map<string, Hit> {
  const hits = new Map<string, Hit[]>();
  if (!Array.isArray(departments)) return new Map();
  for (const d of departments as AnyRecord[]) {
    const deptName = short(d?.name, 60);
    for (const p of Array.isArray(d?.projects) ? (d.projects as AnyRecord[]) : []) {
      if (typeof p?.id !== 'string') continue;
      hits.set(p.id, [...(hits.get(p.id) ?? []), { deptName, title: short(p.title ?? p.name, 120), project: p }]);
    }
  }
  const unique = new Map<string, Hit>();
  for (const [id, list] of hits) if (list.length === 1) unique.set(id, list[0]);
  return unique;
}

function statusOf(row: Stage4PlanRow, project: AnyRecord): string {
  if (isProjectStopped(project)) return '中止';
  if (row.started === true) return '実行開始済み';
  if (row.adopted === true) return '採用済み（実行開始前）';
  return '計画中（未採用）';
}

function planLines(row: Stage4PlanRow, hit: Hit): string[] {
  const head = `- ${hit.deptName || '部門名未設定'}／${hit.title || 'プロジェクト名未設定'}｜状態：${statusOf(row, hit.project)}`;
  let view: DocModel;
  try {
    view = buildDocModel(row.ai_draft ?? {}, (row.user_edits ?? {}) as Edits);
  } catch {
    return [head, '  計画書の内容を読めませんでした'];
  }
  const lines = [head];
  if (view.purpose.reason.text) lines.push(`  目的：${short(view.purpose.reason.text)}`);
  if (view.purpose.problem.text) lines.push(`  解決したい課題：${short(view.purpose.problem.text)}`);
  const kpis = view.goals.kpis.slice(0, MAX_KPI);
  if (kpis.length === 0) lines.push('  KPI：未登録');
  for (const k of kpis) {
    lines.push(`  KPI：${short(k.label, 80)}｜目標 ${short(k.target, 40)}｜期限 ${short(k.due, 60)}｜担当 ${short(k.owner, 40)}（${k.statusLabel}）`);
  }
  for (const a of view.actions.slice(0, MAX_ACTIONS)) {
    lines.push(`  施策：${a.no}. ${short(a.title, 80)}｜期限 ${short(a.due, 40)}｜担当 ${short(a.owner, 40)}`);
  }
  return lines;
}

export function buildStage4PlanBlock(args: {
  rows: Stage4PlanRow[] | null;
  departments: unknown;
  question: string;
  budget?: number;
}): string {
  if (args.rows === null) return `${HEADER}\n（計画書は今回確認できませんでした）`;
  const index = indexProjects(args.departments);
  const q = args.question ?? '';
  const matched = args.rows
    .map((row) => ({ row, hit: index.get(String(row.project_id)) }))
    .filter((m): m is { row: Stage4PlanRow; hit: Hit } => m.hit !== undefined);
  const withoutPlan = index.size - matched.length;
  if (matched.length === 0) {
    return `${HEADER}\n${NOTES.join('\n')}\n（保存された計画書はありません。STAGE4で作成すると参照できます）`;
  }

  const rank = (m: { row: Stage4PlanRow; hit: Hit }) => {
    const mentioned = (m.hit.title && q.includes(m.hit.title)) || (m.hit.deptName && q.includes(m.hit.deptName)) ? 1 : 0;
    return mentioned * 2 + (m.row.started === true ? 1 : 0);
  };
  const ordered = matched.slice().sort((a, b) => rank(b) - rank(a));

  const budget = args.budget ?? STAGE4_PLAN_BUDGET;
  const out = [HEADER, ...NOTES];
  let shown = 0;
  for (const m of ordered) {
    const block = planLines(m.row, m.hit);
    if (shown >= MAX_PROJECTS || cost(out) + cost(block) > budget) break;
    out.push(...block);
    shown += 1;
  }
  const omitted = ordered.length - shown;
  if (omitted > 0) out.push(`（ほか${omitted}件の計画書は文字数の上限のため省略）`);
  if (withoutPlan > 0) out.push(`（STAGE4の計画書が未作成の施策：${withoutPlan}件）`);
  return out.join('\n');
}

export async function loadStage4PlanRows(admin: AdminLike, companyId: string, strategyId: string): Promise<Stage4PlanRow[] | null> {
  try {
    const { data, error } = await admin
      .from('stage4_plan_documents')
      .select('project_id, ai_draft, user_edits, started, adopted')
      .eq('company_id', companyId)
      .eq('strategy_id', strategyId);
    if (error) return null;
    return Array.isArray(data) ? (data as Stage4PlanRow[]) : [];
  } catch {
    return null;
  }
}
