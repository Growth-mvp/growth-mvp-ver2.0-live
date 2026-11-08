import { renderToStaticMarkup } from 'react-dom/server';
import type { ConditionalCf } from '@/utils/stage6/conditionalCf';
import { FinanceSummary } from './FinanceSummary';
import { buildCashSummary, buildFundingStatus, type CashSummary, type FundingStatus } from './financeSummaryModel';

const M = 1_000_000;

const emptyCash: CashSummary = { points: [], unknownReason: null };
const judged: FundingStatus = buildFundingStatus({
  targetPathInUse: false,
  outlook: { label: '評価保留', detail: '借入・配当が未入力です', tone: 'hold' },
});

function render(args: { cash?: CashSummary; funding?: FundingStatus; requiredItem?: { count: number; tab: 'debt' } | null }) {
  return renderToStaticMarkup(
    <FinanceSummary
      cash={args.cash ?? emptyCash}
      funding={args.funding ?? judged}
      requiredItem={args.requiredItem ?? null}
      onNavigate={() => {}}
    />,
  );
}

describe('STAGE6 資金サマリー', () => {
  it('資金：補間を前提に入力中なら判定を出さず、判定の場所を案内する', () => {
    const html = render({
      funding: buildFundingStatus({ targetPathInUse: true, outlook: { label: '資金不足あり', detail: '2028年', tone: 'warn' } }),
    });
    expect(html).not.toContain('資金不足あり');
    expect(html).toContain('補間の前提を入力中のため非表示（タブ5で確認）');
  });

  it('資金：借入が未入力なら、短く「未入力のため保留」と示す', () => {
    const html = render({});
    expect(html).toContain('未入力のため保留');
    expect(html).not.toContain('借入・配当が未入力です');
  });

  it('資金：判定に影響する未確認事項があれば件数と移動先を示す', () => {
    const html = render({ requiredItem: { count: 2, tab: 'debt' } });
    expect(html).toContain('判定に影響する未確認 2件');
    expect(html).toContain('「4. 借入・返済」へ移動');
  });

  it('資金：施策反映後の営業CFが一部未算定なら比較表示し、未算定年度を列挙する（理由は詳細へ）', () => {
    const cf = {
      debtEnabled: false,
      taxRate: 0.3,
      taxRateBasis: 'USER',
      years: [
        {
          fiscalYear: 2027,
          operatingIncomeYen: 70 * M,
          operatingCf: { conditionalYen: 53 * M, baselineYen: 53 * M, deltaYen: 0 },
          investingCfYen: null,
          financingCfYen: null,
          openingCashYen: null,
          closingCashYen: null,
          baselineClosingCashYen: null,
          unknownReasons: [],
        },
        {
          fiscalYear: 2028,
          operatingIncomeYen: null,
          operatingCf: { conditionalYen: null, baselineYen: 53 * M, deltaYen: null },
          investingCfYen: null,
          financingCfYen: null,
          openingCashYen: null,
          closingCashYen: null,
          baselineClosingCashYen: null,
          unknownReasons: ['営業利益が未算定のため、営業CF・期末現預金は算定しない（売上増加の原価が不明）'],
        },
      ],
    } as ConditionalCf;
    const html = render({ cash: buildCashSummary(cf) });
    expect(html).toContain('事業キャッシュフロー（営業CF）');
    expect(html).toContain('未算定：2028年（棒なし）');
    expect(html).not.toContain('売上増加の原価が不明');
    expect(html).not.toContain('>0.0<');
  });

  it('資金：施策反映前後が全年度で同じなら単一系列の説明を出す', () => {
    const cf = {
      debtEnabled: false,
      taxRate: 0.3,
      taxRateBasis: 'USER',
      years: [
        { fiscalYear: 2027, operatingIncomeYen: null, operatingCf: { conditionalYen: 53 * M, baselineYen: 53 * M, deltaYen: 0 }, investingCfYen: null, financingCfYen: null, openingCashYen: null, closingCashYen: null, baselineClosingCashYen: null, unknownReasons: [] },
      ],
    } as ConditionalCf;
    const html = render({ cash: buildCashSummary(cf) });
    expect(html).toContain('施策効果による差はありません');
    expect(html).not.toContain('未算定：');
  });

  it('資金：施策反映後が全年度未算定なら、グラフを出さず未算定とする', () => {
    const cf = {
      debtEnabled: false,
      taxRate: 0.3,
      taxRateBasis: 'USER',
      years: [
        { fiscalYear: 2027, operatingIncomeYen: null, operatingCf: { conditionalYen: null, baselineYen: 53 * M, deltaYen: null }, investingCfYen: null, financingCfYen: null, openingCashYen: null, closingCashYen: null, baselineClosingCashYen: null, unknownReasons: [] },
      ],
    } as ConditionalCf;
    const html = render({ cash: buildCashSummary(cf) });
    expect(html).toContain('施策反映後の営業CFは未算定です');
  });
});
