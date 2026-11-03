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
      <UnifiedPlPanel plan={plan} trial={trialWith(years, [{ deptName: '製造部', projectTitle: '工程改善', kind: 'COST_REDUCTION' }])} target={{ revenueYen: null, revenueDueYear: null, operatingIncomeYen: null, operatingIncomeDueYear: null }} />,
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
      <UnifiedPlPanel plan={plan} trial={trialWith(years, [{ deptName: '営業部', projectTitle: '新規開拓', kind: 'REVENUE_UP' }])} target={{ revenueYen: null, revenueDueYear: null, operatingIncomeYen: null, operatingIncomeDueYear: null }} />,
    );
    const row = cells(html).slice(1, 10);
    expect(row).toEqual(['1,000.0', '+60.0', '1,060.0', '930.0', '0.0', '0.0', '未算定', '70.0', '未算定']);
    expect(html).toContain('売上増加に対応する売上原価・変動費が未確定のため、営業費用と営業利益は未算定');
  });

  it('名称：統一PL・ベースライン・確認済み効果・経営目標・目標との差額を区別して表示する', () => {
    const plan = buildUnifiedPl({ baseline, effects: [], target: { revenueYen: 1_200 * M, revenueDueYear: 2028, operatingIncomeYen: null, operatingIncomeDueYear: null } });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel plan={plan} trial={trialWith([])} target={{ revenueYen: 1_200 * M, revenueDueYear: 2028, operatingIncomeYen: null, operatingIncomeDueYear: null }} />,
    );
    expect(html).toContain('条件付きPL試算（統一PL）');
    expect(html).toContain('経営目標（STAGE2・予測に加算しない）');
    expect(html).toContain('ベースライン（直近実績を横ばいに置いた暫定仮定）');
    expect(html).toContain('確認済み施策効果');
    expect(html).toContain('目標との差額（経営目標 − 条件付きPL試算）');
    // 2028年度：売上 1,200 − 1,000 = 200 不足。営業利益の目標は未設定
    expect(html).toContain('不足 200.0 百万円');
    expect(html).toContain('経営目標（営業利益）が未設定のため差額は算出していません');
  });

  it('決算月が未設定なら表を出さず、その旨を表示する', () => {
    const plan = buildUnifiedPl({ baseline, effects: [], target: null });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel plan={plan} trial={{ ...trialWith([]), ready: false }} target={{ revenueYen: null, revenueDueYear: null, operatingIncomeYen: null, operatingIncomeDueYear: null }} />,
    );
    expect(html).toContain('決算月が未設定');
    expect(html).not.toContain('<table');
  });

  it('旧来の北極星の金額は削除せず参考情報として残し、統一PLには加算していないと表示する', () => {
    const plan = buildUnifiedPl({ baseline, effects: [], target: null });
    const html = renderToStaticMarkup(
      <UnifiedPlPanel
        plan={plan}
        trial={{ ...trialWith([]), legacyReferenced: [{ deptName: '営業部', projectTitle: '新規開拓' }] }}
        target={{ revenueYen: null, revenueDueYear: null, operatingIncomeYen: null, operatingIncomeDueYear: null }}
      />,
    );
    expect(html).toContain('削除せず参考情報として保持しており、この統一PLには加算していません（新規開拓）');
  });

  it('売上と営業利益の目標年度が異なるとき、指標ごとの年度と差額を表示する', () => {
    const target = { revenueYen: 1_200 * M, revenueDueYear: 2028, operatingIncomeYen: 80 * M, operatingIncomeDueYear: 2027 };
    const plan = buildUnifiedPl({ baseline, effects: [], target });
    const html = renderToStaticMarkup(<UnifiedPlPanel plan={plan} trial={trialWith([])} target={target} />);
    // 手計算：売上は 2028年度で 1,200 − 1,000 = 200 不足。営業利益は 2027年度で 80 − 70 = 10 不足
    expect(html).toContain('売上（2028年度）：不足 200.0 百万円');
    expect(html).toContain('営業利益（2027年度）：不足 10.0 百万円');
  });
});
