import { collectPlanUnits, departmentKeyOf, projectIdOf } from '@/lib/cascade/stage3Adjustment';
import type { DeptProposal } from '@/lib/cascade/stage3Candidates';
import type { DraftDepartment, NewProjectCandidate, ProjectSelection, Selection } from '@/lib/cascade/stage3StrategyBook';

type AnyRecord = Record<string, unknown>;

const hasStableId = (v: AnyRecord) =>
  (typeof v.id === 'string' && v.id.trim() !== '') || (typeof v.id === 'number' && Number.isFinite(v.id));

/**
 * 草案の部門データを作る。既存の計画（安定IDのあるもの）はそのまま、生成された候補の計画を追加する。
 * 既存の計画と同じ ID の候補は追加しない。元の部門データは変えない。
 */
export function draftDepartmentsFrom(
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
): DraftDepartment[] {
  return official
    .filter((d) => d && typeof d === 'object' && typeof d.name === 'string' && d.name.trim() !== '')
    .map((d) => {
      const key = departmentKeyOf(d);
      const existing = collectPlanUnits([d]);
      const existingIds = new Set(existing.map((u) => u.projectId));
      const extra = collectPlanUnits([{ name: d.name, projects: candidateProjects[key] ?? [] }]).filter(
        (u) => !existingIds.has(u.projectId),
      );
      const toDraft = (u: (typeof existing)[number]) => ({
        ...(u.projectId.startsWith('id:') ? { id: u.projectId.slice(3) } : {}),
        title: u.projectTitle,
        ...(u.summary ? { description: u.summary } : {}),
        ...(u.kpis.length > 0 ? { kpis: u.kpis } : {}),
      });
      return {
        ...(hasStableId(d) ? { id: d.id as string | number } : {}),
        name: String(d.name),
        projects: [...existing, ...extra].map(toDraft),
      };
    });
}

/**
 * 変更案を作業状態の変更候補にする。保留・不採用の判断は残し、未判断の案だけを新しい案に置き換える。
 * 既存の判断と同じ部門・項目の案は、新しい案で置き換える（重複させない）。
 */
export function selectionsFrom(
  official: AnyRecord[],
  proposals: Record<string, DeptProposal[]>,
  previous: Selection[],
): Selection[] {
  const pendingKeys = new Set<string>();
  const pending: Selection[] = [];
  for (const d of official) {
    if (!d || typeof d !== 'object' || typeof d.name !== 'string') continue;
    const key = departmentKeyOf(d);
    for (const p of proposals[key] ?? []) {
      pendingKeys.add(`${key} ${p.item}`);
      pending.push({
        departmentKey: key,
        departmentName: String(d.name),
        item: p.item,
        proposed: p.proposed,
        base: p.base,
        decision: 'pending',
      });
    }
  }
  const decided = previous.filter((s) => s.decision !== 'pending' && !pendingKeys.has(`${s.departmentKey} ${s.item}`));
  return [...decided, ...pending];
}

/** 名称から決まる安定した候補ID（同じ部門・同じ名称の案は、再生成しても同じIDになる）。 */
export function candidateProjectId(departmentKey: string, title: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${departmentKey}|${title}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `np-${h.toString(16).padStart(8, '0')}`;
}

/**
 * 生成された候補プロジェクトのうち、既存の計画と重ならないものを、部門ごとの候補にする。
 * 候補は草案に保存するだけで、正式データには入れない。
 */
export function newProjectCandidatesFrom(
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
): NewProjectCandidate[] {
  const out: NewProjectCandidate[] = [];
  for (const d of official) {
    if (!d || typeof d !== 'object' || typeof d.name !== 'string' || d.name.trim() === '') continue;
    const key = departmentKeyOf(d);
    const existingIds = new Set(collectPlanUnits([d]).map((u) => u.projectId));
    const seen = new Set<string>();
    for (const p of candidateProjects[key] ?? []) {
      if (typeof p.title !== 'string' || p.title.trim() === '') continue;
      const unitId = projectIdOf(p);
      const candidateId = candidateProjectId(key, p.title.trim());
      if (existingIds.has(unitId) || seen.has(candidateId)) continue;
      seen.add(candidateId);
      out.push({ departmentKey: key, candidateId, project: JSON.parse(JSON.stringify(p)) as AnyRecord });
    }
  }
  return out;
}

/**
 * 新規候補の採否を作業状態にする。同じ候補IDの判断は引き継ぎ、新しい候補は未判断で入る。
 */
export function projectSelectionsFrom(
  official: AnyRecord[],
  candidates: NewProjectCandidate[],
  previous: ProjectSelection[],
): ProjectSelection[] {
  const names = new Map(
    official
      .filter((d) => d && typeof d === 'object' && typeof d.name === 'string')
      .map((d) => [departmentKeyOf(d), String(d.name)]),
  );
  const decided = new Map(previous.map((s) => [s.candidateId, s.decision]));
  return candidates.map((c) => ({
    departmentKey: c.departmentKey,
    departmentName: names.get(c.departmentKey) ?? c.departmentKey,
    candidateId: c.candidateId,
    title: String(c.project.title).trim(),
    decision: decided.get(c.candidateId) ?? 'pending',
  }));
}
