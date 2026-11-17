'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { COMPANY_SWITCH_SAVE_MESSAGE, useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { buildInvestmentDemandSummary, parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { opexDeductionOfProjects, opexDeductionYearly } from '@/utils/stage6/opexDeduction';
import { buildCashFlowPlan } from '@/utils/stage6/cashflow';
import { buildDebtSchedule, type DebtSchedule } from '@/utils/stage6/debt';
import { buildFinanceOutlook, forecastHorizonOf } from '@/utils/stage6/financeOutlook';
import { withoutTargetPath } from '@/utils/stage6/financeEffectPlan';
import { UnifiedPlPanel } from './UnifiedPlPanel';
import { ConditionalCfPanel } from './ConditionalCfPanel';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  describeSaveError,
  financePlanUnsaved,
  freshnessLabel,
  hashOf,
  judgeFreshness,
  readStoredFinancePlan,
  sourceHashOf,
  toSavedFinancePlan,
  workingHashOf,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { CashFlowPanel, EMPTY_CASHFLOW_FORM, type CashFlowForm } from './CashFlowSection';
import { DebtPanel, EMPTY_DEBT_FORM, fundingNeedOf, isDebtEntered, type DebtForm } from './DebtPanel';
import { FinanceVerdictPanel } from './FinanceVerdictPanel';
import { FinanceSummary } from './FinanceSummary';
import { FinanceOutlookCharts } from './FinanceOutlookCharts';
import { FinanceEffectProjectList } from './FinanceEffectProjectList';
import Stage4ScenarioPanel from './Stage4ScenarioPanel';
import { PlanActualByProject } from './PlanActualByProject';
import { buildOutlookCharts } from './financeOutlookChartModel';
import { FundingDemandSection } from './FundingDemandSection';
import { BaseScenarioPanel } from './BaseScenarioPanel';
import {
  FINANCE_TABS,
  SAVE_STATUS_LABEL,
  buildUnconfirmedItems,
  deriveSaveStatus,
  provisionalFundingReasonsOf,
  repaymentOutlook,
  withProvisionalItem,
  type FinanceTab,
  type SaveStatus,
} from './financePlanStatus';
import { buildCashSummary, buildFundingStatus, buildTargetSummary, type FundingStatus } from './financeSummaryModel';
import {
  baseScenarioFormFrom,
  cashFlowFormFrom,
  debtFormFrom,
  toBaseScenario,
  toCashFlowAssumptions,
  toDebtDomain,
  type BaseScenarioForm,
  toDebtInput,
} from './financePlanForm';

const EMPTY_DEPARTMENTS: Department[] = [];
const EMPTY_PL: FinancePLRow[] = [];
const EMPTY_BS: FinanceBSRow[] = [];
const NOW_YEAR = new Date().getFullYear();

const SAVE_STATUS_CLASS: Record<SaveStatus, string> = {
  SAVING: 'bg-sky-100 text-sky-800',
  FAILED: 'bg-rose-100 text-rose-800',
  UNSAVED: 'bg-amber-100 text-amber-800',
  STALE: 'bg-amber-100 text-amber-800',
  SAVED: 'bg-emerald-100 text-emerald-800',
  NOT_SAVED: 'bg-slate-200 text-slate-700',
};

function TabHeader({ tab }: { tab: FinanceTab }) {
  const entry = FINANCE_TABS.find((t) => t.key === tab);
  return (
    <div>
      <h3 className="text-base font-bold text-slate-900">{entry?.label}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 break-keep">{entry?.description}</p>
    </div>
  );
}

export function FinancePlanSection() {
  const companyId = useStrategyStore((s: StrategyState) => s.companyId ?? null);
  return <FinancePlanContent key={companyId ?? 'no-company'} companyId={companyId} />;
}

