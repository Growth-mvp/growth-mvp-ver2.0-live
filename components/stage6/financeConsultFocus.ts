import type { ConsultFocus } from '@/lib/consult/consultFocus';
import type { CfYear } from '@/utils/stage6/cashflow';
import type { DebtSchedule } from '@/utils/stage6/debt';
import type { CashFlowForm } from './CashFlowSection';
import type { DebtForm } from './DebtPanel';
import type { OutlookCharts } from './financeOutlookChartModel';
import type { BaseScenarioForm } from './financePlanForm';
import {
  overallVerdictOf,
  repaymentOutlook,
  tabLabelOf,
  verdictNarrativeOf,
  type FinanceTab,
  type InvestmentSummary,
} from './financePlanStatus';
import { formatMil, type CashSummary, type FundingStatus } from './financeSummaryModel';
import { PROVISIONAL_CONCLUSION } from './FinanceVerdictPanel';

/** 相談文脈の登録名。この画面で1か所だけ使う */
export const FINANCE_CONSULT_OWNER = 'stage6-finance-plan';

/** ConsultFocusSchema の items 上限（12件）。超えると文脈全体が無効になるため、必ずこの数以内にする */
const MAX_ITEMS = 12;
const UNSET = '未入力';

const RECON_LABEL: Record<DebtSchedule['reconciliation']['status'], string> = {
  MATCH: '一致',
  DIFFERENT: '不一致',
  NOT_ENTERED: '未照合',
};

type Item = NonNullable<ConsultFocus['items']>[number];

export type FinanceConsultInput = {
  /** 「詳しく確認する」が開いているときだけ、その中のタブ。閉じている間は null（画面に出ていないため含めない） */
  detailTab: FinanceTab | null;
  /** 財務条件の入力が、正式に保存した内容と同じか */
  formSaved: boolean;
  /** 試算結果（業績予測・資金の状況）が、保存済みの内容と同じか（入力も保存データも変更なし） */
  planSaved: boolean;
  /** STAGE1・STAGE4 由来の値が保存済みか（store の dirty が false か） */
  sourceSaved: boolean;
  charts: OutlookCharts;
  cash: CashSummary;
  funding: FundingStatus;
  forecastYears: number[];
  scenario: BaseScenarioForm;
  effect: { included: number; excluded: number };
  investment: Pick<InvestmentSummary, 'readyYen' | 'readyCount'>;
  attention: { count: number; yen: number };
  cfForm: CashFlowForm;
  debtForm: DebtForm;
  reconciliation: DebtSchedule['reconciliation'];
  verdict: { provisional: boolean; debtEntered: boolean; years: CfYear[]; fundingNeed: number | null };
};

const item = (label: string, value: string, saved: boolean): Item => ({ label, value, saved });
const filled = (s: string) => (s.trim() === '' ? UNSET : s.trim());
const yenText = (yen: number) => `${yen.toLocaleString('ja-JP')} 円`;
const milOrPending = (yen: number | null) => (yen === null ? '未確定' : formatMil(yen));

function cashText(cash: CashSummary): string {
  if (cash.points.length === 0) return '推計年度がありません';
  return cash.points
    .map((p) => `${p.fiscalYear}年度 ${p.conditionalYen === null ? '未算定' : formatMil(p.conditionalYen)}`)
    .join('、');
}

function effectText(e: { included: number; excluded: number }): string {
  const head = e.included > 0 ? `${e.included}件を反映` : '反映する効果はありません';
  return e.excluded > 0 ? `${head}（${e.excluded}件は試算に含めていません）` : head;
}

function yearlyText(years: number[], form: BaseScenarioForm, key: 'revenue' | 'operatingIncome'): string {
  if (years.length === 0) return '推計年度がありません';
  return years.map((y) => `${y}年度 ${form[y]?.[key]?.trim() || '横ばい'}`).join('、');
}

/** 常に画面に出ている要約（①業績予測・③資金の状況） */
function summaryItems(x: FinanceConsultInput): Item[] {
  const { charts, cash, funding } = x;
  return [
    item('売上・営業利益の前提', charts.basisText, x.planSaved),
    item('売上の見通し', charts.revenue.headline, x.planSaved),
    item('営業利益の見通し', charts.operatingIncome.headline, x.planSaved),
    item('事業キャッシュフロー（施策反映後・百万円）', cashText(cash), x.planSaved),
    item('借入・返済の見通し（参考）', funding.detail ? `${funding.label}（${funding.detail}）` : funding.label, x.planSaved),
  ];
}

