import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { buildUnifiedPl } from '@/utils/stage6/unifiedPl';
import { UnifiedPlPanel } from './UnifiedPlPanel';

const M = 1_000_000;
const baseline = [2027, 2028].map((fiscalYear) => ({ fiscalYear, revenueYen: 1_000 * M, operatingIncomeYen: 70 * M }));

const trialWith = (years: FinanceEffectTrial['years'], included: FinanceEffectTrial['included'] = []): FinanceEffectTrial => ({
  ready: true,
  notSetCount: 0,
  included,
  excluded: [],
  revenueCostUnknown: [],
  legacyReferenced: [],
  years,
});

const cells = (html: string) => [...html.matchAll(/<td class="px-2 py-1[^"]*">([^<]*)<\/td>/g)].map((m) => m[1]);

describe('統一PLの表示', () => {
  it('費用削減のみ：営業費用は減り、営業利益は増える。効果の列は営業費用の増減で表す', () => {
    const years = [
      { fiscalYear: 2027, revenueYen: 0, costReductionYen: 3 * M, costIncreaseYen: 0, operatingEffectYen: 3 * M },
      { fiscalYear: 2028, revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 },
    ];
    const plan = buildUnifiedPl({ baseline, effects: years, target: null });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel plan={plan} trial={trialWith(years, [{ deptName: '製造部', projectTitle: '工程改善', kind: 'COST_REDUCTION' }])} />,
    );
    // 手計算（2027年度）：ベースラインの営業費用 1,000 − 70 = 930 → 費用削減 3 で 927。営業利益 70 + 3 = 73
    const row = cells(html).slice(1, 10);
    expect(row).toEqual(['1,000.0', '0.0', '1,000.0', '930.0', '−3.0', '0.0', '927.0', '70.0', '73.0']);
  });

  it('売上増加の年度は、営業費用と営業利益を未算定と表示し、0と書かない', () => {
    const years = [
      { fiscalYear: 2027, revenueYen: 60 * M, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 },
      { fiscalYear: 2028, revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 },
    ];
    const plan = buildUnifiedPl({ baseline, effects: years, target: null });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel plan={plan} trial={trialWith(years, [{ deptName: '営業部', projectTitle: '新規開拓', kind: 'REVENUE_UP' }])} />,
    );
    const row = cells(html).slice(1, 10);
    expect(row).toEqual(['1,000.0', '+60.0', '1,060.0', '930.0', '0.0', '0.0', '未算定', '70.0', '未算定']);
    expect(html).toContain('売上増加に対応する売上原価・変動費が未確定のため、営業費用と営業利益は未算定');
  });

  it('タブ1は試算の根拠の4項目を表示し、経営目標・目標との差額は表示しない', () => {
    const target = { revenueYen: 1_200 * M, revenueDueYear: 2028, operatingIncomeYen: 80 * M, operatingIncomeDueYear: 2027 };
    const plan = buildUnifiedPl({ baseline, effects: [], target });
    const html = renderToStaticMarkup(<UnifiedPlPanel plan={plan} trial={trialWith([])} />);
    expect(html).toContain('施策効果を反映した試算');
    expect(html).toContain('現在の業績を基にした試算（直近実績を横ばいに置いた暫定仮定）');
    expect(html).toContain('確認済み施策効果');
    expect(html).toContain('年度別の試算結果（計算内訳を表示）');
    expect(html).not.toContain('経営目標');
    expect(html).not.toContain('目標との差額');
    expect(html).not.toContain('不足 200.0 百万円');
    expect(html).not.toContain('不足 10.0 百万円');
    expect(html).not.toContain('目標を達成');
  });

  it('決算月が未設定なら表を出さず、その旨を表示する', () => {
    const plan = buildUnifiedPl({ baseline, effects: [], target: null });
    const html = renderToStaticMarkup(<UnifiedPlPanel plan={plan} trial={{ ...trialWith([]), ready: false }} />);
    expect(html).toContain('決算月が未設定');
    expect(html).not.toContain('<table');
  });

  it('旧来の北極星の金額は削除せず参考情報として残し、統一PLには加算していないと表示する', () => {
    const plan = buildUnifiedPl({ baseline, effects: [], target: null });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel plan={plan} trial={{ ...trialWith([]), legacyReferenced: [{ deptName: '営業部', projectTitle: '新規開拓' }] }} />,
    );
    expect(html).toContain('削除せず参考情報として保持しており、この試算には加算していません（新規開拓）');
    expect(html).not.toContain('北極星');
  });

  it('わずかに負の値（四捨五入で0.0）を「-0.0」と書かない', () => {
    const negligible = [{ fiscalYear: 2028, revenueYen: 0, operatingIncomeYen: -40_000 }];
    const plan = buildUnifiedPl({ baseline: negligible, effects: [], target: null });
    const html = renderToStaticMarkup(<UnifiedPlPanel plan={plan} trial={trialWith([])} />);
    expect(plan.years[0].plan.operatingIncomeYen).toBe(-40_000);
    expect(html).not.toContain('-0.0');
    expect(cells(html)).toContain('0.0');
  });
});
