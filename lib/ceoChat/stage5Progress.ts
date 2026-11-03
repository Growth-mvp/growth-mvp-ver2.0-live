import { isProgressLogCheckin } from '@/lib/progressLogCheckin';

type AnyRecord = Record<string, any>;

export const STAGE5_CHAR_BUDGET = 1600;
export const CHECKIN_WINDOW_DAYS = 7;
export const CHECKIN_LOOKBACK_DAYS = 30;
const STALE_LIST_MAX = 10;
const OWN_LOG_MAX = 30;
const OWN_TEXT_MAX = 120;
const UNKNOWN_NAME = '名称未登録';

function records(v: unknown): AnyRecord[] {
  return Array.isArray(v) ? v.filter((x): x is AnyRecord => !!x && typeof x === 'object') : [];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function dayOf(v: unknown): string {
  const t = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}

function timeOf(v: unknown): number | null {
  const t = Date.parse(text(v));
  return Number.isFinite(t) ? t : null;
}

export function stripProgressMeta(content: unknown): string {
  const s = typeof content === 'string' ? content : '';
  return s.replace(/^__META__.*(?:\r?\n)?/m, '').trim();
}

export function formatOwnProgressLines(
  rows: unknown,
  projectTitleOf: (okrId: string) => string | null = () => null
): string[] {
  return records(rows)
    .slice(0, OWN_LOG_MAX)
    .map((r) => {
      const date = dayOf(r.created_at) || '日付未登録';
      const project = projectTitleOf(String(r.okr_id ?? ''));
      const body = stripProgressMeta(r.content).replace(/\s+/g, ' ').slice(0, OWN_TEXT_MAX);
      const score = typeof r.score === 'number' && Number.isFinite(r.score) ? String(r.score) : '未登録';
      const status = text(r.status) || '未登録';
      return `- ${date}${project ? ` ${project}` : ''}｜評価 ${score}｜登録ステータス ${status}｜${body || '（本文なし）'}`;
    });
}

export function buildStage5ProgressBlock(args: {
  departments: unknown;
  okrs: unknown;
  companyLogs: unknown;
  companyLogsFailed: boolean;
  now: Date;
}): string {
  const header = '# 実行状況（STAGE5、会社全体は確認日時の集計のみ）';
  const depts = records(args.departments);
  const deptNameById = new Map<string, string>();
  const projectTitleById = new Map<string, string>();
  for (const d of depts) {
    if (d.id != null) deptNameById.set(String(d.id), text(d.name) || UNKNOWN_NAME);
    for (const p of records(d.projects)) {
      if (p.id != null) projectTitleById.set(String(p.id), text(p.title ?? p.name) || UNKNOWN_NAME);
    }
  }

  const okrProject = new Map<string, { deptId: string; projId: string }>();
  const projects = new Map<string, { deptId: string; projId: string; okrCount: number; lastAt: number | null }>();
  for (const o of records(args.okrs)) {
    const okrId = o.id != null ? String(o.id) : '';
    const deptId = o.department_id != null ? String(o.department_id) : '';
    const projId = o.project_id != null ? String(o.project_id) : '';
    if (!okrId || !deptId || !projId) continue;
    okrProject.set(okrId, { deptId, projId });
    const key = `${deptId}|${projId}`;
    const entry = projects.get(key) ?? { deptId, projId, okrCount: 0, lastAt: null };
    entry.okrCount += 1;
    projects.set(key, entry);
  }

  const lines: string[] = [header];
  if (args.companyLogsFailed) {
    lines.push('- 会社全体の進捗は取得できませんでした。全社の状況は断定しないでください。');
    return lines.join('\n');
  }

  for (const row of records(args.companyLogs)) {
    if (!isProgressLogCheckin(row)) continue;
    const link = okrProject.get(String(row.okr_id ?? ''));
    if (!link) continue;
    const at = timeOf(row.created_at);
    if (at === null) continue;
    const entry = projects.get(`${link.deptId}|${link.projId}`);
    if (entry && (entry.lastAt === null || at > entry.lastAt)) entry.lastAt = at;
  }

  const windowStart = args.now.getTime() - CHECKIN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const all = [...projects.values()];
  const checked = all.filter((p) => p.lastAt !== null && p.lastAt >= windowStart);
  const stale = all.filter((p) => !(p.lastAt !== null && p.lastAt >= windowStart));

  lines.push(
    `- 直近${CHECKIN_WINDOW_DAYS}日に確認があったプロジェクト: ${checked.length}/${all.length}件（OKRを持つプロジェクトのみ）`
  );
  if (stale.length > 0) {
    lines.push(`- 確認がないプロジェクト（${CHECKIN_WINDOW_DAYS}日以上）:`);
    stale.slice(0, STALE_LIST_MAX).forEach((p) => {
      const last = p.lastAt === null ? `${CHECKIN_LOOKBACK_DAYS}日以内の記録なし` : new Date(p.lastAt).toISOString().slice(0, 10);
      lines.push(
        `  - ${deptNameById.get(p.deptId) ?? UNKNOWN_NAME} / ${projectTitleById.get(p.projId) ?? UNKNOWN_NAME}（最終確認: ${last}）`
      );
    });
    if (stale.length > STALE_LIST_MAX) lines.push(`  （ほか${stale.length - STALE_LIST_MAX}件）`);
  }
  lines.push('- 確認記録がないことだけでは、進捗の状況（遅れの有無）は判断できない。遅延と断定しない。');
  lines.push('- 確認日時の集計のみを使い、他の利用者の本文は含めない。');

  let out = lines.join('\n');
  if (out.length > STAGE5_CHAR_BUDGET) out = `${out.slice(0, STAGE5_CHAR_BUDGET)}…（上限のため省略）`;
  return out;
}
