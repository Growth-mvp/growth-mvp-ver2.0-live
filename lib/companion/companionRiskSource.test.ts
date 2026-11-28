import { FICTIONAL_COMPANY_ID, FICTIONAL_STRATEGY_ROW } from '@/eval/quality/fictionalCompany';
import { riskCoverageFromStrategy, type RiskSourceArgs } from './companionRiskSource';

const BASE = {
  companyId: 'co-a',
  csvFinanceData: {},
  financePL: [],
  financeBS: [],
  departments: [],
  fiscalYearEnd: '3',
  currentYear: 2027,
  companyTargets: [],
  now: new Date('2027-06-15T00:00:00+09:00'),
};

const args = (patch: Partial<RiskSourceArgs>) => ({ ...BASE, ...patch }) as unknown as RiskSourceArgs;

describe('経営点検：判断できなかった項目（理由ごとに区別する）', () => {
  it('資金計画が保存されていなければ「未登録」、読めなければ「取得失敗」と書き分ける', () => {
    expect(riskCoverageFromStrategy(args({ csvFinanceData: {} }))).toContain('- 資金繰り：未登録（STAGE6の資金計画が保存されていません）');
    const broken = riskCoverageFromStrategy(args({ csvFinanceData: { financePlanAssumptions: { formatVersion: 999 } } }));
    expect(broken.some((l) => l.startsWith('- 資金繰り：取得失敗'))).toBe(true);
    expect(broken.filter((l) => l.includes('資金繰り')).some((l) => l.includes('未登録'))).toBe(false);
  });

  it('決算月が無ければ、売上効果の照合を「判断材料不足」とする', () => {
    const lines = riskCoverageFromStrategy(args({ fiscalYearEnd: undefined }));
    expect(lines.some((l) => l.startsWith('- 売上効果の計画と実績：判断材料不足'))).toBe(true);
  });

  it('KRも実施事項も無いときは、それぞれ「未登録」と書く（点検対象外とは書かない）', () => {
    const lines = riskCoverageFromStrategy(args({ departments: [] }));
    expect(lines).toContain('- KRの期限：未登録（部門の施策にKRがありません）');
    expect(lines).toContain('- 実施事項の進捗：未登録（進捗が1件も記録されていません）');
    expect(lines.join('\n')).not.toContain('点検対象外');
  });

  it('期限の無いKRは、期限超過を判定していないと書く（判断材料不足）', () => {
    const departments = [
      {
        name: '営業部',
        projects: [{ title: 'A', okrsV2: [{ label: 'x', target: 1, unit: '件' }, { label: 'y', target: 1, unit: '件', due: '2027-01' }] }],
      },
    ];
    const lines = riskCoverageFromStrategy(args({ departments }));
    expect(lines).toContain('- KRの期限：判断材料不足（期限が未入力のKRが1件あり、期限超過は判定していません）');
    expect(lines.some((l) => l.includes('KRの期限：未登録'))).toBe(false);
  });

  it('経営目標との差は、STAGE2の業績目標が無ければ「未登録」と書く（資金計画が保存済みでも）', () => {
    const row = FICTIONAL_STRATEGY_ROW as unknown as Record<string, unknown>;
    const lines = riskCoverageFromStrategy(
      args({
        csvFinanceData: row.csvFinanceData,
        financePL: row.financePL,
        financeBS: row.financeBS,
        companyTargets: [],
        companyId: FICTIONAL_COMPANY_ID,
      }),
    );
    expect(lines).toContain('- 経営目標との差：未登録（STAGE2の業績目標が保存されていません）');
    expect(lines.join('\n')).not.toContain('STAGE6の経営目標');
  });
});
