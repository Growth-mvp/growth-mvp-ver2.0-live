import { buildMidtermCandidates } from './midtermCandidates';

const bridge = {
  keyThemes: ['点検サービスの高付加価値化', '点検サービスの高付加価値化', '新規顧客の開拓'],
  commonBehaviorChanges: ['顧客の稼働率を高める投資を優先する'],
  departmentTranslationRules: ['部門KPIは全社目標から展開する'],
  strategicCore: { customerValue: '設備を止めない提案力' },
};

describe('buildMidtermCandidates', () => {
  it('中計が無い場合、既存の構造化データから4項目の候補を作る（重複は除く）', () => {
    const candidates = buildMidtermCandidates(bridge, undefined);
    expect(candidates.map((c) => c.field)).toEqual([
      'targetVisionForMidterm',
      'priorityStrategicThemes',
      'companyWideDecisionCriteria',
      'deploymentPrinciplesForUnits',
    ]);
    expect(candidates.find((c) => c.field === 'priorityStrategicThemes')?.items).toEqual([
      '点検サービスの高付加価値化',
      '新規顧客の開拓',
    ]);
  });

  it('既に値がある項目は候補にしない', () => {
    const candidates = buildMidtermCandidates(bridge, { priorityStrategicThemes: ['既存テーマ'], targetVisionForMidterm: '既存の姿' });
    expect(candidates.map((c) => c.field)).toEqual(['companyWideDecisionCriteria', 'deploymentPrinciplesForUnits']);
  });

  it('既存の構造化データが無い場合は候補を作らない', () => {
    expect(buildMidtermCandidates(null, undefined)).toEqual([]);
    expect(buildMidtermCandidates({}, undefined)).toEqual([]);
  });
});
