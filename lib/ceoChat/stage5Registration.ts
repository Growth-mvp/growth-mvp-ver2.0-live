/* STAGE5の登録状況（財務実績・KR実績・実施事項の進捗・社内共有記録）を、既存の判定関数で集計して、相談の根拠にする。
 * 読み取りだけ。保存・更新は行わない。社内共有は他の利用者の本文を含めず、件数と日付・案件だけを出す。 */
import { isProgressLogCheckin } from '@/lib/progressLogCheckin';
import { aiActionsOf, actionKeysFor, ACTION_STATUS_LABEL, progressOf } from '@/lib/stage5/actionProgress';
import { financeActualItemsOf } from '@/lib/stage5/financeActuals';
import { buildKrPlanActualRows } from '@/lib/stage5/krPlanActual';

export type RegistrationStatus = 'REGISTERED' | 'PARTIAL' | 'UNREGISTERED' | 'FAILED' | 'NOT_APPLICABLE';

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  REGISTERED: '登録済み',
  PARTIAL: '一部登録',
  UNREGISTERED: '未登録',
  FAILED: '取得失敗',
  NOT_APPLICABLE: '参照対象外',
};

export const STAGE5_REGISTRATION_BUDGET = 2400;
export const STAGE5_TRUNCATION_MARK = '（上限のため省略。ここに含まれない項目があります。全件を確認したとは言わないでください）';
const LINES_PER_SECTION_MAX = 12;
const SHARE_WINDOW_DAYS = 30;
const TEXT_MAX = 40;

export type Stage5PlanRow = {
  project_id: unknown;
  ai_draft: unknown;
  started: unknown;
  start_info?: unknown;
};

export type Stage5RegistrationInput = {
  departments: unknown;
  /** 計画書の読み込み結果。null は取得失敗 */
  planRows: Stage5PlanRow[] | null;
  okrs: unknown[];
  companyLogs: unknown[];
  companyLogsFailed: boolean;
  now: Date;
};

export type Stage5RegistrationResult = {
  text: string;
  statuses: { finance: RegistrationStatus; kr: RegistrationStatus; action: RegistrationStatus; share: RegistrationStatus };
  truncated: boolean;
};

