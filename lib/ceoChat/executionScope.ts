import { parseMetadata } from '@/utils/execution/metadata';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';

/* 右側のAI経営コンサルタントが、選択中の実行支援の対象（プロジェクト）だけを参照するための文脈。
 * 会社・戦略・部門・プロジェクトの整合と、所属（呼び出し元の会社のメンバー）は、呼び出し側で確認済みであること。 */

export type ExecutionInput = { companyId: string; strategyId: string; departmentId: string; projectId: string };

export type ExecutionParse = { ok: true; value: ExecutionInput } | { ok: false; status: 400 | 403; error: string };

const ID_MAX = 100;
const TEXT_MAX = 300;
const KR_MAX = 10;
const KPI_MAX = 10;
const ACTION_MAX = 10;
const POST_MAX = 8;

const short = (v: unknown, max = TEXT_MAX): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export function parseExecutionInput(raw: unknown, expected: { companyId: string; strategyId: string }): ExecutionParse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, status: 400, error: 'invalid execution context' };
  const r = raw as Record<string, unknown>;
  const pick = (k: keyof ExecutionInput): string | null => {
    const v = r[k];
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' || t.length > ID_MAX ? null : t;
  };
  const companyId = pick('companyId');
  const strategyId = pick('strategyId');
  const departmentId = pick('departmentId');
  const projectId = pick('projectId');
  if (!companyId || !strategyId || !departmentId || !projectId) {
    return { ok: false, status: 400, error: 'invalid execution context' };
  }
  if (companyId !== expected.companyId || strategyId !== expected.strategyId) {
    return { ok: false, status: 403, error: 'execution context does not match the request' };
  }
  return { ok: true, value: { companyId, strategyId, departmentId, projectId } };
}

type Dept = Record<string, unknown> & { id?: unknown; name?: unknown; projects?: unknown };
type Project = Record<string, unknown> & { id?: unknown; title?: unknown; okrsV2?: unknown };

/** プロジェクトIDは一意であること。部門IDは、保存された部門のIDか、部門の位置による既定のIDと一致すること */
export function findExecutionTarget(
  departments: unknown,
  input: Pick<ExecutionInput, 'departmentId' | 'projectId'>,
): { ok: true; departmentName: string; projectTitle: string; project: Project } | { ok: false; status: 403; error: string } {
  const depts = Array.isArray(departments) ? (departments as Dept[]) : [];
  const hits: Array<{ di: number; dept: Dept; project: Project }> = [];
  depts.forEach((dept, di) => {
    const projects = Array.isArray(dept?.projects) ? (dept.projects as Project[]) : [];
    for (const project of projects) {
      if (typeof project?.id === 'string' && project.id === input.projectId) hits.push({ di, dept, project });
    }
  });
  if (hits.length !== 1) return { ok: false, status: 403, error: 'project is not part of this strategy' };
  const { di, dept, project } = hits[0];
  const deptKey = typeof dept.id === 'string' && dept.id !== '' ? dept.id : `dept_${di}`;
  if (deptKey !== input.departmentId) return { ok: false, status: 403, error: 'department does not match the project' };
  return {
    ok: true,
    departmentName: short(dept.name, 60),
    projectTitle: short(project.title, 120),
    project,
  };
}

export type PromptKr = { label: string; target: string; actual: string };
export type PromptPlan = { reason: string; problem: string; kpis: string[]; actions: string[] } | null;
export type PromptPost = { at: string; text: string; isFeedback: boolean };

export function buildExecutionPromptBlock(args: {
  departmentName: string;
  projectTitle: string;
  objective: string;
  krs: PromptKr[];
  plan: PromptPlan;
  posts: PromptPost[];
}): string {
  const lines: string[] = [
    '【相談の対象（この相談は次のプロジェクトだけを対象にする。他の案件・他社の情報は参照しない）】',
    `部門：${short(args.departmentName, 60) || '未設定'}`,
    `プロジェクト：${short(args.projectTitle, 120) || '未設定'}`,
  ];
  if (args.objective) lines.push(`目標：${short(args.objective)}`);
  if (args.plan) {
    if (args.plan.reason) lines.push(`取り組む理由（実行計画）：${short(args.plan.reason)}`);
    if (args.plan.problem) lines.push(`解決したい課題（実行計画）：${short(args.plan.problem)}`);
    if (args.plan.kpis.length) lines.push('KPI（実行計画・修正後の値）：', ...args.plan.kpis.slice(0, KPI_MAX).map((k) => `・${short(k)}`));
    if (args.plan.actions.length) lines.push('実施事項（正式な計画）：', ...args.plan.actions.slice(0, ACTION_MAX).map((a) => `・${short(a)}`));
  } else {
    lines.push('実行計画：未開始（STAGE4で実行を開始していない）');
  }
  if (args.krs.length) {
    lines.push('KR（測定済みの実績がある場合のみ実績として扱う）：');
    lines.push(...args.krs.slice(0, KR_MAX).map((k) => `・${short(k.label, 120)}：目標 ${k.target}／実績 ${k.actual}`));
  }
  if (args.posts.length) {
    lines.push('社内に共有された投稿（社員が社内に共有したもの。投稿者は示さない）：');
    lines.push(...args.posts.slice(0, POST_MAX).map((p) => `・${p.at}${p.isFeedback ? '（フィードバック）' : ''}：${short(p.text, 400)}`));
  }
  lines.push('AIは、この対象の範囲で原因・解決策・必要な協力・次の行動を提案する。計画書やKPIは変更しないと明記する。');
  return lines.join('\n');
}

