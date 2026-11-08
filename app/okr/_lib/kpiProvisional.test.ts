import { mergeGeneratedKpisIntoOkrsV2 } from './okrModels';

describe('AIのKPI目標は仮目標として区別し、既存の目標は変えない', () => {
  it('目標が空のKRにAIの目標を入れたら、仮目標（AI_PROVISIONAL）と記録する', () => {
    const merged = mergeGeneratedKpisIntoOkrsV2([{ id: 'k1', label: '新規法人顧客の契約数', target: 0, unit: '件' }], ['新規法人顧客の契約数'], [
      { label: '新規法人顧客の契約数', target: 3, unit: '件', due: '2027-05', owner: '', milestones: [] },
    ]);
    const kr = merged.okrsV2.find((k: any) => k.label === '新規法人顧客の契約数');
    expect(kr.target).toBe(3);
    expect(kr.targetBasis).toBe('AI_PROVISIONAL');
  });

  it('利用者が入れた目標は、AIの目標で上書きせず、仮目標の印も付けない', () => {
    const merged = mergeGeneratedKpisIntoOkrsV2([{ id: 'k2', label: '継続率', target: 95, unit: '%', targetBasis: undefined }], ['継続率'], [
      { label: '継続率', target: 80, unit: '%', due: '2027-05', owner: '', milestones: [] },
    ]);
    const kr = merged.okrsV2.find((k: any) => k.label === '継続率');
    expect(kr.target).toBe(95);
    expect(kr.targetBasis).toBeUndefined();
  });

  it('利用者が採用した目標（USER_CONFIRMED）は、AIの再反映で変わらない', () => {
    const merged = mergeGeneratedKpisIntoOkrsV2([{ id: 'k3', label: '退会率', target: 2, unit: '%', targetBasis: 'USER_CONFIRMED' }], ['退会率'], [
      { label: '退会率', target: 2.5, unit: '%', due: '2027-05', owner: '', milestones: [] },
    ]);
    const kr = merged.okrsV2.find((k: any) => k.label === '退会率');
    expect(kr.target).toBe(2);
    expect(kr.targetBasis).toBe('USER_CONFIRMED');
  });
});
