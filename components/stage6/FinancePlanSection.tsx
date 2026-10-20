'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
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
import { CashFlowPanel, EMPTY_CASHFLOW_FORM, type CashFlowForm } from './CashFlowSection';
import { DebtPanel, EMPTY_DEBT_FORM, isDebtEntered, type DebtForm } from './DebtPanel';
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

export function FinancePlanSection() {
  const companyId = useStrategyStore((s: StrategyState) => s.companyId ?? null);
  return <FinancePlanContent key={companyId ?? 'no-company'} companyId={companyId} />;
}

function FinancePlanContent({ companyId }: { companyId: string | null }) {
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

  const [cfForm, setCfForm] = useState<CashFlowForm>(() =>
    stored.kind === 'OK' ? cashFlowFormFrom(stored.domain.assumptions) : EMPTY_CASHFLOW_FORM,
  );
  const [debtForm, setDebtForm] = useState<DebtForm>(() =>
    stored.kind === 'OK' ? debtFormFrom(stored.domain) : EMPTY_DEBT_FORM,
  );
  const [editVersion, setEditVersion] = useState(0);
  const setCfFormByUser: Dispatch<SetStateAction<CashFlowForm>> = (action) => {
    setCfForm(action);
    setEditVersion((v) => v + 1);
  };
  const setDebtFormByUser: Dispatch<SetStateAction<DebtForm>> = (action) => {
    setDebtForm(action);
    setEditVersion((v) => v + 1);
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
        setSaveMessage(`保存されませんでした（${res.reason ?? '理由不明'}）。もう一度お試しください。`);
      } else {
        setSaveMessage(describeSaveError({ message: res?.reason }));
      }
    } catch (e) {
      setSaveMessage(describeSaveError({ message: e instanceof Error ? e.message : undefined }));
    } finally {
      setSaving(false);
    }
  };

  const refreshComputedAt = () => setComputedAt(new Date().toISOString());

  return (
    <section className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">キャッシュフロー・資金計画</h2>
        <p className="mt-1 text-sm text-slate-600">
          STAGE1の財務実績とSTAGE4の投資計画から、年度別キャッシュフローを推計します。
          借入の入力後は、借入・返済を反映した資金繰りを表示します。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>計算基準年度：PL {plan.baseYear ?? '未確認'} ／ BS {plan.bsBaseYear ?? '未確認'}</div>
          <div>対象会社ID：{companyId ?? '未取得'}</div>
          <div>計算ロジック版：{FINANCE_PLAN_CALC_VERSION}</div>
          <div>計算日時：{computedAt}</div>
          <div>入力前提の識別子：{currentMeta.assumptionsHash}</div>
          <div>元データ（STAGE1・STAGE4）の識別子：{currentMeta.sourceHash}</div>
          <div>未保存の変更：{unsaved ? 'あり' : 'なし'}</div>
          <div>保存状態：{unsaved ? '未保存の変更があります（全体保存でも保存されます）' : freshnessLabel(freshness)}</div>
        </div>
        {stored.kind === 'DIFFERENT_COMPANY' && (
          <div className="mt-2 text-amber-800">別の会社の保存データは表示しません。</div>
        )}
        {stored.kind === 'INVALID' && (
          <div className="mt-2 text-amber-800">保存された前提を読み込めませんでした：{stored.error}</div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !companyId}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"
          >
            {saving ? '保存中…' : '財務計画を保存'}
          </button>
          <button
            type="button"
            onClick={refreshComputedAt}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            計算日時を更新
          </button>
          {saveMessage && <span className="text-xs text-slate-800">{saveMessage}</span>}
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2 text-slate-700">
          <div className="font-semibold">保存の注意</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {availability.residualRisks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </div>

      <CashFlowPanel plan={plan} form={cfForm} setForm={setCfFormByUser} />

      <div className="border-t border-slate-200 pt-6">
        <h2 className="text-lg font-bold text-slate-900">借入・返済計画</h2>
        <p className="mt-1 text-sm text-slate-600">
          既存借入の内訳と新規借入の条件を入力すると、年度別の残高・利息・元本返済・財務CF・返済可能性を表示します。
          新規借入額は利用者が入力した額で、資金不足額から自動確定しません。
        </p>
        <div className="mt-4">
          <DebtPanel
            form={debtForm}
            setForm={setDebtFormByUser}
            forecastYears={forecastYears}
            schedule={schedule}
            plan={plan}
            debtEntered={debtEntered}
          />
        </div>
      </div>
    </section>
  );
}