function FinancePlanContent({ companyId }: { companyId: string | null }) {
  const departments = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.departments) ? s.departments : EMPTY_DEPARTMENTS,
  );
  const strategyId = useStrategyStore((s: StrategyState) => s.strategyId ?? null);
  const fiscalYearEnd = useStrategyStore((s: StrategyState) => s.fiscalYearEnd);
  const companyTargets = useStrategyStore((s: StrategyState) => s.companyTargets);
  const financePL = useStrategyStore((s: StrategyState) => (Array.isArray(s.financePL) ? s.financePL : EMPTY_PL));
  const financeBS = useStrategyStore((s: StrategyState) => (Array.isArray(s.financeBS) ? s.financeBS : EMPTY_BS));
  const storedRaw = useStrategyStore(
    (s: StrategyState) => (s.csvFinanceData as Record<string, unknown> | undefined)?.financePlanAssumptions,
  );
  const csvFinanceData = useStrategyStore((s: StrategyState) => s.csvFinanceData);
  const savedHash = useStrategyStore((s: StrategyState) => s.financePlanSavedHash);
  const setFinancePlanAssumptions = useStrategyStore((s: StrategyState) => s.setFinancePlanAssumptions);
  const saveStrategyData = useStrategyStore((s: StrategyState) => s.saveStrategyData);

  const stored = useMemo(() => readStoredFinancePlan(storedRaw, companyId), [storedRaw, companyId]);

  const [tab, setTab] = useState<FinanceTab>('target');
  const [cfForm, setCfForm] = useState<CashFlowForm>(() =>
    stored.kind === 'OK' ? cashFlowFormFrom(stored.domain.assumptions) : EMPTY_CASHFLOW_FORM,
  );
  const [scenarioForm, setScenarioForm] = useState<BaseScenarioForm>(() =>
    stored.kind === 'OK' ? baseScenarioFormFrom(stored.domain.assumptions.baseScenario) : {},
  );
  const [debtForm, setDebtForm] = useState<DebtForm>(() =>
    stored.kind === 'OK' ? debtFormFrom(stored.domain) : EMPTY_DEBT_FORM,
  );
  const [editVersion, setEditVersion] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const setCfFormByUser: Dispatch<SetStateAction<CashFlowForm>> = (action) => {
    setCfForm(action);
    setEditVersion((v) => v + 1);
    setSaveFailed(false);
  };
  const setScenarioFormByUser: Dispatch<SetStateAction<BaseScenarioForm>> = (action) => {
    setScenarioForm(action);
    setEditVersion((v) => v + 1);
    setSaveFailed(false);
  };
  const setDebtFormByUser: Dispatch<SetStateAction<DebtForm>> = (action) => {
    setDebtForm(action);
    setEditVersion((v) => v + 1);
    setSaveFailed(false);
  };
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [computedAt] = useState(() => new Date().toISOString());

  const investment = useMemo(
    () => buildInvestmentDemandSummary(departments, fiscalYearEnd),
    [departments, fiscalYearEnd],
  );
  const opexNotInPlan = useMemo(() => opexDeductionYearly(opexDeductionOfProjects(departments, fiscalYearEnd)), [departments, fiscalYearEnd]);
  const fiscalYearEndSet = parseFiscalYearEndMonth(fiscalYearEnd) !== null;
  const assumptions = useMemo(
    () => ({ ...toCashFlowAssumptions(cfForm), baseScenario: toBaseScenario(scenarioForm) }),
    [cfForm, scenarioForm],
  );
  const horizonYears = useMemo(
    () => forecastHorizonOf(financePL, NOW_YEAR, companyTargets),
    [financePL, companyTargets],
  );

  const investmentInput = useMemo(
    () => ({
      yearlyByCategory: investment.yearlyByCategory,
      unclassifiedYen: investment.unclassifiedYen,
      unscheduledYen: investment.unscheduledYen,
      candidateYen: investment.candidateYen,
      basisPendingYen: investment.basisPendingYen,
    }),
    [investment],
  );

  // 1段目：借入なしの計算（予測年度と基準年度の確定に使う）
  const basePlan = useMemo(
    () =>
      buildCashFlowPlan(
        { financePL, financeBS, investment: investmentInput, assumptions, fiscalYearEndSet, horizonYears },
        NOW_YEAR,
      ),
    [financePL, financeBS, investmentInput, assumptions, fiscalYearEndSet, horizonYears],
  );
  const forecastYears = useMemo(
    () => basePlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year),
    [basePlan],
  );
  const stage1Debt = useMemo(() => {
    if (basePlan.bsBaseYear === null) return null;
    const row = financeBS.find((r) => r.year === basePlan.bsBaseYear) as FinanceBSRow | undefined;
    const v = row?.interestBearingDebt;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, [financeBS, basePlan.bsBaseYear]);

  const debtEntered = isDebtEntered(debtForm);

  const schedule: DebtSchedule = useMemo(
    () => buildDebtSchedule(toDebtInput(debtForm, forecastYears, stage1Debt, fiscalYearEndSet)),
    [debtForm, forecastYears, stage1Debt, fiscalYearEndSet],
  );

  // 参考：目標への補間の経路（業績予測ではない。資金判定には使わない）
  const referencePlan = useMemo(
    () =>
      buildCashFlowPlan(
        {
          financePL,
          financeBS,
          investment: investmentInput,
          assumptions,
          fiscalYearEndSet,
          debt: debtEntered ? schedule : undefined,
          horizonYears,
        },
        NOW_YEAR,
      ),
    [financePL, financeBS, investmentInput, assumptions, fiscalYearEndSet, debtEntered, schedule, horizonYears],
  );

  const currentDomain: FinancePlanDomain = useMemo(() => {
    const d = toDebtDomain(debtForm, forecastYears);
    return { assumptions, existingLoans: d.existingLoans, newLoans: d.newLoans, dividendsYen: d.dividendsYen };
  }, [debtForm, forecastYears, assumptions]);

  const financeOutlook = useMemo(
    () =>
      buildFinanceOutlook({
        financePL,
        financeBS,
        departments,
        fiscalYearEnd,
        companyTargets,
        domain: currentDomain,
        currentYear: NOW_YEAR,
      }),
    [financePL, financeBS, departments, fiscalYearEnd, companyTargets, currentDomain],
  );
  const { target: unifiedTarget, effectTrial, unifiedPl, conditionalCf, baselinePlan } = financeOutlook;

  // 資金判定：既存事業の増減＋確認済み施策効果（統一PL）を前提にし、目標補間は使わない
  const fundingPlan = useMemo(
    () =>
      buildCashFlowPlan(
        {
          financePL,
          financeBS,
          investment: investmentInput,
          assumptions: withoutTargetPath(assumptions),
          fiscalYearEndSet,
          debt: debtEntered ? schedule : undefined,
          yearlyOverride: Object.fromEntries(
            unifiedPl.years.map((r) => [r.fiscalYear, { revenueYen: r.plan.revenueYen, operatingIncomeYen: r.plan.operatingIncomeYen }]),
          ),
          horizonYears,
        },
        NOW_YEAR,
      ),
    [financePL, financeBS, investmentInput, assumptions, fiscalYearEndSet, debtEntered, schedule, unifiedPl, horizonYears],
  );

  const currentMeta: CalcSnapshotMeta = useMemo(
    () => ({
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId,
      baseYear: basePlan.baseYear,
      bsBaseYear: basePlan.bsBaseYear,
      assumptionsHash: hashOf(toSavedFinancePlan(currentDomain)),
      sourceHash: sourceHashOf({
        financePL,
        financeBS,
        investment: {
          approvedReadyYen: investment.approvedReadyYen,
          unapprovedReadyYen: investment.unapprovedReadyYen,
          unclassifiedYen: investment.unclassifiedYen,
          unscheduledYen: investment.unscheduledYen,
          candidateYen: investment.candidateYen,
          basisPendingYen: investment.basisPendingYen,
          yearlyByCategory: investment.yearlyByCategory,
          opexNotInPlanYearly: opexNotInPlan.length > 0 ? opexNotInPlan : undefined,
        },
        fiscalYearEnd: fiscalYearEnd || undefined,
      }),
      unconfirmed: {
        unapprovedReadyYen: investment.unapprovedReadyYen,
        unclassifiedYen: investment.unclassifiedYen,
        unscheduledYen: investment.unscheduledYen,
        candidateYen: investment.candidateYen,
        basisPendingYen: investment.basisPendingYen,
      },
      computedAt,
    }),
    [companyId, basePlan.baseYear, basePlan.bsBaseYear, currentDomain, financePL, financeBS, investment, opexNotInPlan, fiscalYearEnd, computedAt],
  );

  useEffect(() => {
    if (editVersion === 0 || !companyId) return;
    setFinancePlanAssumptions(
      buildStoredFinancePlan({ domain: currentDomain, companyId, meta: currentMeta, savedAt: new Date().toISOString() }),
      { markDirty: false },
    );
  }, [editVersion, companyId, currentDomain, currentMeta, setFinancePlanAssumptions]);

  const hasInput =
    Object.values(cfForm).some((v) => v.trim() !== '') ||
    Object.values(scenarioForm).some((e) => e.revenue.trim() !== '' || e.operatingIncome.trim() !== '') ||
    isDebtEntered(debtForm);
  const savedMeta = stored.kind === 'OK' ? stored.meta : null;
  const freshness = judgeFreshness(savedMeta, currentMeta);
  const unsaved = financePlanUnsaved({
    currentHash: currentMeta.assumptionsHash,
    savedHash,
    workingHash: workingHashOf(csvFinanceData),
    hasInput,
  });
  const saveStatus = deriveSaveStatus({ saving, failed: saveFailed, unsaved, freshness });

  const provisionalReasons = provisionalFundingReasonsOf({
    revenueChanged: unifiedPl.years.some((y) => y.effect.revenueUpYen !== 0),
    assumptions,
  });
  const fundingNeed = fundingNeedOf(fundingPlan.years.filter((y) => y.kind === 'FORECAST')).need;
  const outlook = repaymentOutlook({
    debtEntered,
    years: fundingPlan.years.filter((y) => y.kind === 'FORECAST'),
  });
  const unconfirmed = withProvisionalItem(
    buildUnconfirmedItems({
      investment,
      existingLoanCount: debtForm.existing.length,
      debtEntered,
      minCashEntered: cfForm.minCash.trim() !== '',
      plan: fundingPlan,
      schedule,
    }),
    provisionalReasons,
  );
  const requiredCount = unconfirmed.filter((i) => i.required).length;
  const tabCount = (key: FinanceTab) => unconfirmed.filter((i) => i.tab === key).length;

  const save = async () => {
    if (!companyId) {
      setSaveMessage('会社が特定できないため保存しません。');
      return;
    }
    const storeCompany = useStrategyStore.getState().companyId ?? null;
    if (storeCompany !== companyId) {
      setSaveMessage('会社の切り替え中のため保存しませんでした。画面を再読み込みしてください。');
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    setSaveFailed(false);
    const savedAt = new Date().toISOString();
    const meta: CalcSnapshotMeta = { ...currentMeta, computedAt: savedAt };
    setFinancePlanAssumptions(
      buildStoredFinancePlan({ domain: currentDomain, companyId, meta, savedAt }),
    );
    try {
      const res = (await saveStrategyData({ reason: 'manual', force: true })) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
        code?: string;
      };
      if (res?.ok || (res?.skipped && res.reason === 'same_hash')) {
        return;
      }
      if (res?.skipped && res.reason === 'company_switching') {
        setSaveFailed(true);
        setSaveMessage(COMPANY_SWITCH_SAVE_MESSAGE);
      } else if (res?.skipped) {
        setSaveFailed(true);
        setSaveMessage(`保存されませんでした（${res.reason ?? '理由不明'}）。もう一度お試しください。`);
      } else {
        setSaveFailed(true);
        setSaveMessage(describeSaveError({ code: res?.code, message: res?.reason }));
      }
    } catch (e) {
      setSaveFailed(true);
      setSaveMessage(describeSaveError({ message: e instanceof Error ? e.message : undefined }));
    } finally {
      setSaving(false);
    }
  };

  const saveNeedsAction = saveStatus === 'FAILED' || saveStatus === 'STALE';
  const saveDetail =
    saveStatus === 'FAILED' ? '入力内容は画面に残っています。もう一度保存してください。' : freshnessLabel(freshness);

  const targetSummary = buildTargetSummary({ unifiedPl, target: unifiedTarget });
  const outlookCharts = buildOutlookCharts(financeOutlook, targetSummary);
  const cashSummary = buildCashSummary(conditionalCf);
  const fundingStatus: FundingStatus =
    provisionalReasons.length > 0
      ? { kind: 'JUDGED', label: '暫定（確定判定なし）', detail: '売上増加に伴う運転資金・税率の前提が未確認です', tone: 'hold' }
      : buildFundingStatus({ outlook });
  const firstRequired = unconfirmed.find((i) => i.required);
  const requiredItem = requiredCount > 0 && firstRequired ? { count: requiredCount, tab: firstRequired.tab } : null;
  const hasStatusNote =
    saveNeedsAction || !!saveMessage || stored.kind === 'DIFFERENT_COMPANY' || stored.kind === 'INVALID';

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="finance-outlook-title"
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="finance-outlook-title" className="text-lg font-bold text-slate-900">
            経営計画の実現見通し
          </h2>
          <button
            type="button"
            onClick={save}
            disabled={saving || !companyId}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"
          >
            {saving ? '保存中…' : '財務計画を保存'}
          </button>
        </div>

        {hasStatusNote && (
          <div className="min-w-0 text-xs text-slate-700">
            {saveNeedsAction && (
              <p>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${SAVE_STATUS_CLASS[saveStatus]}`}>
                  {SAVE_STATUS_LABEL[saveStatus]}
                </span>
                <span className="ml-2 text-slate-600">{saveDetail}</span>
              </p>
            )}
            {saveMessage && (
              <p className={`mt-1 ${saveFailed ? 'text-rose-700' : 'text-slate-800'}`}>{saveMessage}</p>
            )}
            {stored.kind === 'DIFFERENT_COMPANY' && (
              <p className="mt-1 text-amber-800">別の会社の保存データは表示しません。</p>
            )}
            {stored.kind === 'INVALID' && (
              <p className="mt-1 text-amber-800">保存された前提を読み込めませんでした：{stored.error}</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">① 経営目標に届くか</h3>
          <FinanceOutlookCharts charts={outlookCharts} />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">② どの施策が業績を改善するか</h3>
          <FinanceEffectProjectList projects={effectTrial.projects} years={effectTrial.years} />
          <PlanActualByProject departments={departments} fiscalYearEnd={fiscalYearEnd} />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">③ 資金は足りるか</h3>
          <FinanceSummary
            cash={cashSummary}
            funding={fundingStatus}
            requiredItem={requiredItem}
            onNavigate={setTab}
          />
          <p className="text-xs text-slate-600">投資・運転資金・借入返済・キャッシュフローの詳細は「詳しく確認する」にあります。</p>
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-slate-900">詳しく確認する</summary>
        <div className="mt-4 space-y-4">
        <div role="tablist" aria-label="財務計画の作業タブ" className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {FINANCE_TABS.map((t) => {
          const active = tab === t.key;
          const count = t.key === 'target' || t.key === 'verdict' ? 0 : tabCount(t.key);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex min-h-[3.25rem] min-w-0 items-center justify-center rounded-lg border px-1.5 py-2 text-center text-xs leading-snug break-keep 2xl:text-sm ${
                active
                  ? 'border-slate-900 bg-slate-900 font-semibold text-white'
                  : 'border-slate-400 bg-slate-100 font-medium text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span className="min-w-0">
                {t.label}
                {count > 0 && (
                  <span className="ml-1 inline-block rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="min-w-0 border-t border-slate-200 pt-5">
        {tab === 'target' && (
          <div className="space-y-6">
            <TabHeader tab="target" />
            <BaseScenarioPanel
              years={forecastYears}
              baseYear={basePlan.baseYear}
              baseRevenueYen={baselinePlan.years.find((y) => y.kind === 'ACTUAL')?.revenue.value ?? null}
              baseOperatingIncomeYen={baselinePlan.years.find((y) => y.kind === 'ACTUAL')?.operatingIncome.value ?? null}
              planned={Object.fromEntries(
                baselinePlan.years
                  .filter((y) => y.kind === 'FORECAST')
                  .map((y) => [y.year, { revenueYen: y.revenue.value, operatingIncomeYen: y.operatingIncome.value }]),
              )}
              mode={baselinePlan.basisMode}
              form={scenarioForm}
              setForm={setScenarioFormByUser}
            />
            <UnifiedPlPanel plan={unifiedPl} trial={effectTrial} />
            <p className="text-xs leading-relaxed text-slate-600 break-keep">
              目標に至る補間の経路は「3. お金は足りるか」の参考情報にあります。
            </p>
            {companyId && strategyId && (
              <details className="rounded-xl border border-slate-200 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  STAGE4の参考シナリオ（正式な財務効果とは別の参考）
                </summary>
                <div className="mt-3">
                  <Stage4ScenarioPanel companyId={companyId} strategyId={strategyId} departments={departments} />
                </div>
              </details>
            )}
          </div>
        )}

        {tab === 'investment' && (
          <div className="space-y-6">
            <TabHeader tab="investment" />
            <FundingDemandSection />
          </div>
        )}

        {tab === 'cashflow' && (
          <div className="space-y-4">
            <TabHeader tab="cashflow" />
            <ConditionalCfPanel cf={conditionalCf} />
            <section
              aria-label="目標補間の経路と前提入力（参考情報）"
              className="space-y-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-4"
            >
              <div>
                <h4 className="text-sm font-bold text-slate-700">目標補間の経路と前提入力（参考情報）</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
                  この表は経営目標へ到達する仮想的な経路で、業績予測ではありません。条件付きCFが未算定でも、この表の値で代用しません。税率・減価償却費・比率・目標の前提入力もここにあります。
                </p>
              </div>
              <CashFlowPanel plan={referencePlan} form={cfForm} setForm={setCfFormByUser} />
            </section>
          </div>
        )}

        {tab === 'debt' && (
          <div className="space-y-4">
            <TabHeader tab="debt" />
            <DebtPanel form={debtForm} setForm={setDebtFormByUser} forecastYears={forecastYears} schedule={schedule} plan={fundingPlan} />
          </div>
        )}

        {tab === 'verdict' && (
          <div className="space-y-4">
            <TabHeader tab="verdict" />
            <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-slate-600 break-keep">
              <li>目的：借入・返済を含む資金の不足と返済余力を、参考として判定する。</li>
              <li>前提：STAGE1の財務実績、既存事業の年度別増減、確認済みの施策効果（統一PL）。運転資金は比率から推計し、経営目標では補完しない。</li>
              <li>結果：売上増加があり運転資金・税率が未入力なら暫定（確定判定しない）。必要な前提が欠ける年度は評価保留とし、判定しない。</li>
            </ul>
            <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 break-keep">
              この判定は、既存事業の計画と確認済みの施策効果に基づく参考判定です。未確認の施策効果は含まず、目標への補間は使いません。確定予測ではありません。
            </p>
            <FinanceVerdictPanel
              plan={fundingPlan}
              schedule={schedule}
              debtEntered={debtEntered}
              fundingNeed={fundingNeed}
              items={unconfirmed}
              provisionalReasons={provisionalReasons}
              onNavigate={setTab}
            />
          </div>
        )}
      </div>
        </div>
      </details>
    </div>
  );
}
