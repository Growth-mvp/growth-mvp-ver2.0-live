'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { COMPANY_SWITCH_SAVE_MESSAGE, useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { buildInvestmentDemandSummary, parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { buildCashFlowPlan } from '@/utils/stage6/cashflow';
import { buildDebtSchedule, type DebtSchedule } from '@/utils/stage6/debt';
import { buildFinanceOutlook } from '@/utils/stage6/financeOutlook';
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
import { buildOutlookCharts } from './financeOutlookChartModel';
import { FundingDemandSection } from './FundingDemandSection';
import { BaseScenarioPanel } from './BaseScenarioPanel';
import {
  FINANCE_TABS,
  SAVE_STATUS_LABEL,
  buildUnconfirmedItems,
  deriveSaveStatus,
  repaymentOutlook,
  type FinanceTab,
  type SaveStatus,
} from './financePlanStatus';
import { buildCashSummary, buildFundingStatus, buildTargetSummary } from './financeSummaryModel';
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
  const fiscalYearEndSet = parseFiscalYearEndMonth(fiscalYearEnd) !== null;
  const assumptions = useMemo(
    () => ({ ...toCashFlowAssumptions(cfForm), baseScenario: toBaseScenario(scenarioForm) }),
    [cfForm, scenarioForm],
  );
  const targetPathInUse = assumptions.targetRevenueYen !== null || assumptions.targetOperatingIncomeYen !== null;

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
        { financePL, financeBS, investment: investmentInput, assumptions, fiscalYearEndSet },
        NOW_YEAR,
      ),
    [financePL, financeBS, investmentInput, assumptions, fiscalYearEndSet],
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

  // 2段目：借入計画を反映した計算（借入の入力がない場合はCF表示のみ）
  const plan = useMemo(
    () =>
      buildCashFlowPlan(
        {
          financePL,
          financeBS,
          investment: investmentInput,
          assumptions,
          fiscalYearEndSet,
          debt: debtEntered ? schedule : undefined,
        },
        NOW_YEAR,
      ),
    [financePL, financeBS, investmentInput, assumptions, fiscalYearEndSet, debtEntered, schedule],
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

  const currentMeta: CalcSnapshotMeta = useMemo(
    () => ({
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId,
      baseYear: plan.baseYear,
      bsBaseYear: plan.bsBaseYear,
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
    [companyId, plan.baseYear, plan.bsBaseYear, currentDomain, financePL, financeBS, investment, fiscalYearEnd, computedAt],
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

  const fundingNeed = fundingNeedOf(plan.years.filter((y) => y.kind === 'FORECAST')).need;
  const outlook = repaymentOutlook({
    debtEntered,
    years: plan.years.filter((y) => y.kind === 'FORECAST'),
  });
  const unconfirmed = buildUnconfirmedItems({
    investment,
    existingLoanCount: debtForm.existing.length,
    debtEntered,
    minCashEntered: cfForm.minCash.trim() !== '',
    plan,
    schedule,
  });
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
  const fundingStatus = buildFundingStatus({ targetPathInUse, outlook });
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

        <FinanceOutlookCharts charts={outlookCharts} />

        <FinanceSummary
          cash={cashSummary}
          funding={fundingStatus}
          requiredItem={requiredItem}
          onNavigate={setTab}
        />
      </section>

      <section
        aria-labelledby="finance-detail-title"
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="finance-detail-title" className="text-lg font-bold text-slate-900">
          詳しく確認する
        </h2>
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
            <FinanceEffectProjectList projects={effectTrial.projects} years={effectTrial.years} />
            {companyId && strategyId && (
              <Stage4ScenarioPanel companyId={companyId} strategyId={strategyId} departments={departments} />
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
              <CashFlowPanel plan={plan} form={cfForm} setForm={setCfFormByUser} />
            </section>
          </div>
        )}

        {tab === 'debt' && (
          <div className="space-y-4">
            <TabHeader tab="debt" />
            <DebtPanel form={debtForm} setForm={setDebtFormByUser} forecastYears={forecastYears} schedule={schedule} plan={plan} />
          </div>
        )}

        {tab === 'verdict' && (
          <div className="space-y-4">
            <TabHeader tab="verdict" />
            <p className="text-xs leading-relaxed text-slate-600 break-keep">
              計算の前提：STAGE1の財務実績とSTAGE4の投資計画から推計した年度別キャッシュフローです。借入を入力すると、借入・返済を反映した資金繰りを表示します。確定予測ではありません。
            </p>
            <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 break-keep">
              {targetPathInUse
                ? 'この判定は、経営目標へ到達する仮想的な経路（目標補間）に基づく参考判定です。施策効果は含まず、施策による業績達成可能性を判定したものではありません。'
                : 'この判定は、直近実績を横ばいにした既存の計画（施策効果を含まない）に基づく参考判定です。施策による業績達成可能性を判定したものではありません。'}
              条件付きPL・CFの結果は「1. 目標に届くか」と「3. お金は足りるか」の上段を参照してください。
            </p>
            <FinanceVerdictPanel
              plan={plan}
              schedule={schedule}
              debtEntered={debtEntered}
              fundingNeed={fundingNeed}
              items={unconfirmed}
              onNavigate={setTab}
            />
          </div>
        )}
      </div>

      </section>
    </div>
  );
}
