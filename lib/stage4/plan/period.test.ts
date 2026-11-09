import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { addMonths, resolvePlanPeriod } from './period';
import { buildPlanSource } from './source';
import type { PlanSource } from './types';

const base = (): PlanSource => buildPlanSource(COMMERCIAL_INPUT).source;

describe('計画期間の決め方（優先順）', () => {
  it('翌月起点の加算は月をまたいでも正しい', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-11', 6)).toBe('2027-05');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('1. プロジェクト期限があれば、それを最優先にする', () => {
    const s = base();
    s.period.projectDeadlineYm = '2027-03';
    s.period.companyEndYear = '2028';
    s.period.fiscalYearEndMonth = 3;
    expect(resolvePlanPeriod(s)).toEqual({ startYm: '2026-12', endYm: '2027-03', basis: 'PROJECT_DEADLINE' });
  });

  it('2. プロジェクト期限が無ければ、全社計画期間の終了（決算期の月）を使う', () => {
    const s = base();
    s.period.projectDeadlineYm = null;
    s.period.companyEndYear = '2028';
    s.period.fiscalYearEndMonth = 3;
    expect(resolvePlanPeriod(s)).toEqual({ startYm: '2026-12', endYm: '2028-03', basis: 'COMPANY_PLAN' });
  });

  it('決算期が無い全社計画期間は使わない', () => {
    const s = base();
    s.period.companyEndYear = '2028';
    s.period.fiscalYearEndMonth = null;
    expect(resolvePlanPeriod(s).basis).toBe('STAGE3_KPI_DUE');
  });

  it('3. 上の根拠が無ければ、既存の確定KPIの期限のうち最も遅いものを使う', () => {
    const s = base();
    expect(resolvePlanPeriod(s)).toEqual({ startYm: '2026-12', endYm: '2027-05', basis: 'STAGE3_KPI_DUE' });
  });

  it('終了が開始より前の候補は採用しない', () => {
    const s = base();
    s.period.projectDeadlineYm = '2026-11';
    s.period.companyEndYear = '2026';
    s.period.fiscalYearEndMonth = 6;
    s.stage3.project.kpis = s.stage3.project.kpis.map((k) => ({ ...k, due: '2026-10' }));
    expect(resolvePlanPeriod(s)).toEqual({ startYm: '2026-12', endYm: null, basis: null });
  });

  it('4. どれも無ければ終了は未定（AIが仮期間を提案する）', () => {
    const s = base();
    s.stage3.project.kpis = s.stage3.project.kpis.map((k) => ({ ...k, due: null }));
    expect(resolvePlanPeriod(s)).toEqual({ startYm: '2026-12', endYm: null, basis: null });
  });
});