type ProjectRef = { id: string; title: string; departmentName: string; project: Record<string, unknown> };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cut = (s: string): string => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}…` : s);
const yen = (n: number): string => `${Math.round(n).toLocaleString('ja-JP')}円`;

function projectsOf(departments: unknown): ProjectRef[] {
  const out: ProjectRef[] = [];
  for (const d of Array.isArray(departments) ? departments : []) {
    const dept = d as { name?: unknown; projects?: unknown };
    const departmentName = str(dept?.name) || '部門名未登録';
    for (const p of Array.isArray(dept?.projects) ? dept.projects : []) {
      const project = p as Record<string, unknown>;
      const id = str(project?.id);
      if (!id) continue;
      out.push({ id, title: str(project.title ?? project.name) || '案件名未登録', departmentName, project });
    }
  }
  return out;
}

function statusOf(total: number, registered: number): RegistrationStatus {
  if (total === 0) return 'NOT_APPLICABLE';
  if (registered === 0) return 'UNREGISTERED';
  return registered === total ? 'REGISTERED' : 'PARTIAL';
}

function finance(projects: ProjectRef[]): { status: RegistrationStatus; lines: string[] } {
  let total = 0;
  let registered = 0;
  let unrecordable = 0;
  const lines: string[] = [];
  for (const ref of projects) {
    for (const item of financeActualItemsOf(ref.project as Parameters<typeof financeActualItemsOf>[0])) {
      if (!item.recordable) {
        unrecordable += 1;
        continue;
      }
      total += 1;
      const place = `${ref.departmentName}／${ref.title}`;
      if (item.actuals.length === 0) {
        lines.push(`- ${place}｜${item.label}：実績未登録（計画 ${item.planText}）`);
        continue;
      }
      registered += 1;
      const first = item.actuals[0];
      const last = item.actuals[item.actuals.length - 1];
      lines.push(
        `- ${place}｜${item.label}：実績 ${item.actuals.length}か月（${first.ym}〜${last.ym}、最新 ${last.ym} ${yen(last.amountYen)}）`,
      );
    }
  }
  if (unrecordable > 0) lines.push(`- 実績の対応先を特定できない財務項目 ${unrecordable}件（登録できない状態）`);
  return { status: statusOf(total, registered), lines };
}

function kr(projects: ProjectRef[], departments: unknown): { status: RegistrationStatus; lines: string[] } {
  let total = 0;
  let registered = 0;
  const lines: string[] = [];
  const projectTitle = new Map(projects.map((p) => [p.id, `${p.departmentName}／${p.title}`]));
  for (const ap of buildKrPlanActualRows(departments)) {
    for (const row of ap.rows) {
      total += 1;
      const place = projectTitle.get(ap.projectId) ?? ap.projectTitle;
      const unit = row.unit ? ` ${row.unit}` : '';
      const label = row.label || 'KR名称未登録';
      if (row.actual === null) {
        lines.push(`- ${place}｜${label}：実績未登録（目標 ${row.plan ?? '未設定'}${unit}）`);
        continue;
      }
      registered += 1;
      lines.push(`- ${place}｜${label}：実績 ${row.actual}${unit}（目標 ${row.plan ?? '未設定'}${unit}、${row.asOf ?? '日付未登録'}時点）`);
    }
  }
  return { status: statusOf(total, registered), lines };
}

function action(
  projects: ProjectRef[],
  planRows: Stage5PlanRow[] | null,
): { status: RegistrationStatus; lines: string[] } {
  if (planRows === null) return { status: 'FAILED', lines: [] };
  const started = planRows.filter((r) => r.started === true && r.start_info);
  if (started.length === 0) return { status: 'NOT_APPLICABLE', lines: [] };
  let total = 0;
  let registered = 0;
  const lines: string[] = [];
  for (const row of started) {
    const ref = projects.find((p) => p.id === str(row.project_id));
    const startedAt = str((row.start_info as { at?: unknown } | null)?.at);
    if (!ref || !startedAt) continue;
    const keyByOrder = new Map(actionKeysFor(startedAt, row.ai_draft).map((x) => [x.order, x.key]));
    const progress = progressOf(ref.project);
    for (const a of aiActionsOf(row.ai_draft)) {
      total += 1;
      const rec = progress[keyByOrder.get(a.order) ?? ''];
      const place = `${ref.departmentName}／${ref.title}`;
      const title = cut(str(a.title) || '施策名未登録');
      if (!rec) {
        lines.push(`- ${place}｜${title}：進捗未登録`);
        continue;
      }
      registered += 1;
      const result = rec.result ? `、結果：${cut(rec.result)}` : '';
      lines.push(`- ${place}｜${title}：${ACTION_STATUS_LABEL[rec.status]}${result}`);
    }
  }
  return { status: statusOf(total, registered), lines };
}

function share(
  projects: ProjectRef[],
  okrs: unknown[],
  companyLogs: unknown[],
  failed: boolean,
  now: Date,
): { status: RegistrationStatus; lines: string[] } {
  if (failed) return { status: 'FAILED', lines: [] };
  const projectOfOkr = new Map<string, string>();
  for (const o of okrs as Array<Record<string, unknown>>) {
    if (o?.id != null && o?.project_id != null) projectOfOkr.set(String(o.id), String(o.project_id));
  }
  const titleOf = new Map(projects.map((p) => [p.id, `${p.departmentName}／${p.title}`]));
  const since = now.getTime() - SHARE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const byProject = new Map<string, { count: number; latest: string }>();
  for (const row of companyLogs as Array<Record<string, unknown>>) {
    if (!isProgressLogCheckin(row as never)) continue;
    const projectId = projectOfOkr.get(String(row.okr_id ?? ''));
    if (!projectId || !titleOf.has(projectId)) continue;
    const at = Date.parse(str(row.created_at));
    if (!Number.isFinite(at) || at < since) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    const cur = byProject.get(projectId) ?? { count: 0, latest: '' };
    cur.count += 1;
    if (day > cur.latest) cur.latest = day;
    byProject.set(projectId, cur);
  }
  const total = [...byProject.values()].reduce((n, v) => n + v.count, 0);
  const lines = [...byProject.entries()].map(([id, v]) => `- ${titleOf.get(id)}：${v.count}件（最新 ${v.latest}）`);
  return {
    status: total === 0 ? 'UNREGISTERED' : 'REGISTERED',
    lines,
  };
}

export function buildStage5RegistrationBlock(input: Stage5RegistrationInput): Stage5RegistrationResult {
  const projects = projectsOf(input.departments);
  const f = finance(projects);
  const k = kr(projects, input.departments);
  const a = action(projects, input.planRows);
  const s = share(projects, input.okrs, input.companyLogs, input.companyLogsFailed, input.now);

  const sections: Array<{ title: string; status: RegistrationStatus; lines: string[]; note?: string }> = [
    { title: '財務実績', status: f.status, lines: f.lines },
    { title: 'KR実績', status: k.status, lines: k.lines },
    { title: '実施事項の進捗', status: a.status, lines: a.lines, note: a.status === 'FAILED' ? '計画書を読み込めなかったため、未登録とは判断しない' : undefined },
    {
      title: `社内共有記録（直近${SHARE_WINDOW_DAYS}日）`,
      status: s.status,
      lines: s.lines,
      note: s.status === 'UNREGISTERED' ? `直近${SHARE_WINDOW_DAYS}日には記録がない（それ以前は確認していない）` : undefined,
    },
  ];

  const summary = sections.map((x) => `${x.title}：${REGISTRATION_LABEL[x.status]}`).join('／');
  const parts: string[] = [
    '# STAGE5の登録状況（保存済みの実績・進捗から集計。読み取りのみ）',
    '- 登録状況を尋ねられたら、現在の画面の操作案内より先に、下の【概要】で直接答える。現在の画面がSTAGE5でなくても、STAGE5の登録状況はこの情報で答える。',
    `【概要】${summary}`,
    '- 「取得失敗」の項目は、未登録とは言わない。「参照対象外」は、対象の計画や項目がないことを示す。',
    '- 社内共有は、他の利用者の本文を含めない。件数と日付・案件だけを使う。',
  ];
  for (const x of sections) {
    parts.push(`## ${x.title}：${REGISTRATION_LABEL[x.status]}`);
    if (x.note) parts.push(`- ${x.note}`);
    x.lines.slice(0, LINES_PER_SECTION_MAX).forEach((l) => parts.push(l));
    if (x.lines.length > LINES_PER_SECTION_MAX) parts.push(`- ほか${x.lines.length - LINES_PER_SECTION_MAX}件（省略）`);
  }

  let text = parts.join('\n');
  const truncated = text.length > STAGE5_REGISTRATION_BUDGET;
  if (truncated) text = `${text.slice(0, STAGE5_REGISTRATION_BUDGET)}\n${STAGE5_TRUNCATION_MARK}`;
  return {
    text,
    statuses: { finance: f.status, kr: k.status, action: a.status, share: s.status },
    truncated,
  };
}
