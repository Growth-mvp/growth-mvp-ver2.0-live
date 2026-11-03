import { renderToStaticMarkup } from 'react-dom/server';
import type { CfYear } from '@/utils/stage6/cashflow';
import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { FinanceEffectTrialPanel } from './FinanceEffectTrialPanel';

const cfYear = (year: number, revenue: number | null, op: number | null) =>
  ({
    year,
    kind: 'FORECAST',
    revenue: { value: revenue, basis: 'ESTIMATE' },
    operatingIncome: { value: op, basis: 'ESTIMATE' },
  }) as unknown as CfYear;

const trial: FinanceEffectTrial = {
  ready: true,
  notSetCount: 1,
  included: [{ deptName: '製造部', projectTitle: '工程改善', kind: 'COST_REDUCTION' }],
  excluded: [{ deptName: '営業部', projectTitle: '根拠なし', reason: '入力不足のため未算定：算定根拠・出所' }],
  revenueCostUnknown: [],
  legacyReferenced: [],
  years: [
    { fiscalYear: 2027, revenueYen: 0, operatingEffectYen: 1_200_000 },
    { fiscalYear: 2028, revenueYen: 0, operatingEffectYen: 1_200_000 },
  ],
};

describe('確認済み仮説による条件付き試算の表示', () => {
  it('既存計画に財務効果を重ね、現金収支は未算定、見出しを明示する', () => {
    const html = renderToStaticMarkup(
      <FinanceEffectTrialPanel trial={trial} forecastYears={[cfYear(2027, 50_000_000, 4_000_000), cfYear(2028, 52_000_000, 4_500_000)]} targetEntered={false} />,
    );
    expect(html).toContain('確認済み仮説による条件付き試算');
    expect(html).toContain('2027年度');
    expect(html).toContain('+1.2');
    expect(html).toContain('5.2');
    expect(html).toContain('>未算定<');
    expect(html).toContain('営業部 / 根拠なし：入力不足のため未算定：算定根拠・出所');
  });

  it('既存計画の値がない年度は、試算欄を0ではなく未算定と表示する', () => {
    const html = renderToStaticMarkup(<FinanceEffectTrialPanel trial={trial} forecastYears={[cfYear(2027, null, null)]} targetEntered={false} />);
    const row = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
    expect((row.match(/未算定/g) ?? []).length).toBe(3);
  });

  it('決算月が未設定なら、年度の配分を行わない旨を表示する', () => {
    const html = renderToStaticMarkup(
      <FinanceEffectTrialPanel trial={{ ...trial, ready: false, years: [], included: [] }} forecastYears={[cfYear(2027, 1, 1)]} targetEntered={false} />,
    );
    expect(html).toContain('決算月が未設定');
    expect(html).not.toContain('<table');
  });

  it('売上増加の年度は、営業利益の試算を未算定にし、目標経路を使う場合は二重計上の注意を出す', () => {
    const revenueTrial: FinanceEffectTrial = {
      ...trial,
      included: [{ deptName: '営業部', projectTitle: '新規開拓', kind: 'REVENUE_UP' }],
      revenueCostUnknown: [{ deptName: '営業部', projectTitle: '新規開拓' }],
      years: [{ fiscalYear: 2027, revenueYen: 6_000_000, operatingEffectYen: 0 }],
    };
    const html = renderToStaticMarkup(
      <FinanceEffectTrialPanel trial={revenueTrial} forecastYears={[cfYear(2027, 50_000_000, 4_000_000)]} targetEntered />,
    );
    const cells = [...html.matchAll(/<td class="px-2 py-1[^"]*">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(cells.slice(1, 8)).toEqual(['50.0', '+6.0', '56.0', '4.0', '0.0', '未算定', '未算定']);
    expect(html).toContain('経営目標（目標売上・目標営業利益）は、この表の基準に含めていません');
  });
});
