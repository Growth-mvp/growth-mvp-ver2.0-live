import { FICTIONAL_COMPANY_ID } from '@/eval/quality/fictionalCompany';
import { RISK_NOW, riskStrategyFixture } from '@/eval/quality/riskFixtures';
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

const texts = (r: { facts: { text: string }[] }) => r.facts.map((f) => f.text);

describe('経営点検：資金繰りの判定（未入力を0と見なさない）', () => {
  it('資金計画が未保存なら「未登録」と書き、資金不足なしとは扱わない', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ finance: 'none', stage6Target: false })));
    expect(r.coverage).toContain('- 資金繰り：未登録（STAGE6の資金計画が保存されていません）');
    expect(r.facts.some((f) => f.category === 'CASH')).toBe(false);
  });

  it('資金計画を読めなければ「取得失敗」と書き、未登録とは書かない', () => {
    const row = riskStrategyFixture({ minCashYen: 260_000_000 });
    row.csvFinanceData = { financePlanAssumptions: { formatVersion: 999 } };
    const r = riskInputsOf(argsOf(row));
    expect(r.coverage.some((l) => l.startsWith('- 資金繰り・STAGE6の経営目標：取得失敗'))).toBe(true);
    expect(r.coverage.join('\n')).not.toContain('資金繰り：未登録');
  });

  it('新規借入が未入力なら、0円とは見なさず、資金不足の事実も出さない（不足が起きうる条件でも）', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ minCashYen: 260_000_000, newLoan: 'none' })));
    expect(r.facts.some((f) => f.category === 'CASH')).toBe(false);
    expect(r.coverage.some((l) => l.includes('新規借入が未入力です。0円とは見なしていません'))).toBe(true);
  });

  it('新規借入に0円の行があれば、明示的なゼロとして資金不足を判定する', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ minCashYen: 260_000_000, newLoan: 'zero', dividends: 'zero' })));
    expect(texts(r).join('\n')).toContain('2026年度：施策反映・借入反映後の期末現預金が最低現預金を');
    expect(r.coverage.some((l) => l.startsWith('- 資金繰り'))).toBe(false);
  });

  it('配当が未入力の年度は、判定しない理由（配当額が未入力）を示す', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ minCashYen: 260_000_000, newLoan: 'zero', dividends: 'none' })));
    expect(r.facts.some((f) => f.category === 'CASH')).toBe(false);
    expect(r.coverage.some((l) => l.startsWith('- 資金繰り（') && l.includes('配当額が未入力'))).toBe(true);
  });
});

describe('経営点検：経営目標（STAGE2の業績目標とSTAGE6の経営目標）', () => {
  it('STAGE6だけに目標があっても、未達を判定し、出所をSTAGE6と示す', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ stage6Target: true, stage2Target: false })));
    expect(texts(r).join('\n')).toContain('2027年度の売上：STAGE6の経営目標に対して 70,000,000円 不足');
  });

  it('STAGE2だけに目標がある場合も、未達を判定し、出所をSTAGE2と示す', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ stage6Target: false, stage2Target: true })));
    expect(texts(r).join('\n')).toContain('2027年度の売上：STAGE2の業績目標に対して 70,000,000円 不足');
  });

  it('同じ目標を両方に登録していれば、二重に点検せず、STAGE2の一件だけを示す', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ stage6Target: true, stage2Target: true })));
    const target = r.facts.filter((f) => f.category === 'TARGET');
    expect(target).toHaveLength(2);
    expect(target.every((f) => f.text.includes('STAGE2の業績目標'))).toBe(true);
    expect(r.coverage.some((l) => l.includes('不整合'))).toBe(false);
  });

  it('両方に異なる目標があれば、年度・数値・出所を並べて不整合を示し、両方の目標で差を示す', () => {
    const row = riskStrategyFixture({ stage6Target: true, stage2Target: true });
    row.companyTargets[0].base = 1_200_000_000;
    const r = riskInputsOf(argsOf(row));
    const line = r.coverage.find((l) => l.includes('不整合'));
    expect(line).toContain('STAGE2は2027年度・1,200,000,000円');
    expect(line).toContain('STAGE6は2027年度・1,000,000,000円');
    const revenue = r.facts.filter((f) => f.text.startsWith('2027年度の売上'));
    expect(revenue).toHaveLength(2);
  });

  it('どちらにも目標が無ければ、未登録と書く', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ stage6Target: false, stage2Target: false })));
    expect(r.coverage).toContain('- 経営目標との差：未登録（STAGE2の業績目標もSTAGE6の経営目標も保存されていません）');
  });
});

describe('経営点検：その他の判断材料', () => {
  it('期限の無いKRは、期限超過を判定していないと書く', () => {
    const row = riskStrategyFixture();
    delete row.departments[0].projects[0].okrsV2[0].due;
    const r = riskInputsOf(argsOf(row));
    expect(r.coverage).toContain('- KRの期限：判断材料不足（期限が未入力のKRが1件あり、期限超過は判定していません）');
  });

  it('決算月が無ければ、売上効果の照合を判断材料不足とする', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture(), { fiscalYearEnd: undefined }));
    expect(r.coverage.some((l) => l.startsWith('- 売上効果の計画と実績：判断材料不足'))).toBe(true);
  });

  it('KRも実施事項も記録が無いときは、それぞれ未登録と書き、点検対象外とは書かない', () => {
    const r = riskInputsOf(argsOf(riskStrategyFixture({ finance: 'none', stage6Target: false }), { departments: [] }));
    expect(r.coverage).toContain('- KRの期限：未登録（部門の施策にKRがありません）');
    expect(r.coverage).toContain('- 実施事項の進捗：未登録（進捗が1件も記録されていません）');
    expect(r.coverage.join('\n')).not.toContain('点検対象外');
  });

  it('事実が0件で判断材料も揃っていれば、判断材料の不足は書かない（問題なしの根拠になる）', () => {
    const r = riskInputsOf(
      argsOf(riskStrategyFixture({ minCashYen: 150_000_000, newLoan: 'zero', dividends: 'zero', stage6Target: false, progress: 'recent' })),
    );
    expect(r.facts.some((f) => f.category === 'CASH')).toBe(false);
    expect(r.coverage.some((l) => l.startsWith('- 資金繰り'))).toBe(false);
  });
});
