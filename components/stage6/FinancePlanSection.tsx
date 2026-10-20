'use client';

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import { buildInvestmentDemandSummary, parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { buildCashFlowPlan } from '@/utils/stage6/cashflow';
import { buildDebtSchedule, type DebtSchedule } from '@/utils/stage6/debt';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  describeSaveError,
  financePlanUnsaved,
  freshnessLabel,
  hashOf,
  judgeFreshness,
  readStoredFinancePlan,
  saveAvailability,
  sourceHashOf,
  toSavedFinancePlan,
  workingHashOf,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { CashFlowPanel, EMPTY_CASHFLOW_FORM, fmtMil, type CashFlowForm } from './CashFlowSection';
import { DebtPanel, EMPTY_DEBT_FORM, fundingNeedOf, isDebtEntered, type DebtForm } from './DebtPanel';
import { FinanceVerdictPanel, KpiCard } from './FinanceVerdictPanel';
import { FundingDemandSection } from './FundingDemandSection';
import {
  FINANCE_TABS,
  SAVE_STATUS_LABEL,
  buildUnconfirmedItems,
  deriveSaveStatus,
  repaymentOutlook,
  type FinanceTab,
  type SaveStatus,
} from './financePlanStatus';
import {
  cashFlowFormFrom,
  debtFormFrom,
  toCashFlowAssumptions,
  toDebtDomain,
  toDebtInput,
} from './financePlanForm';

const EMPTY_DEPARTMENTS: Department[] = [];
const EMPTY_PL: FinancePLRow[] = [];
const EMPTY_BS: FinanceBSRow[] = [];
const NOW_YEAR = new Date().getFullYear();

type TargetGap = { forecast: number; target: number; gap: number };

export type DashboardSummary = {
  revenue: TargetGap;
  op: TargetGap;
};

type SectionProps = {
  dashboardSummary?: DashboardSummary;
  targetContent?: ReactNode;
  reviewCandidateCount?: number;
};

const SAVE_STATUS_CLASS: Record<SaveStatus, string> = {
  SAVING: 'bg-sky-100 text-sky-800',
  FAILED: 'bg-rose-100 text-rose-800',
  UNSAVED: 'bg-amber-100 text-amber-800',
  STALE: 'bg-amber-100 text-amber-800',
  SAVED: 'bg-emerald-100 text-emerald-800',
  NOT_SAVED: 'bg-slate-200 text-slate-700',
};

function fmtMJPY(v: number) {
  return `${Math.round(v).toLocaleString('ja-JP')} 百万円`;
}

function targetGapText(row: TargetGap | undefined) {
  if (!row || !Number.isFinite(row.gap)) return { value: '-', note: '目標または見込みが未確定です' };
  return {
    value: row.gap > 0 ? `不足 ${fmtMJPY(row.gap)}` : '目標達成見込み',
    note: `見込み ${fmtMJPY(row.forecast)} ／ 目標 ${fmtMJPY(row.target)}`,
  };
}

export function FinancePlanSection(props: SectionProps) {
  const companyId = useStrategyStore((s: StrategyState) => s.companyId ?? null);
  return <FinancePlanContent key={companyId ?? 'no-company'} companyId={companyId} {...props} />;
}

function FinancePlanContent({
  companyId,
  dashboardSummary,
  targetContent,
  reviewCandidateCount = 0,
}: SectionProps & { companyId: string | null }) {
  const departments = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.departments) ? s.departments : EMPTY_DEPARTMENTS,
  );
  const fiscalYearEnd = useStrategyStore((s: StrategyState) => s.fiscalYearEnd);
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
  const access = useAccess();
  const showTechnicalDetails = access.isAdmin || process.env.NODE_ENV === 'development';

  const [tab, setTab] = useState<FinanceTab>('target');
  const [cfForm, setCfForm] = useState<CashFlowForm>(() =>
    stored.kind === 'OK' ? cashFlowFormFrom(stored.domain.assumptions) : EMPTY_CASHFLOW_FORM,
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
  const setDebtFormByUser: Dispatch<SetStateAction<DebtForm>> = (action) => {
    setDebtForm(action);
    setEditVersion((v) => v + 1);
    setSaveFailed(false);
  };
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState(() => new Date().toISOString());

  const investment = useMemo(
    () => buildInvestmentDemandSummary(departments, fiscalYearEnd),
    [departments, fiscalYearEnd],
  );
  const fiscalYearEndSet = parseFiscalYearEndMonth(fiscalYearEnd) !== null;
  const assumptions = useMemo(() => toCashFlowAssumptions(cfForm), [cfForm]);

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

  const hasInput = Object.values(cfForm).some((v) => v.trim() !== '') || isDebtEntered(debtForm);
  const savedMeta = stored.kind === 'OK' ? stored.meta : null;
  const freshness = judgeFreshness(savedMeta, currentMeta);
  const unsaved = financePlanUnsaved({
    currentHash: currentMeta.assumptionsHash,
    savedHash,
    workingHash: workingHashOf(csvFinanceData),
    hasInput,
  });
  const availability = saveAvailability();
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
      };
      if (res?.ok) {
        setSaveMessage(`保存しました（${new Date(savedAt).toLocaleTimeString('ja-JP')}）。`);
      } else if (res?.skipped && res.reason === 'same_hash') {
        setSaveMessage('保存済みの内容と同じため、変更はありません。');
      } else if (res?.skipped) {
        setSaveFailed(true);
        setSaveMessage(`保存されませんでした（${res.reason ?? '理由不明'}）。もう一度お試しください。`);
      } else {
        setSaveFailed(true);
        setSaveMessage(describeSaveError({ message: res?.reason }));
      }
    } catch (e) {
      setSaveFailed(true);
      setSaveMessage(describeSaveError({ message: e instanceof Error ? e.message : undefined }));
    } finally {
      setSaving(false);
    }
  };

  const refreshComputedAt = () => setComputedAt(new Date().toISOString());

  const saveDetail =
    saveStatus === 'SAVING'
      ? '保存しています…'
      : saveStatus === 'FAILED'
        ? '入力内容は画面に残っています。もう一度保存してください。'
        : saveStatus === 'UNSAVED'
          ? '入力内容は画面に保持されています（全体保存でも保存されます）。'
          : freshnessLabel(freshness);

  const revenueGap = targetGapText(dashboardSummary?.revenue);
  const opGap = targetGapText(dashboardSummary?.op);
  const top3 = unconfirmed.slice(0, 3);

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">キャッシュフロー・資金計画</h2>
        <p className="mt-1 text-sm text-slate-600">
          STAGE1の財務実績とSTAGE4の投資計画から、年度別キャッシュフローを推計します。
          借入の入力後は、借入・返済を反映した資金繰りを表示します。
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">財務計画の保存状態</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SAVE_STATUS_CLASS[saveStatus]}`}>
              {SAVE_STATUS_LABEL[saveStatus]}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{saveDetail}</p>
          {saveMessage && (
            <p className={`mt-1 text-xs ${saveFailed ? 'text-rose-700' : 'text-slate-800'}`}>{saveMessage}</p>
          )}
          {stored.kind === 'DIFFERENT_COMPANY' && (
            <p className="mt-1 text-xs text-amber-800">別の会社の保存データは表示しません。</p>
          )}
          {stored.kind === 'INVALID' && (
            <p className="mt-1 text-xs text-amber-800">保存された前提を読み込めませんでした：{stored.error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !companyId}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '財務計画を保存'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="売上目標との差"
          value={revenueGap.value}
          note={revenueGap.note}
          tone={dashboardSummary && dashboardSummary.revenue.gap > 0 ? 'warn' : 'neutral'}
          onClick={() => setTab('target')}
          actionLabel="1. 目標・施策効果で確認"
        />
        <KpiCard
          label="営業利益目標との差"
          value={opGap.value}
          note={opGap.note}
          tone={dashboardSummary && dashboardSummary.op.gap > 0 ? 'warn' : 'neutral'}
          onClick={() => setTab('target')}
          actionLabel="1. 目標・施策効果で確認"
        />
        <KpiCard
          label="投資・資金需要（確認済み）"
          value={`${fmtMil(investment.readyYen)} 百万円`}
          note={`${investment.readyCount}件が資金計画に反映可能`}
        />
        <KpiCard
          label="返済可能性（簡易判定）"
          value={outlook.label}
          note={outlook.detail}
          tone={outlook.tone === 'warn' ? 'warn' : outlook.tone === 'ok' ? 'ok' : 'hold'}
        />
        <KpiCard
          label="未確認事項"
          value={`${unconfirmed.length}件`}
          note={requiredCount > 0 ? `判定に影響 ${requiredCount}件` : '判定を妨げる事項はありません'}
          tone={requiredCount > 0 ? 'warn' : 'ok'}
        />
      </div>

      {top3.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="text-xs font-semibold text-slate-700">主要な未確認事項（上位{top3.length}件）</div>
          <ul className="mt-2 space-y-2">
            {top3.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-2 text-sm text-slate-800 md:flex-row md:items-center md:justify-between"
              >
                <span>
                  <span
                    className={`mr-2 inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      item.required ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.required ? '判定に影響' : '参考'}
                  </span>
                  {item.label}
                </span>
                <button
                  type="button"
                  onClick={() => setTab(item.tab)}
                  className="shrink-0 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:self-auto"
                >
                  {FINANCE_TABS.find((t) => t.key === item.tab)?.label}へ移動
                </button>
              </li>
            ))}
          </ul>
          {unconfirmed.length > top3.length && (
            <p className="mt-2 text-xs text-slate-600">
              ほか {unconfirmed.length - top3.length} 件は「4. 財務判定」タブで確認できます。
            </p>
          )}
        </div>
      )}

      {reviewCandidateCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm md:flex-row md:items-center md:justify-between">
          <span className="text-slate-800">目標に対して見直すべきプロジェクトが {reviewCandidateCount}件 あります。</span>
          <button
            type="button"
            onClick={() => setTab('target')}
            className="shrink-0 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:self-auto"
          >
            1. 目標・施策効果で確認
          </button>
        </div>
      )}

      <div role="tablist" aria-label="財務計画の作業タブ" className="flex gap-1 overflow-x-auto border-b border-slate-200">
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
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
                active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="min-w-0">
        {tab === 'target' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">1. 目標・施策効果</h3>
              <p className="mt-2 text-sm font-semibold text-slate-900 break-keep">
                経営目標に対して、現場の施策はどの程度貢献するのか。
              </p>
              <p className="mt-1 text-sm text-slate-600 break-keep">
                STAGE2の目標とSTAGE4の施策効果を比較し、目標とのギャップや見直すべき施策を確認します。
              </p>
            </div>
            {targetContent}
          </div>
        )}

        {tab === 'investment' && <FundingDemandSection />}

        {tab === 'cashflow' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">3. キャッシュフロー</h3>
              <p className="mt-1 text-sm text-slate-600">
                推計の前提を入力すると、年度別の営業CF・財務CF・期末現預金に反映されます。
              </p>
            </div>
            <CashFlowPanel plan={plan} form={cfForm} setForm={setCfFormByUser} />
          </div>
        )}

        {tab === 'debt' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">4. 借入・返済</h3>
              <p className="mt-1 text-sm text-slate-600">
                既存借入の内訳と新規借入の条件を入力すると、年度別の残高・利息・元本返済・財務CFを表示します。
                新規借入額は利用者が入力した額で、資金不足額から自動確定しません。
              </p>
            </div>
            <DebtPanel form={debtForm} setForm={setDebtFormByUser} forecastYears={forecastYears} schedule={schedule} plan={plan} />
          </div>
        )}

        {tab === 'verdict' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">5. 財務判定</h3>
              <p className="mt-1 text-sm text-slate-600">
                資金不足額・返済可能性・未確認事項と、年度別の総合財務表を確認します。
              </p>
            </div>
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

      {showTechnicalDetails && (
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-700">計算の詳細（管理者・開発用）</summary>
        <p className="mt-2 text-slate-500">通常の画面には表示しません。計算・保存の内部情報のため、業務上の判断には使用しないでください。</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>計算基準年度：PL {plan.baseYear ?? '未確認'} ／ BS {plan.bsBaseYear ?? '未確認'}</div>
          <div>対象会社ID：{companyId ?? '未取得'}</div>
          <div>計算ロジック版：{FINANCE_PLAN_CALC_VERSION}</div>
          <div>計算日時：{computedAt}</div>
          <div>入力前提の識別子：{currentMeta.assumptionsHash}</div>
          <div>元データ（STAGE1・STAGE4）の識別子：{currentMeta.sourceHash}</div>
        </div>
        <button
          type="button"
          onClick={refreshComputedAt}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          計算日時を更新
        </button>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700">
          <div className="font-semibold">保存の注意</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {availability.residualRisks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </details>
      )}
    </section>
  );
}
