/* 同じ部門IDが2つある古いデータ（NGKと同じ構造）で、STAGE3の検証が正しく判定することを確認する。
 * 部門名・プロジェクト名は架空。検証の基準は緩めない。 */
import { emptyWorkspaceState, verifyWorkspaceState } from './stage3StrategyBook';
import { collectPlanUnits, countDepartments } from './stage3Adjustment';

const dept = (id: string, name: string, projectIds: string[]) => ({
  id,
  name,
  projects: projectIds.map((pid) => ({ id: pid, title: `${name}の計画${pid}`, reason: '理由', hypothesis: '仮説' })),
});

/* 2つの部門が同じ dept_2 を持つ（保存時の補完IDが重複した状態） */
const legacyDepartments = () => [
  dept('dept_2', '部門A', ['p-a1', 'p-a2']),
  dept('dept_2', '部門B', ['p-b1']),
  dept('dept_unique_3', '部門C', ['p-c1']),
];

const draftWith = (departments: unknown[]) => ({
  ...emptyWorkspaceState(),
  drafts: [{ draftId: 'draft-ngk1', kind: 'initial' as const, version: 1, createdAt: '2026-11-26T00:00:00Z', departments, newProjects: [] }],
});

describe('同じ部門IDが重複した古いデータの検証', () => {
  it('重複したIDのまま、全部門を含む草案は不合格になる（検証を緩めない）', () => {
    const official = legacyDepartments();
    const result = verifyWorkspaceState(draftWith(official), official);
    expect(result).toEqual({ ok: false, error: 'draft_department_unknown' });
  });

  it('部門を1つだけ含む草案は、重複があっても合格する', () => {
    const official = legacyDepartments();
    expect(verifyWorkspaceState(draftWith([official[0]]), official).ok).toBe(true);
  });

  it('IDの重複を一意にした後（所属が確定した1件の修正後）は、全部門を含む草案が合格する', () => {
    const fixed = legacyDepartments().map((d, i) => (i === 1 ? { ...d, id: 'dept_2_b' } : d));
    expect(verifyWorkspaceState(draftWith(fixed), fixed).ok).toBe(true);
    expect(countDepartments(collectPlanUnits(fixed))).toBe(3);
  });

  it('重複したIDのままでは、同じIDの2部門が1部門として数えられる（分析の入力が欠ける）', () => {
    expect(countDepartments(collectPlanUnits(legacyDepartments()))).toBe(2);
  });
});
