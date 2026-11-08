import { renderToStaticMarkup } from 'react-dom/server';
import type { AudienceType } from '@/utils/export/buildPlanData';
import { buildPlanData } from '@/utils/export/buildPlanData';
import PlanPreview from './PlanPreview';

const M = 1_000_000;

const effect = (over: Record<string, unknown>) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  source: 'USER_INPUT',
  confirmed: true,
  sourceNote: '架空の根拠',
  ...over,
});

/** モックの会社：確認済みの売上・費用削減、未確認の売上、入力不足の施策を含む */
const state = {
  companyName: 'テスト株式会社',
  fiscalYearEnd: '3',
  companyTargets: [{ id: 'rev', label: '売上', unit: '百万円', base: 1200, dueYear: 2027 }],
  departments: [
    {
      id: 'd1',
      name: '営業部',
      projects: [
        {
          id: 'p1',
          title: '新規法人顧客の獲得',
          planStatus: 'approved',
          financeEffect: effect({ directAmountYen: 120 * M, amountBasis: 'ANNUAL', startYm: '2026-04', operatingIncomeEffectYen: 30 * M }),
        },
        {
          id: 'p2',
          title: '配送ルート改善',
          planStatus: 'approved',
          financeEffect: effect({ kind: 'COST_REDUCTION', directAmountYen: 12 * M, amountBasis: 'ANNUAL', startYm: '2026-10' }),
        },
        {
          id: 'p3',
          title: '未確認の売上',
          planStatus: 'draft',
          financeEffect: effect({ directAmountYen: 100 * M, amountBasis: 'ANNUAL', startYm: '2026-04', confirmed: false }),
        },
        {
          id: 'p4',
          title: '入力不足の売上',
          planStatus: 'draft',
          financeEffect: effect({ directAmountYen: undefined, amountBasis: 'ANNUAL' }),
        },
      ],
    },
  ],
} as any;

const audiences: AudienceType[] = ['bank', 'shareholder', 'employee'];

describe('計画書の表示（モック）：財務効果は確認済みのみ、年額換算と明記', () => {
  it.each(audiences)('%s 向け：確認済みの年額換算を示し、未確認・未算定は金額にしない', (audience) => {
    const data = buildPlanData(state, audience);
    const html = renderToStaticMarkup(<PlanPreview data={data} audience={audience} />);
    expect(html).toContain('財務効果（売上）');
    expect(html).toContain('年額換算 +120百万円（確認済み）');
    expect(html).toContain('未確認（財務試算に含まない）');
    expect(html).toContain('未算定（不足：');
    expect(html).not.toContain('売上寄与:');
    expect(html).not.toContain('営業利益寄与:');
    expect(html).not.toContain('¥120M');
    expect(html).not.toContain('¥100M');
  });

  it('全社の確認済み合計は、年額換算の内訳として示し、加算しないと明記する（計画書データ）', () => {
    const data = buildPlanData(state, 'shareholder');
    expect(data.stage56.projectImpactSum).toContain('¥120M');
    expect(data.stage56.projectImpactSum).toContain('全社試算に含まれる内訳');
    expect(data.stage56.projectImpactSum).not.toContain('100');
  });
});
