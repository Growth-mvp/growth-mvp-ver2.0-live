import { FICTIONAL_COMPANY_ID } from '@/eval/quality/fictionalCompany';
import { RISK_NOW, riskStrategyFixture } from '@/eval/quality/riskFixtures';
import { RISK_GUARD } from './companionRisk';
import { riskInputsOf, type RiskSourceArgs } from './companionRiskSource';

function argsOf(row: Record<string, any>, patch: Partial<Record<string, unknown>> = {}): RiskSourceArgs {
  return {
    companyId: FICTIONAL_COMPANY_ID,
    csvFinanceData: row.csvFinanceData,
    financePL: row.financePL,
    financeBS: row.financeBS,
    departments: row.departments,
    fiscalYearEnd: row.fiscalYearEnd,
    currentYear: 2027,
    companyTargets: row.companyTargets,
    now: RISK_NOW,
    ...patch,
  } as unknown as RiskSourceArgs;
}

describe('経営点検の閲覧範囲（事実に担当者の個人名や他社の情報を含めない）', () => {
  it('事実と判断材料の状態に、部門・施策の担当者名を含めない', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ minCashYen: 260_000_000, krOverdue: true, progress: 'stalled', stage2Target: true })));
    const text = [...r.facts.map((f) => f.text), ...r.coverage].join('\n');
    for (const name of ['佐藤花子', '鈴木一郎', '田中次郎']) expect(text).not.toContain(name);
    expect(r.facts.length).toBeGreaterThan(0);
  });

  it('他社の資金計画（会社が一致しない保存データ）は、事実に使わない', () => {
    const row = riskStrategyFixture({ minCashYen: 260_000_000 });
    row.csvFinanceData.financePlanAssumptions.companyId = 'quality-company-b';
    const r = riskInputsOf(argsOf(row));
    expect(r.facts.some((f) => f.category === 'CASH')).toBe(false);
    expect(r.coverage.some((l) => l.includes('取得失敗'))).toBe(true);
  });
});

describe('経営点検：STAGE6の目標年度が予測期間の外にある場合', () => {
  it('判定できなかった理由を示し、差を作らない（予測期間の計算は変えない）', () => {
    const row = riskStrategyFixture({ stage6Target: true });
    row.csvFinanceData.financePlanAssumptions.cashFlow.targetYear = 2040;
    const r = riskInputsOf(argsOf(row));
    expect(r.facts.some((f) => f.category === 'TARGET')).toBe(false);
    expect(r.coverage.some((l) => l.includes('STAGE6の経営目標') && l.includes('予測期間に含まれない'))).toBe(true);
  });
});

describe('経営点検：AIへの規則（登録されていない目標を前提にしない）', () => {
  it('目標は事実の一覧に示されたものだけを前提にし、前提付きの事実は前提を保つ', () => {
    expect(RISK_GUARD).toContain('事実の一覧に示された目標だけを前提にする');
    expect(RISK_GUARD).toContain('借入計画が確定しているとは書かない');
  });
});
