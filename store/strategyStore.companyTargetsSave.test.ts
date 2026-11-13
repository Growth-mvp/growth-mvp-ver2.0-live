import { buildSavePayload } from './strategyStore';

const target = { id: 't1', label: '売上高', unit: '百万円', base: 12000, linkedIssueIds: [], rationale: '' };

function stateWith(partial: Record<string, unknown>): any {
  return {
    companyId: 'c1',
    strategyId: 's1',
    departments: [],
    companyTargets: [],
    hydrated: false,
    ...partial,
  };
}

describe('業績目標の保存（空配列の上書き防止）', () => {
  it('読込前（未読込）の空の目標リストは保存対象にしない', () => {
    const payload: any = buildSavePayload(stateWith({ hydrated: false, companyTargets: [] }));
    expect(payload.companyTargets).toBeUndefined();
  });

  it('読込前でも、目標が1件以上ある場合は保存する（新規の目標を失わない）', () => {
    const payload: any = buildSavePayload(stateWith({ hydrated: false, companyTargets: [target] }));
    expect(payload.companyTargets).toMatchObject([{ id: 't1', label: '売上高', unit: '百万円', base: 12000 }]);
  });

  it('読込済みで利用者が目標を全件削除したときは、空の目標リストを保存する（明示的な削除）', () => {
    const payload: any = buildSavePayload(stateWith({ hydrated: true, companyTargets: [] }));
    expect(payload.companyTargets).toEqual([]);
  });

  it('読込済みの目標は、そのまま保存する（値・単位・年度を変えない）', () => {
    const withYear = { ...target, dueYear: 2030, priority: 4 };
    const payload: any = buildSavePayload(stateWith({ hydrated: true, companyTargets: [withYear] }));
    expect(payload.companyTargets).toMatchObject([{ id: 't1', label: '売上高', unit: '百万円', base: 12000, dueYear: 2030, priority: 4 }]);
  });
});
