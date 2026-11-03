/* 北極星の手動行（projectTargetImpacts）の解決と書き込み。施策の同一性・旧行・単位をここに集約する。 */
import { mjpyToUnit, yenPerUnit } from './impactUnits';

export const MANUAL_ROW_UNIT = 'million_yen';

/** 旧形式の行キー（部門名::施策名::添字）。STAGE6 の施策キーと同じ式 */
export function stage6ProjectKeyOf(dept: any, proj: any, idx: number): string {
  const deptName = dept?.name ?? dept?.departmentName ?? '（未名）';
  const title = proj?.title ?? '（未名）';
  return `${deptName}::${title}::${idx}`;
}

export function newProjectUid(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}`;
}

type ProjectRef = { key: string; uid: string | undefined; dept: string; title: string };

function listProjects(departments: any[]): ProjectRef[] {
  const out: ProjectRef[] = [];
  departments.forEach((d: any) => {
    (Array.isArray(d?.projects) ? d.projects : []).forEach((p: any, pIdx: number) => {
      out.push({
        key: stage6ProjectKeyOf(d, p, pIdx),
        uid: typeof p?.projectUid === 'string' && p.projectUid.length > 0 ? p.projectUid : undefined,
        dept: String(d?.name ?? d?.departmentName ?? '').trim(),
        title: String(p?.title ?? p?.name ?? '').trim(),
      });
    });
  });
  return out;
}

const isUidRow = (row: any) => typeof row?.projectId === 'string' && !row.projectId.includes('::');

function resolveRowProject(row: any, projects: ProjectRef[]): { project?: ProjectRef; reason?: string } {
  if (typeof row?.projectId !== 'string' || row.projectId.length === 0) return { reason: '施策のキーがない' };
  if (isUidRow(row)) {
    const hits = projects.filter((p) => p.uid === row.projectId);
    if (hits.length === 1) return { project: hits[0] };
    if (hits.length === 0) return { reason: '施策が見つからない（削除された、または未保存の可能性）' };
    return { reason: '同じIDの施策が複数あり特定できない' };
  }
  const parts = row.projectId.split('::');
  if (parts.length < 3) return { reason: '旧形式の施策キーを読み取れない' };
  const title = parts[parts.length - 2].trim();
  const dept = parts.slice(0, -2).join('::').trim();
  const hits = projects.filter((p) => p.dept === dept && p.title === title);
  if (hits.length === 1) return { project: hits[0] };
  if (hits.length === 0) return { reason: '施策が見つからない（改名・削除・未保存の可能性）' };
  return { reason: '同名の施策が複数あり、どれか特定できない' };
}

export type ExcludedImpact = { projectId: string; targetId: string; valueMJPY: number | null; reason: string };

export type ManualImpactResolution = {
  /** 集計に使う行。projectId は現在の施策キー、delta は目標の単位 */
  rows: any[];
  excluded: ExcludedImpact[];
  /** 行が指している施策（集計から外した行も含む）。書き込み時の所有判定に使う */
  owners: Array<{ rawIndex: number; projectKey: string; targetId: string }>;
};

export function resolveManualImpacts(args: {
  rows: any[] | undefined;
  departments: any[] | undefined;
  companyTargets: any[] | undefined;
}): ManualImpactResolution {
  const projects = listProjects(args.departments ?? []);
  const targetById = new Map<string, any>((args.companyTargets ?? []).map((t: any) => [t?.id, t]));
  const rawRows = args.rows ?? [];

  const resolved = rawRows.map((row, rawIndex) => ({ rawIndex, row, ...resolveRowProject(row, projects) }));
  const newerUidRowKeys = new Set(
    resolved.filter((x) => x.project && isUidRow(x.row)).map((x) => `${x.project!.key}|${x.row.targetId}`),
  );

  const rows: any[] = [];
  const excluded: ExcludedImpact[] = [];
  const owners: ManualImpactResolution['owners'] = [];
  const accepted = new Set<string>();

  for (const x of resolved) {
    const pid = typeof x.row?.projectId === 'string' ? x.row.projectId : '';
    const value = typeof x.row?.delta === 'number' ? x.row.delta : Number(x.row?.delta);
    const exclude = (reason: string) =>
      excluded.push({ projectId: pid, targetId: x.row?.targetId, valueMJPY: Number.isFinite(value) ? value : null, reason });

    if (!x.project) {
      exclude(x.reason ?? '施策を特定できない');
      continue;
    }
    owners.push({ rawIndex: x.rawIndex, projectKey: x.project.key, targetId: x.row.targetId });

    const key = `${x.project.key}|${x.row.targetId}`;
    if (!isUidRow(x.row) && newerUidRowKeys.has(key)) {
      exclude('同じ施策の新しい行があるため、旧行を集計から外した');
      continue;
    }
    const target = targetById.get(x.row.targetId);
    if (!target) {
      exclude('目標が見つからない');
      continue;
    }
    if (yenPerUnit(target.unit) === null) {
      exclude(`目標の単位が特定できない（${String(target.unit ?? '未設定')}）。要確認`);
      continue;
    }
    // 旧形式の行は、書き込み元が常に百万円で保存していたため百万円として扱う
    const rowUnit = x.row.deltaUnit ?? MANUAL_ROW_UNIT;
    if (rowUnit !== MANUAL_ROW_UNIT) {
      exclude('行の金額単位が特定できない。要確認');
      continue;
    }
    if (!Number.isFinite(value)) {
      exclude('金額が数値ではない');
      continue;
    }
    if (accepted.has(key)) {
      exclude('同じ施策・目標の行が重複している（先の行を採用）');
      continue;
    }
    const inUnit = mjpyToUnit(value, target.unit);
    if (inUnit === null) {
      exclude('単位を換算できない');
      continue;
    }
    accepted.add(key);
    rows.push({
      projectId: x.project.key,
      targetId: x.row.targetId,
      delta: inUnit,
      source: 'manual',
      locked: x.row.locked ?? true,
      notes: x.row.notes,
      confidence: x.row.confidence,
    });
  }

  return { rows, excluded, owners };
}

/** 施策の金額（百万円）を書き込んだ後の行。同じ施策・目標の既存行（旧形式を含む）は置き換え、削除はしない行は残す */
export function rowsAfterProjectTargetWrite(args: {
  rows: any[] | undefined;
  departments: any[];
  companyTargets: any[] | undefined;
  dIdx: number;
  pIdx: number;
  projectUid: string;
  targetId: string;
  valueMJPY: number | undefined;
  confidence?: number;
  notes: string;
}): any[] {
  const rows = args.rows ?? [];
  const deptPrev: any = args.departments[args.dIdx];
  const projPrev: any = deptPrev?.projects?.[args.pIdx];
  const thisKey = stage6ProjectKeyOf(deptPrev, projPrev, args.pIdx);
  const res = resolveManualImpacts({ rows, departments: args.departments, companyTargets: args.companyTargets });
  const toRemove = new Set(
    res.owners.filter((o) => o.projectKey === thisKey && o.targetId === args.targetId).map((o) => o.rawIndex),
  );
  const kept = rows.filter((_, i) => !toRemove.has(i));
  if (typeof args.valueMJPY === 'number' && Number.isFinite(args.valueMJPY)) {
    kept.push({
      projectId: args.projectUid,
      targetId: args.targetId,
      delta: args.valueMJPY,
      deltaUnit: MANUAL_ROW_UNIT,
      source: 'manual',
      locked: true,
      confidence: args.confidence,
      notes: args.notes,
    });
  }
  return kept;
}

/** 行の寄与（チャート用）。自動行は配分時に実行重みを掛け済みのため掛けない。手動行は従来どおり1回掛ける（妥当性は未確定。報告対象） */
export function chartEffectiveDelta(row: { delta: number; source?: string }, executionWeight: number): number {
  return row.source === 'auto' ? row.delta : row.delta * executionWeight;
}
