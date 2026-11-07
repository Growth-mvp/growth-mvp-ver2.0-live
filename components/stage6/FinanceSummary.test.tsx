import { renderToStaticMarkup } from 'react-dom/server';
import type { ConditionalCf } from '@/utils/stage6/conditionalCf';
import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { buildUnifiedPl, type PlTarget } from '@/utils/stage6/unifiedPl';
import { FinanceSummary } from './FinanceSummary';
import {
  buildCashSummary,
  buildFundingStatus,
  buildTargetSummary,
  formatMil,
  formatPct,
  gapText,
  type CashSummary,
  type FundingStatus,
  type TargetSummary,
} from './financeSummaryModel';

const M = 1_000_000;
const baseline = [2027, 2028].map((fiscalYear) => ({ fiscalYear, revenueYen: 1_000 * M, operatingIncomeYen: 70 * M }));
const target: PlTarget = { revenueYen: 1_200 * M, revenueDueYear: 2028, operatingIncomeYen: 80 * M, operatingIncomeDueYear: 2028 };
const noTarget: PlTarget = { revenueYen: null, revenueDueYear: null, operatingIncomeYen: null, operatingIncomeDueYear: null };

const trial: FinanceEffectTrial = {
  ready: true,
  notSetCount: 0,
  included: [],
  excluded: [],
  revenueCostUnknown: [],
  legacyReferenced: [],
  years: [],
};

const emptyCash: CashSummary = { points: [], unknownReason: null };
const judged: FundingStatus = buildFundingStatus({
  targetPathInUse: false,
  outlook: { label: '評価保留', detail: '借入・配当が未入力です', tone: 'hold' },
});

function render(args: { target: PlTarget; cash?: CashSummary; funding?: FundingStatus; requiredItem?: { count: number; tab: 'debt' } | null }) {
  const unifiedPl = buildUnifiedPl({ baseline, effects: [], target: args.target });
  const targetSummary: TargetSummary = buildTargetSummary({ unifiedPl, target: args.target });
  return renderToStaticMarkup(
    <FinanceSummary
      target={targetSummary}
      cash={args.cash ?? emptyCash}
      funding={args.funding ?? judged}
      requiredItem={args.requiredItem ?? null}
      onNavigate={() => {}}
    />,
  );
}

describe('STAGE6 トップサマリー', () => {
  it('達成率・目標・試算・差額を、トップで1か所だけ表示する', () => {
    const html = render({ target });

    expect(html).toContain(`${formatPct((1_000 / 1_200) * 100)}`);
    expect(html).toContain('83.3%');
    expect(html).toContain(`目標 <span class="font-semibold">${formatMil(1_200 * M)}</span>`);
    expect(html).toContain(`試算 <span class="font-semibold">${formatMil(1_000 * M)}</span> 百万円`);
    expect(html).toContain(gapText(200 * M));
    expect(html).toContain(gapText(10 * M));
    expect(html).toContain('2028年度');
  });

  it('達成率のバーは0〜100%に収め、aria に現在値を示す', () => {
    const html = render({ target });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="83"');
    expect(html).toContain('width:83.33333333333334%');
  });

  it('経営目標が未設定なら、達成率を出さず未設定と案内する（0や達成とは書かない）', () => {
    const html = render({ target: noTarget });
    expect(html).toContain('売上高の経営目標が未設定です（STAGE2で設定）');
    expect(html).toContain('営業利益の経営目標が未設定です（STAGE2で設定）');
    expect(html).not.toContain('目標を達成');
    expect(html).not.toContain('role="progressbar"');
  });

  it('目標年度が未設定なら、達成率を出さず年度未設定と案内する', () => {
    const html = render({ target: { ...target, revenueDueYear: null } });
    expect(html).toContain('目標 1,200.0 百万円。目標年度が未設定です');
  });

  it('試算が未算定の指標は、達成率を出さず理由は詳細タブに任せる', () => {
    const unifiedPl = buildUnifiedPl({
      baseline,
      effects: [{ fiscalYear: 2028, revenueYen: 50 * M, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 }] as FinanceEffectTrial['years'],
      target,
    });
    const targetSummary = buildTargetSummary({ unifiedPl, target });
    const html = renderToStaticMarkup(
      <FinanceSummary target={targetSummary} cash={emptyCash} funding={judged} requiredItem={null} onNavigate={() => {}} />,
    );
    expect(html).toContain('目標 80.0 百万円。試算は未算定です');
    expect(html).not.toContain('売上増加');
  });

  it('資金：補間を前提に入力中なら判定を出さず、判定の場所を案内する', () => {
    const html = render({
      target,
      funding: buildFundingStatus({ targetPathInUse: true, outlook: { label: '資金不足あり', detail: '2028年', tone: 'warn' } }),
    });
    expect(html).not.toContain('資金不足あり');
    expect(html).toContain('補間の前提を入力中のため非表示（タブ5で確認）');
  });

  it('資金：借入が未入力なら、短く「未入力のため保留」と示す', () => {
    const html = render({ target });
    expect(html).toContain('未入力のため保留');
    expect(html).not.toContain('借入・配当が未入力です');
  });

  it('資金：判定に影響する未確認事項があれば件数と移動先を示す', () => {
    const html = render({ target, requiredItem: { count: 2, tab: 'debt' } });
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
    const html = render({ target, cash: buildCashSummary(cf) });
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
    const html = render({ target, cash: buildCashSummary(cf) });
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
    const html = render({ target, cash: buildCashSummary(cf) });
    expect(html).toContain('施策反映後の営業CFは未算定です');
  });
});
