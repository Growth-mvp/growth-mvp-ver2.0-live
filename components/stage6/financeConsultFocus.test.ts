import { ConsultFocusSchema } from '@/lib/consult/consultFocus';
import { buildFinanceConsultFocus, type FinanceConsultInput } from './financeConsultFocus';
import type { OutlookCharts } from './financeOutlookChartModel';

const charts = {
  basis: 'FLAT',
  basisText: '横ばい仮定：既存事業の増減は未設定です',
  revenue: { label: '売上高', headline: '売上の見通しの要約' },
  operatingIncome: { label: '営業利益', headline: '営業利益の見通しの要約' },
} as unknown as OutlookCharts;

const base = (over: Partial<FinanceConsultInput> = {}): FinanceConsultInput => ({
  detailTab: null,
  formSaved: false,
  planSaved: false,
  sourceSaved: true,
  charts,
  cash: {
    points: [
      { fiscalYear: 2026, baselineYen: 1_000_000, conditionalYen: 1_000_000 },
      { fiscalYear: 2027, baselineYen: 1_000_000, conditionalYen: null },
    ],
    unknownReason: null,
  },
  funding: { kind: 'JUDGED', label: '評価保留', detail: '', tone: 'hold' },
  forecastYears: [2026, 2027],
  scenario: { 2026: { revenue: '5', operatingIncome: '' } },
  effect: { included: 1, excluded: 0 },
  investment: { readyYen: 2_000_000, readyCount: 2 },
  attention: { count: 1, yen: 500_000 },
  cfForm: {
    minCash: '',
    taxRate: '30',
    depreciation: '',
    ar: '',
    inventory: '',
    ap: '',
    targetRevenue: '',
    targetOperatingIncome: '',
    targetYear: '',
  },
  debtForm: { existing: [], newLoans: [], dividends: {}, seq: 0 },
  reconciliation: { status: 'NOT_ENTERED', statedTotalYen: null, stage1InterestBearingDebtYen: null, differenceYen: null },
  verdict: { provisional: false, debtEntered: false, years: [], fundingNeed: null },
  ...over,
});

const TABS = ['target', 'investment', 'cashflow', 'debt', 'verdict'] as const;

describe('buildFinanceConsultFocus', () => {
  it('詳細が閉じているときは要約だけを含める（画面に出ていないタブは含めない）', () => {
    const focus = buildFinanceConsultFocus(base());
    expect(focus.section).toBe('経営計画の実現見通し（要約）');
    expect(focus.items?.map((i) => i.label)).not.toContain('税率（%）');
    expect(focus.items?.every((i) => i.saved === false)).toBe(true);
  });

  it('どのタブを開いても項目は12件以内で、相談文脈のスキーマを通る', () => {
    for (const tab of TABS) {
      const focus = buildFinanceConsultFocus(base({ detailTab: tab }));
      expect(focus.items!.length).toBeLessThanOrEqual(12);
      const parsed = ConsultFocusSchema.safeParse({ pathname: '/stage6', ...focus });
      expect(parsed.success).toBe(true);
    }
  });

  it('入力の保存状態と試算の保存状態を別々に反映する', () => {
    const focus = buildFinanceConsultFocus(
      base({ detailTab: 'target', formSaved: true, planSaved: false, sourceSaved: true }),
    );
    const byLabel = (label: string) => focus.items!.find((i) => i.label === label);
    expect(byLabel('既存事業の売上の増減（直近実績比・百万円）')?.saved).toBe(true);
    expect(byLabel('確認済みの施策効果（STAGE4）')?.saved).toBe(false);
    expect(byLabel('売上の見通し')?.saved).toBe(false);
  });

  it('STAGE4の投資額は元データの保存状態で判定する', () => {
    const focus = buildFinanceConsultFocus(
      base({ detailTab: 'investment', formSaved: false, planSaved: false, sourceSaved: true }),
    );
    const invest = focus.items!.find((i) => i.label === '資金計画に反映する確認済み投資・費用額');
    expect(invest?.saved).toBe(true);
    expect(invest?.value).toBe('2,000,000 円（2件）');
  });

  it('空欄の財務条件は未入力と表示する', () => {
    const focus = buildFinanceConsultFocus(base({ detailTab: 'cashflow' }));
    const minCash = focus.items!.find((i) => i.label.startsWith('手元に残しておきたいお金'));
    const tax = focus.items!.find((i) => i.label === '税率（%）');
    expect(minCash?.value).toBe('未入力');
    expect(tax?.value).toBe('30');
  });

  it('判定タブでは、判定が暫定のとき暫定と表示する', () => {
    const focus = buildFinanceConsultFocus(
      base({ detailTab: 'verdict', verdict: { provisional: true, debtEntered: false, years: [], fundingNeed: null } }),
    );
    expect(focus.section).toBe('経営計画の実現見通し／5. 参考判定');
    expect(focus.items!.find((i) => i.label === '判定（参考）')?.value).toBe('暫定（確定判定なし）');
  });
});