function verdictItems(x: FinanceConsultInput): Item[] {
  const { provisional, debtEntered, years, fundingNeed } = x.verdict;
  const label = provisional ? '暫定（確定判定なし）' : overallVerdictOf(repaymentOutlook({ debtEntered, years })).label;
  const conclusion = provisional
    ? PROVISIONAL_CONCLUSION
    : verdictNarrativeOf({ debtEntered, years }).conclusion;
  const last = years[years.length - 1];
  const closing = last?.closingCashAfterFinancing.value ?? null;
  return [
    item('判定（参考）', label, x.planSaved),
    item('結論（参考）', conclusion, x.planSaved),
    item(
      '資金不足額（借入反映前の年度別不足額の最大・百万円）',
      fundingNeed === null ? '未確定' : formatMil(fundingNeed),
      x.planSaved,
    ),
    item(
      '期末現預金（借入反映後・百万円）',
      last && closing !== null ? `${formatMil(closing)}（${last.year}年末）` : '未確定',
      x.planSaved,
    ),
  ];
}

/** 開いている詳細タブの入力欄・確認項目（表示中の内容だけ） */
function tabItems(x: FinanceConsultInput, tab: FinanceTab): Item[] {
  switch (tab) {
    case 'target':
      return [
        item('既存事業の売上の増減（直近実績比・百万円）', yearlyText(x.forecastYears, x.scenario, 'revenue'), x.formSaved),
        item(
          '既存事業の営業利益の増減（直近実績比・百万円）',
          yearlyText(x.forecastYears, x.scenario, 'operatingIncome'),
          x.formSaved,
        ),
        item('確認済みの施策効果（STAGE4）', effectText(x.effect), x.planSaved),
      ];
    case 'investment':
      return [
        item(
          '資金計画に反映する確認済み投資・費用額',
          `${yenText(x.investment.readyYen)}（${x.investment.readyCount}件）`,
          x.sourceSaved,
        ),
        item('未確定・確認が必要な金額', `${yenText(x.attention.yen)}（${x.attention.count}件）`, x.sourceSaved),
      ];
    case 'cashflow': {
      const f = x.cfForm;
      return [
        item('手元に残しておきたいお金（最低必要現預金・百万円）', filled(f.minCash), x.formSaved),
        item('税率（%）', filled(f.taxRate), x.formSaved),
        item('減価償却費（百万円）', filled(f.depreciation), x.formSaved),
        item(
          '運転資金の比率（%：売上に対する未回収代金・在庫・仕入先への未払額）',
          `未回収代金 ${filled(f.ar)} ／ 在庫 ${filled(f.inventory)} ／ 仕入先への未払額 ${filled(f.ap)}`,
          x.formSaved,
        ),
        item(
          '経営目標（補間の前提）',
          `売上 ${filled(f.targetRevenue)} 百万円 ／ 営業利益 ${filled(f.targetOperatingIncome)} 百万円 ／ 目標年度 ${filled(f.targetYear)}`,
          x.formSaved,
        ),
      ];
    }
    case 'debt': {
      const f = x.debtForm;
      const rec = x.reconciliation;
      return [
        item(
          '既存借入の内訳（名称・基準年度末残高・金利）',
          f.existing.length === 0
            ? UNSET
            : f.existing
                .map((r) => `${r.name || '既存借入'}：残高 ${filled(r.balance)} 百万円、金利 ${filled(r.rate)}%`)
                .join('、'),
          x.formSaved,
        ),
        item(
          '新規借入計画（名称・実行年度・金額・金利）',
          f.newLoans.length === 0
            ? UNSET
            : f.newLoans
                .map((r) => `${r.name || '新規借入'}：${filled(r.drawYear)}年 ${filled(r.amount)} 百万円、金利 ${filled(r.rate)}%`)
                .join('、'),
          x.formSaved,
        ),
        item(
          '配当等（入力・百万円）',
          x.forecastYears.map((y) => `${y}年度 ${filled(f.dividends[y] ?? '')}`).join('、') || UNSET,
          x.formSaved,
        ),
        item(
          '借入残高の照合（STAGE1の有利子負債と内訳合計・百万円）',
          `STAGE1 ${milOrPending(rec.stage1InterestBearingDebtYen)} ／ 内訳合計 ${milOrPending(rec.statedTotalYen)}（${RECON_LABEL[rec.status]}）`,
          x.planSaved,
        ),
      ];
    }
    case 'verdict':
      return verdictItems(x);
  }
}

/**
 * 「経営計画の実現見通し」画面の相談文脈を作る。表示中の内容だけを含める（詳細が閉じていれば要約のみ）。
 * saved の意味：formSaved＝財務条件の入力が保存済みと同じ、planSaved＝入力と試算が保存済みと同じ、
 * sourceSaved＝STAGE1・STAGE4の元データが保存済み。判定できない場合は呼び出し側で false を渡す。
 */
export function buildFinanceConsultFocus(x: FinanceConsultInput): Omit<ConsultFocus, 'pathname'> {
  const items = [...summaryItems(x), ...(x.detailTab ? tabItems(x, x.detailTab) : [])].slice(0, MAX_ITEMS);
  return {
    stage: 6,
    section: x.detailTab ? `経営計画の実現見通し／${tabLabelOf(x.detailTab)}` : '経営計画の実現見通し（要約）',
    items,
  };
}
