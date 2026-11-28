import { FICTIONAL_COMPANY_ID } from '@/eval/quality/fictionalCompany';
import { RISK_NOW, riskStrategyFixture } from '@/eval/quality/riskFixtures';
import { RISK_GUARD } from './companionRisk';
import { riskInputsOf, type RiskSourceArgs } from './companionRiskSource';
import { riskSummaryOf } from './companionRiskSummary';

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

describe('経営点検：目標の年度の混同防止（判定の入力から要約まで）', () => {
  it('STAGE2（2027年度）とSTAGE6（2028年度）で目標年度が異なる場合、要約は年度ごとに別の文にし、年度を混ぜない', () => {
    const row = riskStrategyFixture({ stage6Target: true, stage2Target: true });
    row.companyTargets[0].dueYear = 2027;
    row.companyTargets[1].dueYear = 2027;
    row.csvFinanceData.financePlanAssumptions.cashFlow.targetYear = 2028;
    const r = riskInputsOf(argsOf(row));
    const summary = riskSummaryOf('ISSUES', r.highlights);
    const years = new Set(r.highlights.targetGaps.map((g) => g.fiscalYear));
    expect(years.has(2027)).toBe(true);
    expect(years.has(2028)).toBe(true);
    expect(summary).toContain('2027年度の経営目標に対して、');
    expect(summary).toContain('また、2028年度の経営目標に対して、');
    expect(r.highlights.inconsistentTargets).toBe(true);
  });

  it('STAGE2とSTAGE6で目標の数値が異なれば、不整合を示し、要約にもその旨を入れる', () => {
    const row = riskStrategyFixture({ stage6Target: true, stage2Target: true });
    row.companyTargets[0].base = 1_200_000_000;
    const r = riskInputsOf(argsOf(row));
    expect(r.highlights.inconsistentTargets).toBe(true);
    expect(r.coverage.some((l) => l.includes('不整合'))).toBe(true);
    expect(riskSummaryOf('ISSUES', r.highlights)).toContain('STAGE2とSTAGE6で経営目標の年度または数値が異なります');
  });

  it('同じ目標を両方に登録している場合は、不整合としない', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ stage6Target: true, stage2Target: true })));
    expect(r.highlights.inconsistentTargets).toBe(false);
  });
});
