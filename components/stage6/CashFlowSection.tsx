'use client';

import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CfBasis, CfValue, CfYear, CashFlowPlan } from '@/utils/stage6/cashflow';
import { MILLION } from './financePlanForm';

export { MILLION, parseNumber, toCashFlowAssumptions } from './financePlanForm';


export type CashFlowForm = {
  minCash: string;
  taxRate: string;
  depreciation: string;
  ar: string;
  inventory: string;
  ap: string;
  targetRevenue: string;
  targetOperatingIncome: string;
  targetYear: string;
};

export const EMPTY_CASHFLOW_FORM: CashFlowForm = {
  minCash: '',
  taxRate: '',
  depreciation: '',
  ar: '',
  inventory: '',
  ap: '',
  targetRevenue: '',
  targetOperatingIncome: '',
  targetYear: '',
};

export const BASIS_LABEL: Record<CfBasis, string> = {
  ACTUAL: '実績',
  ESTIMATE: '推計',
  USER: '利用者指定',
  REGISTERED: 'STAGE4登録',
  HELD: '保留',
};

export const BASIS_CLASS: Record<CfBasis, string> = {
  ACTUAL: 'bg-slate-100 text-slate-700',
  ESTIMATE: 'bg-sky-50 text-sky-700',
  USER: 'bg-violet-50 text-violet-700',
  REGISTERED: 'bg-emerald-50 text-emerald-700',
  HELD: 'bg-amber-50 text-amber-800',
};