/* 呼び出し元が渡す管理者用クライアント（RLSを通らない）。各クエリは会社IDで必ず絞る */
export type AdminLike = { from: (table: string) => any };

export type ExecutionScope = { ok: true; projectTitle: string; promptBlock: string } | { ok: false; status: 403 | 500; error: string };

export async function loadExecutionScope(
  admin: AdminLike,
  input: ExecutionInput,
): Promise<ExecutionScope> {
  const { data: row, error: rowError } = await admin
    .from('strategy_data')
    .select('departments')
    .eq('id', input.strategyId)
    .eq('company_id', input.companyId)
    .maybeSingle();
  if (rowError) return { ok: false, status: 500, error: 'strategy read failed' };
  const target = findExecutionTarget(row?.departments, input);
  if (!target.ok) return target;

  const okrs = Array.isArray(target.project.okrsV2) ? (target.project.okrsV2 as Array<Record<string, unknown>>) : [];
  const krs: PromptKr[] = okrs.map((k) => {
    const actual = k.actual as { value?: unknown; asOf?: unknown } | undefined;
    return {
      label: typeof k.label === 'string' ? k.label : '',
      target: typeof k.target === 'number' ? `${k.target}${typeof k.unit === 'string' ? k.unit : ''}` : '未設定',
      actual: typeof actual?.value === 'number' ? `${actual.value}（${typeof actual.asOf === 'string' ? actual.asOf : '基準日未設定'}）` : '未確認',
    };
  });

  let plan: PromptPlan = null;
  try {
    const { data: doc } = await admin
      .from('stage4_plan_documents')
      .select('ai_draft, user_edits, start_info')
      .eq('company_id', input.companyId)
      .eq('strategy_id', input.strategyId)
      .eq('project_id', input.projectId)
      .maybeSingle();
    if (doc?.start_info) {
      const view = buildDocModel(doc.ai_draft ?? {}, doc.user_edits ?? {});
      plan = {
        reason: view.purpose.reason.text,
        problem: view.purpose.problem.text,
        kpis: view.goals.kpis.map((k) => `${k.label}：目標 ${k.target}・期限 ${k.due}・担当 ${k.owner}`),
        actions: view.actions.map((a) => `${a.no}. ${a.title}（期限 ${a.due}・担当 ${a.owner}）`),
      };
    }
  } catch {
    plan = null;
  }

  const { data: okrRows } = await admin
    .from('okrs')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('project_id', input.projectId)
    .eq('is_deleted', false);
  const okrIds = Array.isArray(okrRows) ? okrRows.map((r: { id: string }) => r.id) : [];
  let posts: PromptPost[] = [];
  if (okrIds.length) {
    const { data: logs } = await admin
      .from('progress_logs')
      .select('content, created_at')
      .eq('company_id', input.companyId)
      .in('okr_id', okrIds)
      .order('created_at', { ascending: false })
      .limit(POST_MAX);
    posts = (Array.isArray(logs) ? logs : []).map((l: { content?: string; created_at?: string }) => {
      const body = parseMetadata(String(l.content ?? '')).text;
      return {
        at: l.created_at ? String(l.created_at).slice(0, 10) : '',
        text: body.startsWith('[FB]') ? body.replace(/^\[FB\]\s*/, '') : body,
        isFeedback: body.startsWith('[FB]'),
      };
    });
  }

  return {
    ok: true,
    projectTitle: target.projectTitle,
    promptBlock: buildExecutionPromptBlock({
      departmentName: target.departmentName,
      projectTitle: target.projectTitle,
      objective: '',
      krs,
      plan,
      posts,
    }),
  };
}
