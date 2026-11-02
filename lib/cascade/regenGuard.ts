type AnyRecord = Record<string, any>;

export type RegenBlockItem = { projectTitle: string; reasons: string[] };

export type RegenGuardResult =
  | { allowed: true }
  | { allowed: false; reason: 'local' | 'db' | 'unknown'; items: RegenBlockItem[]; message: string };

const KNOWN_PLAN_STATUS = ['draft', 'review', 'approved'];
const PROGRESS_LIMIT = 5000;
const META_RE = /^__META__:({.+?})\n/;

export function findLocalStage4Data(projects: unknown[]): RegenBlockItem[] {
  const out: RegenBlockItem[] = [];
  for (const raw of Array.isArray(projects) ? projects : []) {
    const p = (raw ?? {}) as AnyRecord;
    const reasons: string[] = [];
    const status = p.planStatus;
    if (status !== undefined && status !== null && status !== 'draft') {
      reasons.push(
        KNOWN_PLAN_STATUS.includes(status)
          ? `承認状態: ${status === 'approved' ? '承認済み' : '確認中'}`
          : `承認状態が不明（${String(status)}）`
      );
    }
    if (p.approvedAt || p.approvedBy) reasons.push('承認の記録あり');
    for (const [key, label] of [
      ['executionHumanInvestments', '人的投資'],
      ['skillPlans', 'スキル計画'],
    ] as const) {
      const v = p[key];
      if (v === undefined || v === null) continue;
      if (!Array.isArray(v)) {
        reasons.push(`${label}の形式が不明`);
      } else if (v.length > 0) {
        reasons.push(`${label} ${v.length}件`);
      }
    }
    if (reasons.length > 0) out.push({ projectTitle: String(p.title ?? '(無題)'), reasons });
  }
  return out;
}

type DbHits =
  | { ok: true; okrByProject: Record<string, number>; logByProject: Record<string, number> }
  | { ok: false; error: string };

export async function findDbStage4Data(client: any, companyId: string, projectIds: string[]): Promise<DbHits> {
  const okrByProject: Record<string, number> = {};
  const logByProject: Record<string, number> = {};
  if (projectIds.length === 0) return { ok: true, okrByProject, logByProject };
  const idSet = new Set(projectIds);
  try {
    const okrRes = await client
      .from('okrs')
      .select('project_id')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .in('project_id', projectIds);
    if (okrRes.error) return { ok: false, error: `okrs: ${okrRes.error.message}` };
    for (const r of okrRes.data ?? []) {
      okrByProject[r.project_id] = (okrByProject[r.project_id] ?? 0) + 1;
    }

    // 削除フラグ（is_deleted）は参照しない。列の有無は未確認で、削除済みの記録も数えるため保守的になる
    const logRes = await client
      .from('progress_logs')
      .select('progress_text')
      .eq('company_id', companyId)
      .like('progress_text', '__META__:%')
      .limit(PROGRESS_LIMIT);
    if (logRes.error) return { ok: false, error: `progress_logs: ${logRes.error.message}` };
    const rows = logRes.data ?? [];
    if (rows.length >= PROGRESS_LIMIT) return { ok: false, error: '進捗ログが多く、判定の範囲を超えました' };
    for (const r of rows) {
      const text = typeof r.progress_text === 'string' ? r.progress_text : '';
      const m = text.match(META_RE);
      let pid: unknown;
      try {
        pid = m ? JSON.parse(m[1]).projectId : undefined;
      } catch {
        pid = undefined;
      }
      if (typeof pid !== 'string') {
        return { ok: false, error: '進捗ログの対象プロジェクトを判定できない記録があります' };
      }
      if (idSet.has(pid)) logByProject[pid] = (logByProject[pid] ?? 0) + 1;
    }
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e) };
  }
  return { ok: true, okrByProject, logByProject };
}

export function regenBlockMessage(departmentName: string, items: RegenBlockItem[]): string {
  const titles = items
    .slice(0, 5)
    .map((i) => `「${i.projectTitle}」（${i.reasons.slice(0, 2).join('、')}）`)
    .join('、');
  return (
    `${departmentName} の再生成を中止しました。承認・編集・保存済みの計画データがあり、再生成すると失われるおそれがあるためです。` +
    `対象：${titles}。既存のデータは変更していません。`
  );
}

export async function assessDepartmentRegen(args: {
  client: any;
  companyId: string | null | undefined;
  departmentName: string;
  projects: unknown[];
  projectIdOf: (p: AnyRecord) => string;
}): Promise<RegenGuardResult> {
  const { client, companyId, departmentName } = args;
  if (!companyId) {
    return {
      allowed: false,
      reason: 'unknown',
      items: [],
      message: `${departmentName} の再生成を中止しました。会社を確認できなかったためです。既存のデータは変更していません。`,
    };
  }
  const projects = Array.isArray(args.projects) ? (args.projects as AnyRecord[]) : [];

  const local = findLocalStage4Data(projects);
  if (local.length > 0) {
    return { allowed: false, reason: 'local', items: local, message: regenBlockMessage(departmentName, local) };
  }

  const ids = projects.map((p) => args.projectIdOf(p)).filter((id) => typeof id === 'string' && id.length > 0);
  const db = await findDbStage4Data(client, companyId, ids);
  if (!db.ok) {
    return {
      allowed: false,
      reason: 'unknown',
      items: [],
      message:
        `${departmentName} の再生成を中止しました。保存済みのデータを確認できなかったためです（${db.error}）。` +
        '既存のデータは変更していません。',
    };
  }

  const items: RegenBlockItem[] = [];
  for (const p of projects) {
    const id = args.projectIdOf(p);
    const reasons: string[] = [];
    const okr = db.okrByProject[id] ?? 0;
    const logs = db.logByProject[id] ?? 0;
    if (okr > 0) reasons.push(`保存済みのOKR ${okr}件`);
    if (logs > 0) reasons.push(`進捗ログ ${logs}件`);
    if (reasons.length > 0) items.push({ projectTitle: String(p.title ?? '(無題)'), reasons });
  }
  if (items.length > 0) {
    return { allowed: false, reason: 'db', items, message: regenBlockMessage(departmentName, items) };
  }
  return { allowed: true };
}