export function fmtMil(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '保留';
  return (value / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

export function fmtPct(v: number | null) {
  return v === null ? '-' : `${(v * 100).toFixed(1)}%`;
}

export function BasisBadge({ basis }: { basis: CfBasis }) {
  return (
    <span className={`mt-0.5 inline-block rounded px-1 text-[10px] font-semibold ${BASIS_CLASS[basis]}`}>
      {BASIS_LABEL[basis]}
    </span>
  );
}

export function Cell({ cell }: { cell: CfValue | undefined }) {
  if (!cell) return <td className="px-2 py-1.5 text-right text-slate-400">-</td>;
  const held = cell.value === null;
  const notApplicable = held && cell.basis === 'ACTUAL';
  return (
    <td className="px-2 py-1.5 text-right align-top" title={cell.note ?? ''}>
      <div className={held ? 'text-amber-700' : 'font-medium text-slate-900'}>
        {notApplicable ? '対象外' : fmtMil(cell.value)}
      </div>
      <BasisBadge basis={cell.basis} />
    </td>
  );
}

export function Row({
  label,
  years,
  pick,
  strong,
}: {
  label: string;
  years: CfYear[];
  pick: (y: CfYear) => CfValue;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-slate-50/70' : ''}>
      <td className={`px-2 py-1.5 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</td>
      {years.map((y) => (
        <Cell key={y.year} cell={pick(y)} />
      ))}
    </tr>
  );
}

export function RatioCell({ label, cell }: { label: string; cell: CfValue }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="text-slate-500">{label}</div>
      <div className={cell.value === null ? 'text-amber-700' : 'font-semibold text-slate-900'}>
        {cell.value === null ? '保留' : fmtPct(cell.value)}
      </div>
      <BasisBadge basis={cell.basis} />
    </div>
  );
}

type PanelProps = {
  plan: CashFlowPlan;
  form: CashFlowForm;
  setForm: Dispatch<SetStateAction<CashFlowForm>>;
};

export function CashFlowPanel({ plan, form, setForm }: PanelProps) {
  const setField = (key: keyof CashFlowForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const years = plan.years;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">財務実績の基準年度</div>
          <div className="mt-1 text-sm text-slate-900">
            PL：{plan.baseYear ?? '未確認'} ／ BS：{plan.bsBaseYear ?? '未確認'}
          </div>
          {plan.yearMismatch && <div className="mt-1 text-amber-700">PLとBSの基準年度が異なります（推計を保留）</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">税率</div>
          <div className="mt-1 text-sm text-slate-900">
            {plan.taxRate.value === null ? '保留' : fmtPct(plan.taxRate.value)}
          </div>
          <div className="text-slate-500">{plan.taxRate.note}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">推計シナリオ</div>
          <div className="mt-1 text-sm text-slate-900">{plan.scenario.note}</div>
        </div>
      </div>

      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">推計前提（試算条件）</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <Field label="最低必要現預金（百万円）" value={form.minCash} onChange={setField('minCash')} />
          <Field label="税率（%・空欄は実績から推計）" value={form.taxRate} onChange={setField('taxRate')} />
          <Field label="減価償却費（百万円・空欄は基準年度を据え置き）" value={form.depreciation} onChange={setField('depreciation')} />
          <div />
          <Field label="売上債権比率（%・空欄は基準年度）" value={form.ar} onChange={setField('ar')} />
          <Field label="棚卸資産比率（%・空欄は基準年度）" value={form.inventory} onChange={setField('inventory')} />
          <Field label="仕入債務比率（%・空欄は基準年度）" value={form.ap} onChange={setField('ap')} />
          <div />
          <Field label="目標売上（百万円・推計シナリオ）" value={form.targetRevenue} onChange={setField('targetRevenue')} />
          <Field label="目標営業利益（百万円・推計シナリオ）" value={form.targetOperatingIncome} onChange={setField('targetOperatingIncome')} />
          <Field label="目標年度（推計シナリオ）" value={form.targetYear} onChange={setField('targetYear')} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          売上・営業利益の目標を入れると、基準年度から目標年度まで直線的に推計します。これは推計シナリオであり、会社が承認した計画値ではありません。
        </p>
      </details>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">項目（百万円）</th>
              {years.map((y) => (
                <th key={y.year} className="px-2 py-2 text-right font-semibold">
                  {y.year}年{y.kind === 'ACTUAL' ? '（実績）' : '（推計）'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <Row label="売上高" years={years} pick={(y) => y.revenue} />
            <Row label="営業利益" years={years} pick={(y) => y.operatingIncome} />
            <Row label="支払利息（借入計画・据置の利息）" years={years} pick={(y) => y.interest} />
            <Row label="税引後利益（推計）" years={years} pick={(y) => y.netIncome} />
            <Row label="減価償却費" years={years} pick={(y) => y.depreciation} />
            <Row label="運転資金" years={years} pick={(y) => y.workingCapital} />
            <Row label="運転資金増加（△は減少）" years={years} pick={(y) => y.workingCapitalChange} />
            <Row label="営業CF" years={years} pick={(y) => y.operatingCf} strong />
            <Row label="投資CF（資本的支出）" years={years} pick={(y) => y.investingCf} />
            <Row label="FCF" years={years} pick={(y) => y.fcf} strong />
            <Row label="期首現預金" years={years} pick={(y) => y.openingCash} />
            <Row label="期末現預金（借入反映前）" years={years} pick={(y) => y.closingCashBeforeFinancing} strong />
            <Row label="財務CF（新規借入−元本返済−配当）" years={years} pick={(y) => y.financingCf} strong />
            <Row label="期末現預金（借入反映後）" years={years} pick={(y) => y.closingCashAfterFinancing} strong />
            <Row label="最低必要現預金" years={years} pick={(y) => y.minCash} />
            <Row label="不足額（借入反映前・参考）" years={years} pick={(y) => y.shortfall} />
            <Row label="不足額（借入反映後）" years={years} pick={(y) => y.postShortfall} strong />
            <tr>
              <td className="px-2 py-1.5 text-slate-500">営業費用（OPEX）：営業利益計画に含まれるため控除していない</td>
              {years.map((y) => (
                <td key={y.year} className="px-2 py-1.5 text-right text-slate-500">
                  {fmtMil(y.kind === 'FORECAST' ? y.opexRegistered : null)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1.5 text-slate-500">その他の支出（OTHER）：内容確認が必要で未計上</td>
              {years.map((y) => (
                <td key={y.year} className="px-2 py-1.5 text-right text-slate-500">
                  {fmtMil(y.kind === 'FORECAST' ? y.otherRegistered : null)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <h3 className="text-sm font-semibold text-slate-900">評価保留・未確認事項（キャッシュフロー）</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
          {plan.globalHolds.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        {years.some((y) => y.holds.length > 0) && (
          <div className="mt-3 space-y-1 text-xs text-amber-900">
            {years
              .filter((y) => y.holds.length > 0)
              .map((y) => (
                <div key={y.year}>
                  <span className="font-semibold">{y.year}年：</span>
                  {y.holds.join('、')}
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <RatioCell label="売上債権（対売上高）" cell={plan.workingCapitalRatios.ar} />
        <RatioCell label="棚卸資産（対売上高）" cell={plan.workingCapitalRatios.inventory} />
        <RatioCell label="仕入債務（対売上高）" cell={plan.workingCapitalRatios.ap} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label>
      {label}
      <input
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
        value={value}
        onChange={onChange}
        inputMode="decimal"
      />
    </label>
  );
}
