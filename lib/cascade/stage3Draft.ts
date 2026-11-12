import { collectPlanUnits, departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import type { DeptProposal } from '@/lib/cascade/stage3Candidates';
import type { DraftDepartment, Selection } from '@/lib/cascade/stage3StrategyBook';

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
